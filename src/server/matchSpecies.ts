import type {
  PlanetScan,
  SpeciesDatabase,
  SpeciesEntry,
  SpeciesMatch,
  SpeciesCriterion,
  SpeciesMatchContext,
  GenusHint,
  MatchReason,
  EstimatedSurfaceTempBand,
  OrganicGenusLock,
} from "../shared/types.js";
import { journalSurfaceGravityToG, THIN_ATMOSPHERE_MAX_ATM } from "../shared/journalPhysics.js";
import { observedAtGravity } from "./speciesGravityObservations.js";
import {
  normalizeScanAtmosphereForMatch,
  atmosphereCompositionKey,
  atmosphereAllowlistMeansAnyThinCompositionOnly,
} from "../shared/scanAtmosphereMatch.js";
import { atmosphereBucketForEstimator, estimatedTemperatureRangeForScan } from "./planetTemperature.js";
import { dssHintsIncludeBacterium } from "../shared/genusHints.js";
import { filterByGenusHints } from "./genusMatchUtils.js";
import {
  applyOrganicGenusLocks,
  organicScanConfirmsNonBacteriumGenus,
  collectResolvedOrganicLockSpeciesIds,
} from "./organicLocks.js";
import { spectralKeysFromJournalStarType } from "../shared/starSpectralKeys.js";
import { observedOnPlanetClass } from "./speciesPlanetClassObservations.js";
import { observedAtTemperature } from "./speciesTemperatureObservations.js";
import { observedWithVolcanism } from "./speciesVolcanismObservations.js";
import {
  hostStarVerdict,
  speciesHostStarObservations,
  type HostStarVerdict,
} from "./speciesHostStarObservations.js";
import { volcanismJournalMatchesFragments } from "../shared/volcanismMatch.js";
import { isBacteriumSpeciesEntry } from "../shared/speciesBacterium.js";

export { isBacteriumSpeciesEntry };
const OPEN_LO = -1e15;
const OPEN_HI = 1e15;

function injectOrganicLockConfirmedSpecies(
  matches: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  organicGenusLocks: OrganicGenusLock[] | null | undefined,
  db: SpeciesDatabase,
): { matches: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[]; injected: boolean } {
  const wantIds = collectResolvedOrganicLockSpeciesIds(organicGenusLocks, db);
  if (!wantIds.length) return { matches, injected: false };
  const have = new Set(matches.map((m) => m.entry.id));
  let injected = false;
  const extra: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[] = [];
  for (const id of wantIds) {
    if (have.has(id)) continue;
    const entry = db.species.find((e) => e.id === id);
    if (!entry) continue;
    have.add(id);
    injected = true;
    extra.push({
      entry,
      reasons: [
        {
          field: "ScanOrganic",
          detail:
            "Journal ScanOrganic on this body identifies this species. Listed even when merged journal scan/DSS fields fail usual codex gates (inherited scan, moon parents, or estimator mismatch).",
        },
      ],
      approximateMatch: true,
    });
  }
  return { matches: [...matches, ...extra], injected };
}

/** Genera that require active volcanism in-game; enforced even if JSON omits `volcanismIncludes`. */
const GENUS_DATA_DIR_REQUIRING_VOLCANISM = new Set<string>(["brain-tree"]);

/**
 * In-game Brain Trees only on airless bodies; enforced even if genus JSON omits atmosphere.
 * Per-species rows still list planet classes that can exist with thin atmo — gate by scan.
 */
const GENUS_DATA_DIR_REQUIRING_NO_ATMOSPHERE = new Set<string>(["brain-tree"]);

/** Codex list entry `ALL` means any allowed value for that gate (match any scan). */
function codexListMeansAll(values: string[] | undefined): boolean {
  return !!values?.some((v) => (v ?? "").trim().toUpperCase() === "ALL");
}

function journalReportsAnyVolcanism(scan: PlanetScan): boolean {
  const raw = scan.Volcanism;
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (!v) return false;
  const lo = v.toLowerCase();
  if (lo.includes("no volcanism")) return false;
  return true;
}

function inRange(v: number, min?: number, max?: number): boolean {
  if (min !== undefined && v < min) return false;
  if (max !== undefined && v > max) return false;
  return true;
}

/**
 * The owner's rule, in his words: "if it matches the ranges even within 2% it matches them. And is
 * thrown as a possibility, with a low chance."
 *
 * A value this close to the edge of a codex band sits inside the uncertainty of the band itself -
 * the codex numbers are rounded, and our surface temperature is often an estimate rather than a
 * measurement. Treating that as proof of absence throws away finds for a difference we cannot
 * actually resolve.
 */
export const NUMERIC_GATE_TOLERANCE = 0.02;

/**
 * `in` - inside the band. `near` - outside, but by no more than {@link NUMERIC_GATE_TOLERANCE} of
 * the edge it missed, so the candidate is demoted rather than dropped. `out` - beyond that.
 */
function rangeFit(v: number, min?: number, max?: number): "in" | "near" | "out" {
  if (inRange(v, min, max)) return "in";
  const edge = min !== undefined && v < min ? min : max!;
  const slack = Math.abs(edge) * NUMERIC_GATE_TOLERANCE;
  return Math.abs(v - edge) <= slack ? "near" : "out";
}

/** Species band widened by the tolerance, for the band-vs-band temperature test. */
function tempBandsOverlapWithinTolerance(
  planet: PlanetTemperatureBand,
  species: { lo: number; hi: number },
): boolean {
  const lo = species.lo === OPEN_LO ? OPEN_LO : species.lo - Math.abs(species.lo) * NUMERIC_GATE_TOLERANCE;
  const hi = species.hi === OPEN_HI ? OPEN_HI : species.hi + Math.abs(species.hi) * NUMERIC_GATE_TOLERANCE;
  return planet.minK <= hi && lo <= planet.maxK;
}

/** Suffix appended to every demoted failure, so the card says what the tier means. */
const DEMOTED_NOTE = "Listed as a low-probability find rather than excluded.";

/**
 * The result of testing one species against one body.
 *
 * `ok` keeps its original meaning - every criterion passed. What is new is that a failure is no
 * longer automatically a rejection: see {@link softOnly}.
 */
export interface CriteriaMatchResult {
  ok: boolean;
  /** Failures when `!ok`, the criteria that passed when `ok`. */
  reasons: MatchReason[];
  /**
   * Every failure is a weighted term rather than a wall, so the candidate belongs in the unlikely
   * tier instead of being removed. Only meaningful when `!ok`.
   */
  softOnly?: boolean;
  /** What did pass, kept so a demoted candidate can still show what fits. Only set when `!ok`. */
  passed?: MatchReason[];
}

export interface PlanetTemperatureBand {
  minK: number;
  maxK: number;
}

function speciesTempBand(c: SpeciesCriterion): { lo: number; hi: number } | null {
  const st = c.surfaceTemperatureK;
  if (!st) return null;
  if (st.min === undefined && st.max === undefined) return null;
  return { lo: st.min ?? OPEN_LO, hi: st.max ?? OPEN_HI };
}

function speciesNeedsTemperatureGate(c: SpeciesCriterion): boolean {
  return speciesTempBand(c) !== null;
}

function speciesPressureBand(c: SpeciesCriterion): { lo: number; hi: number } | null {
  const sp = c.surfacePressure;
  if (!sp) return null;
  if (sp.min === undefined && sp.max === undefined) return null;
  return { lo: sp.min ?? OPEN_LO, hi: sp.max ?? OPEN_HI };
}

/** Planet band vs species band: overlap ⇒ inhabitable somewhere on the body. */
function tempBandsOverlap(planet: PlanetTemperatureBand, species: { lo: number; hi: number }): boolean {
  return planet.minK <= species.hi && species.lo <= planet.maxK;
}

/**
 * The body's temperature for matching: the journal's reading when there is one.
 *
 * The estimator used to win this contest whenever it produced anything, and it produced a band a
 * mean **137 K** wide (p90 291 K). Worse, measured across 13,271 scanned bodies, the journal's own
 * `SurfaceTemperature` falls **outside** that estimated band on **28.8 %** of them — so the matcher
 * was discarding a measurement in favour of a guess that disagreed with it more than a quarter of
 * the time.
 *
 * It was compensation for bands that were too narrow to trust, and the compensation cost more than
 * the problem: dropping it cuts mean ambiguity from 11.16 to 7.51 and p90 from 33 to 16, and raises
 * decidability from 31.4 % to 34.6 %. It is not free — 10 confirmed species and 85.9 M credits move
 * out of the default list, 4 of them into the unlikely tier rather than out of the app — and the
 * owner took that trade explicitly.
 *
 * The estimator is still computed and still shown: `estimatedSurfaceTempK` rides the snapshot for
 * display, and it is the only band available on a body the commander has not scanned in detail.
 */
function resolvePlanetTemperatureBand(
  scan: PlanetScan,
  est: { tMin: number; tMax: number } | null,
): PlanetTemperatureBand | null {
  if (scan.SurfaceTemperature != null && !Number.isNaN(scan.SurfaceTemperature)) {
    const t = scan.SurfaceTemperature;
    return { minK: t, maxK: t };
  }
  if (est) return { minK: est.tMin, maxK: est.tMax };
  return null;
}

/**
 * All journal gates except temperature and pressure (used to pick fallback candidates).
 */
export function speciesMatchesExcludingTempPressure(
  entry: SpeciesEntry,
  scan: PlanetScan,
  matchContext?: SpeciesMatchContext | null,
): CriteriaMatchResult {
  const failures: MatchReason[] = [];
  const reasons: MatchReason[] = [];
  const c = entry.criteria;
  const ctx = matchContext ?? undefined;

  if (!scan.PlanetClass) {
    failures.push({ field: "PlanetClass", detail: "No planet class in scan" });
  }

  if (!c.planetClassAnyOf || c.planetClassAnyOf.length === 0) {
    if (!isBacteriumSpeciesEntry(entry)) {
      failures.push({
        field: "PlanetClass",
        detail:
          "Database entry must include planetClassAnyOf (e.g. High metal content body) — this species cannot be matched.",
      });
    } else {
      reasons.push({
        field: "PlanetClass",
        detail: `${scan.PlanetClass ?? "—"} · bacterium rows use atmosphere gates only`,
      });
    }
  } else if (
    scan.PlanetClass &&
    !codexListMeansAll(c.planetClassAnyOf) &&
    !c.planetClassAnyOf.includes(scan.PlanetClass)
  ) {
    /**
     * Not a wall, and since the miss log spoke, not even a demotion when the corpus disagrees.
     *
     * Measured against the feeder's observed habitats this list rejected 4.14% of the bodies where
     * the species was actually found (1,046 of 25,289), and the pattern is systematic: High metal
     * content body is missing from the allowed list of almost every Tussock, Osseus and Fungoida
     * species, which is 3-32% of where those species really grow. §6 made it soft. The miss log then
     * recorded 15 real finds sitting in the demoted tier for exactly this reason — Tussock capillum
     * on a Rocky ice body five times, a class holding 67% of that species' observed bodies — so
     * observation now overrules the row outright, as it does for the host star (§27).
     */
    const observedHere = observedOnPlanetClass(entry, scan.PlanetClass);
    if (observedHere) {
      reasons.push({
        field: "PlanetClass",
        detail: `${scan.PlanetClass} — outside the codex list, but ${observedHere.observations} of ${observedHere.total} observed bodies (${Math.round(observedHere.share * 100)}%) are this class.`,
      });
    } else {
      failures.push({
        field: "PlanetClass",
        soft: true,
        detail: `Codex lists ${c.planetClassAnyOf.join(", ")}; journal has “${scan.PlanetClass}”. ${DEMOTED_NOTE}`,
      });
    }
  } else if (scan.PlanetClass) {
    reasons.push({
      field: "PlanetClass",
      detail: codexListMeansAll(c.planetClassAnyOf)
        ? `${scan.PlanetClass} (codex allows ALL body classes)`
        : scan.PlanetClass,
    });
  }

  const atmoNorm = normalizeScanAtmosphereForMatch(scan);
  if (c.atmosphereTypeAnyOf?.length) {
    const allowed = c.atmosphereTypeAnyOf;
    if (atmosphereAllowlistMeansAnyThinCompositionOnly(allowed) && c.atmospherePressureCategory === "thin") {
      if (!atmoNorm) {
        failures.push({
          field: "AtmosphereType",
          detail:
            "Codex accepts any thin atmosphere — journal must report an atmosphere after detailed scan (got none / vacuum).",
        });
      } else {
        let thinOk = false;
        if (ctx?.surfacePressureAtm != null && Number.isFinite(ctx.surfacePressureAtm)) {
          thinOk = ctx.surfacePressureAtm <= THIN_ATMOSPHERE_MAX_ATM;
        } else {
          thinOk = atmosphereBucketForEstimator(scan) === "thin";
        }
        if (!thinOk) {
          const p = ctx?.surfacePressureAtm;
          // A pressure a couple of percent over the thin cutoff is the cutoff's own rounding.
          const near =
            p != null && Number.isFinite(p) && rangeFit(p, undefined, THIN_ATMOSPHERE_MAX_ATM) === "near";
          const detail =
            p != null && Number.isFinite(p)
              ? `Any thin atmosphere: ${p.toFixed(3)} atm exceeds thin cutoff (${THIN_ATMOSPHERE_MAX_ATM} atm after journal conversion).${near ? ` Within ${NUMERIC_GATE_TOLERANCE * 100}%. ${DEMOTED_NOTE}` : ""}`
              : `Any thin atmosphere: need DSS surface pressure ≤ ${THIN_ATMOSPHERE_MAX_ATM} atm, or AtmosphereType containing “Thin …”.`;
          failures.push({ field: "AtmosphereType", detail, ...(near ? { soft: true } : {}) });
        } else {
          reasons.push({
            field: "AtmosphereType",
            detail: `${scan.AtmosphereType?.trim() || atmoNorm} · any thin atmosphere`,
          });
        }
      }
    } else if (codexListMeansAll(allowed)) {
      reasons.push({
        field: "AtmosphereType",
        detail:
          atmoNorm === ""
            ? "(none / vacuum) · codex allows ALL atmospheres"
            : `${atmoNorm} · codex allows ALL atmospheres`,
      });
    } else {
      const vacuumAllowed = allowed.some((a) => !(a ?? "").trim());
      if (!atmoNorm && !vacuumAllowed) {
        failures.push({
          field: "AtmosphereType",
          detail:
            "This species defines allowed atmospheres — journal scan must include AtmosphereType after detailed scan.",
        });
      } else {
        const scanKey = atmosphereCompositionKey(atmoNorm);
        const matches =
          (atmoNorm === "" && vacuumAllowed) ||
          (atmoNorm !== "" &&
            allowed.some((a) => {
              if (!a?.trim()) return false;
              if (a === atmoNorm) return true;
              if (a.toLowerCase() === atmoNorm.toLowerCase()) return true;
              return atmosphereCompositionKey(a) === scanKey;
            }));
        if (!matches) {
          const allowedStr = allowed.map((a) => (a === "" ? "(no atmosphere)" : a)).join(", ");
          /**
           * Not a wall either. This list rejects only 0.33% of observed habitats (103 of 30,803), so
           * it is a far better list than the planet-class one - but Stratum tectonicas, the
           * highest-payout species in the game, grows in its canonical thin CO2 just 40.2% of the
           * time. A wall here hides the best find in exobiology on a body it really lives on.
           */
          failures.push({
            field: "AtmosphereType",
            soft: true,
            detail: `Codex lists ${allowedStr}; got ${atmoNorm === "" ? "(none)" : atmoNorm}. ${DEMOTED_NOTE}`,
          });
        } else {
          reasons.push({ field: "AtmosphereType", detail: atmoNorm === "" ? "(none / vacuum)" : atmoNorm });
        }
      }
    }
  }

  if (GENUS_DATA_DIR_REQUIRING_NO_ATMOSPHERE.has(entry.genusDataDir) && atmoNorm !== "") {
    const raw = (scan.AtmosphereType ?? "").trim();
    failures.push({
      field: "AtmosphereType",
      detail: `Brain trees only appear on airless worlds; journal has “${raw || "…"}”.`,
    });
  }

  if (c.landable === true && scan.Landable === false) {
    failures.push({ field: "Landable", detail: "Body not landable in journal" });
  }
  if (c.landable === true && scan.Landable) {
    reasons.push({ field: "Landable", detail: "Yes" });
  }

  const genusNeedsVolcano = GENUS_DATA_DIR_REQUIRING_VOLCANISM.has(entry.genusDataDir);
  const criteriaVolcanoFragments = !!(c.volcanismIncludes && c.volcanismIncludes.length > 0);
  const explicitVolcanoRequired = c.volcanismActiveRequired === true;

  /**
   * What the corpus has watched this species grow with, which overrules both codex claims about
   * volcanism — that there is any, and which kind (§42).
   *
   * Bacterium tela is why the first claim needs overruling: its codex row requires volcanism and 177
   * of its 214 observed bodies have none. Fumerola extremus is why the second does: 10 of its 43 are
   * metallic magma, which its fragment list does not admit.
   */
  const volcanismSeen = observedWithVolcanism(entry, scan.Volcanism);

  if (
    (genusNeedsVolcano || criteriaVolcanoFragments || explicitVolcanoRequired) &&
    !journalReportsAnyVolcanism(scan)
  ) {
    /**
     * Deliberately *not* rescued by observation, unlike the type below.
     *
     * Bacterium tela has 177 of 214 observed bodies with no volcanism against a codex row that
     * requires some, so the row looks as wrong as the others in this family. Overruling it was built
     * and measured: one more species found, 0.96 more candidates on every body, and precision down
     * 6.6 points — "requires volcanism" is load-bearing across many species at once in a way the
     * type list is not.
     */
    {
      failures.push({
        field: "Volcanism",
        detail: genusNeedsVolcano
          ? "This genus requires active volcanism; journal has an empty or missing Volcanism field (treated as no volcanism)."
          : explicitVolcanoRequired && !criteriaVolcanoFragments
            ? "Species criteria require active volcanism; journal has none listed."
            : `Species criteria require volcanism (${(c.volcanismIncludes ?? []).join(" / ")}); journal has no volcanism listed.`,
      });
    }
  }

  if (criteriaVolcanoFragments) {
    const okV = volcanismJournalMatchesFragments(scan.Volcanism, c.volcanismIncludes!);
    if (okV) {
      reasons.push({ field: "Volcanism", detail: scan.Volcanism || "" });
    } else if (volcanismSeen) {
      reasons.push({
        field: "Volcanism",
        detail: `${scan.Volcanism || "(none)"} — outside the codex list, but ${volcanismSeen.observations} of ${volcanismSeen.total} observed bodies for this species have it.`,
      });
    } else {
      failures.push({
        field: "Volcanism",
        detail: `Need fragment: ${c.volcanismIncludes!.join(" / ")}; journal: ${scan.Volcanism || "(empty)"}`,
      });
    }
  } else if (genusNeedsVolcano && journalReportsAnyVolcanism(scan)) {
    reasons.push({ field: "Volcanism", detail: scan.Volcanism || "" });
  }

  const gRaw = scan.SurfaceGravity;
  if (c.surfaceGravity && gRaw !== undefined) {
    const g = journalSurfaceGravityToG(gRaw);
    const fit = rangeFit(g, c.surfaceGravity.min, c.surfaceGravity.max);
    /**
     * Observation overrules the codex band, the fifth field to get it (§43). Unlike the four before
     * it this gate was never fatal — outside by under {@link NUMERIC_GATE_TOLERANCE} already only
     * demoted — so the rescue moves a row out from behind "show unlikely", and only for a gravity
     * the corpus has actually clustered observations at.
     */
    const observedHere = fit === "in" ? null : observedAtGravity(entry, g);
    if (observedHere) {
      reasons.push({
        field: "SurfaceGravity",
        detail: `${g.toFixed(3)} g — outside ${c.surfaceGravity.min ?? "−∞"}…${c.surfaceGravity.max ?? "∞"}, but ${observedHere.observations} of ${observedHere.total} observed bodies for this species are between ${observedHere.binLowG.toFixed(3)} and ${observedHere.binHighG.toFixed(3)} g.`,
      });
    } else if (fit !== "in") {
      failures.push({
        field: "SurfaceGravity",
        ...(fit === "near" ? { soft: true } : {}),
        detail: `${g.toFixed(3)} g (journal ${gRaw.toFixed(2)} m/s²) outside ${c.surfaceGravity.min ?? "−∞"}…${c.surfaceGravity.max ?? "∞"}${fit === "near" ? `, by under ${NUMERIC_GATE_TOLERANCE * 100}%. ${DEMOTED_NOTE}` : ""}`,
      });
    } else {
      reasons.push({
        field: "SurfaceGravity",
        detail: `${g.toFixed(3)} g (${gRaw.toFixed(2)} m/s²)`,
      });
    }
  }

  /**
   * Host star, measured against the corpus rather than against the codex.
   *
   * Computed once for all three star rules below: the codex fragment list, the genus colour table
   * and the observation term itself. See {@link hostStarVerdict}.
   */
  const starVerdict = ctx?.parentStarType?.trim()
    ? hostStarVerdict(entry, ctx.parentStarType)
    : ({ kind: "unknown" } as HostStarVerdict);

  const starFrags = c.parentStarTypeIncludesAnyOf;
  if (starFrags?.length && ctx?.parentStarType?.trim()) {
    const host = ctx.parentStarType.toLowerCase();
    const okStar = starFrags.some((f) => host.includes((f ?? "").trim().toLowerCase()));
    if (!okStar && starVerdict.kind === "observed") {
      // The corpus has watched this species grow under this star. A codex list that disagrees is a
      // gap in the community record, not a reason to demote the row.
      reasons.push({
        field: "StarType",
        detail: `${ctx.parentStarType} — outside the codex list, but ${starVerdict.observations} of ${starVerdict.total} observed bodies have this host class.`,
      });
    } else if (!okStar) {
      // Soft: the codex star list is a claim about where a species has been *recorded*, and §6 took
      // every such claim out of the wall business. It demotes the row; it does not delete it.
      failures.push({
        field: "StarType",
        soft: true,
        detail: `Host star type “${ctx.parentStarType}” — need codex fragment: ${starFrags.join(" / ")}.`,
      });
    } else {
      reasons.push({ field: "StarType", detail: ctx.parentStarType });
    }
  }

  const starColorNulls = entry.genusStarColorNullSpectralClasses;
  if (starColorNulls?.length && ctx?.parentStarType?.trim()) {
    const specKeys = spectralKeysFromJournalStarType(ctx.parentStarType);
    if (specKeys.length) {
      const excluded = specKeys.some((k) => starColorNulls.some((n) => n.toUpperCase() === k.toUpperCase()));
      if (excluded && starVerdict.kind === "observed") {
        // Stratum araneamus has no A-type colour variant in the genus table and 48 % of its observed
        // bodies orbit an A-type star. The missing artwork is ours; the species is really there.
        reasons.push({
          field: "StarType",
          detail: `${ctx.parentStarType} — no colour variant in our genus table, but ${starVerdict.observations} of ${starVerdict.total} observed bodies have this host class.`,
        });
      } else if (excluded) {
        // Also soft. A missing colour variant is a gap in the genus table, not evidence that the
        // species cannot grow there — and it is the app's own data saying so.
        failures.push({
          field: "StarType",
          soft: true,
          detail: `Genus colour table has no variant for host class ${specKeys.join("/")} — “${ctx.parentStarType}”.`,
        });
      }
    }
  }

  /**
   * The observation term: never seen under this kind of star, on a species where the star decides.
   *
   * Soft, so the row lands in the unlikely tier rather than vanishing — the corpus holds tens of
   * bodies for these species, and tens of bodies cannot prove a negative about the galaxy.
   */
  if (starVerdict.kind === "never" && ctx?.parentStarType?.trim()) {
    failures.push({
      field: "StarType",
      soft: true,
      detail: `Host star ${ctx.parentStarType}: none of the ${starVerdict.total} observed bodies for this species have that host class (seen on ${starVerdict.classes.join("/")}). ${DEMOTED_NOTE}`,
    });
  } else if (starVerdict.kind === "observed" && starVerdict.share >= 0.1) {
    reasons.push({
      field: "StarType",
      detail: `${ctx?.parentStarType} — ${Math.round(starVerdict.share * 100)}% of ${starVerdict.total} observed bodies have this host class.`,
    });
  }

  const orb = c.orbitDistanceFromParentStarLs;
  if (orb && (orb.min !== undefined || orb.max !== undefined) && ctx?.orbitDistanceFromParentStarLs != null) {
    const v = ctx.orbitDistanceFromParentStarLs;
    const fit = rangeFit(v, orb.min, orb.max);
    if (fit !== "in") {
      // Soft either way: the codex orbit range is one more claim about where a species has been
      // seen, and a body outside it is a candidate to rank low rather than one to hide (§6).
      failures.push({
        field: "Orbit",
        soft: true,
        detail: `Orbit ${v.toFixed(0)} LS from host star — species expects ${orb.min ?? "−∞"}…${orb.max ?? "∞"} LS (semi-major axis → LS).${fit === "near" ? ` Within ${NUMERIC_GATE_TOLERANCE * 100}%. ${DEMOTED_NOTE}` : ""}`,
      });
    } else {
      reasons.push({ field: "Orbit", detail: `${v.toFixed(0)} LS from host` });
    }
  }

  const cat = c.atmospherePressureCategory;
  if (cat && ctx?.surfacePressureAtm != null && Number.isFinite(ctx.surfacePressureAtm)) {
    const p = ctx.surfacePressureAtm;
    if (cat === "thin" && p > THIN_ATMOSPHERE_MAX_ATM) {
      const near = rangeFit(p, undefined, THIN_ATMOSPHERE_MAX_ATM) === "near";
      failures.push({
        field: "SurfacePressure",
        ...(near ? { soft: true } : {}),
        detail: `Thin atmosphere gate: ${p.toFixed(3)} atm > ${THIN_ATMOSPHERE_MAX_ATM} atm (after journal → atm conversion).${near ? ` ${DEMOTED_NOTE}` : ""}`,
      });
    } else if (cat === "thick" && p <= THIN_ATMOSPHERE_MAX_ATM) {
      const near = rangeFit(p, THIN_ATMOSPHERE_MAX_ATM, undefined) === "near";
      failures.push({
        field: "SurfacePressure",
        ...(near ? { soft: true } : {}),
        detail: `Thick atmosphere gate: ${p.toFixed(3)} atm ≤ ${THIN_ATMOSPHERE_MAX_ATM} atm.${near ? ` ${DEMOTED_NOTE}` : ""}`,
      });
    } else {
      reasons.push({ field: "SurfacePressure", detail: `${cat} (${p.toFixed(3)} atm)` });
    }
  }

  const geos = c.geologicalSignalIncludes;
  if (geos?.length && ctx?.signalHints?.length) {
    const hints = ctx.signalHints;
    const okGeo = geos.some((frag) => {
      const f = (frag ?? "").trim().toLowerCase();
      return f && hints.some((h) => h.includes(f));
    });
    if (!okGeo) {
      failures.push({
        field: "Signals",
        detail: `FSS/DSS signals must include one of: ${geos.join(" / ")}.`,
      });
    } else {
      reasons.push({ field: "Signals", detail: `Scanner: matched ${geos.join(", ")}` });
    }
  }

  if (failures.length > 0) {
    return {
      ok: false,
      reasons: failures,
      softOnly: failures.every((f) => f.soft === true),
      passed: reasons,
    };
  }

  if (entry.dataSourceRelPath) {
    reasons.push({ field: "Source", detail: entry.dataSourceRelPath });
  }

  if (c.matchContextNotes?.length) {
    for (const n of c.matchContextNotes) {
      if (n?.trim()) reasons.push({ field: "Note", detail: n.trim() });
    }
  }

  return { ok: true, reasons };
}

/**
 * Strict match: temp/pressure are hard gates using estimated surface band vs species range.
 */
export function speciesMatchesCriteria(
  entry: SpeciesEntry,
  scan: PlanetScan,
  planetTempBand: PlanetTemperatureBand | null,
  estimatedRange: { tMin: number; tMax: number; tMid: number } | null,
  matchContext?: SpeciesMatchContext | null,
): CriteriaMatchResult {
  const base = speciesMatchesExcludingTempPressure(entry, scan, matchContext);
  const failures: MatchReason[] = base.ok ? [] : [...base.reasons];
  const basePassed = base.ok ? base.reasons : (base.passed ?? []);
  const extraOkReasons: MatchReason[] = [];
  const c = entry.criteria;

  if (speciesNeedsTemperatureGate(c)) {
    const band = speciesTempBand(c)!;
    if (!planetTempBand) {
      failures.push({
        field: "SurfaceTemperature",
        detail:
          "This species defines a temperature range — need SurfaceTemperature (or a mappable PlanetClass) to estimate the surface band.",
      });
    } else if (!tempBandsOverlap(planetTempBand, band)) {
      // Our surface temperature is frequently an estimate, not a measurement; a 2% gap is inside the
      // estimator's own error, never mind the codex rounding.
      const near = tempBandsOverlapWithinTolerance(planetTempBand, band);
      const speciesRange = `${band.lo === OPEN_LO ? "≤" : ""}${band.lo === OPEN_LO ? band.hi : band.lo}${band.lo !== OPEN_LO && band.hi !== OPEN_HI ? "–" : ""}${band.hi === OPEN_HI ? "" : band.hi} K`;
      const measured = scan.SurfaceTemperature != null && !Number.isNaN(scan.SurfaceTemperature);
      const estNote = measured
        ? `Journal reads ${planetTempBand.minK.toFixed(1)} K; species range is ${speciesRange}.`
        : estimatedRange
          ? `No journal temperature — estimated band ${planetTempBand.minK}–${planetTempBand.maxK} K (mid ~${estimatedRange.tMid} K) does not overlap species ${speciesRange}.`
          : `Planet band ${planetTempBand.minK}–${planetTempBand.maxK} K does not overlap species range.`;
      /**
       * Observation overrules the codex band, as it does for the host star (§27) and the planet
       * class (§40). Fungoida stabitis is the case: codex 180–195 K, found nine times above 424 K,
       * and the corpus holds 945 bodies for it spanning 79–467 K.
       */
      const observedHere = observedAtTemperature(entry, scan.SurfaceTemperature);
      if (observedHere) {
        extraOkReasons.push({
          field: "SurfaceTemperature",
          detail: `${scan.SurfaceTemperature!.toFixed(1)} K — outside the codex ${speciesRange}, but ${observedHere.observations} of ${observedHere.total} observed bodies sit between ${observedHere.binLowK.toFixed(0)} and ${observedHere.binHighK.toFixed(0)} K.`,
        });
      } else {
        failures.push({
          field: "SurfaceTemperature",
          ...(near ? { soft: true } : {}),
          detail: near ? `${estNote} Within ${NUMERIC_GATE_TOLERANCE * 100}%. ${DEMOTED_NOTE}` : estNote,
        });
      }
    } else {
      const surf = scan.SurfaceTemperature;
      const bandTxt =
        surf != null && !Number.isNaN(surf)
          ? `${surf.toFixed(1)} K (journal) is inside the species range`
          : `Estimated band ${planetTempBand.minK}–${planetTempBand.maxK} K overlaps the species range (no journal reading)`;
      extraOkReasons.push({ field: "SurfaceTemperature", detail: bandTxt });
    }
  } else if (scan.SurfaceTemperature != null) {
    extraOkReasons.push({
      field: "SurfaceTemperature",
      detail: `${scan.SurfaceTemperature.toFixed(1)} K (no species temp gate)`,
    });
  }

  const linkedMax = c.whenAtmosphereLinkedMaxTempK;
  const linkedAtmo = c.whenAtmosphereLinkedAtmosphereAnyOf;
  if (linkedMax !== undefined) {
    const applies = linkedAtmo?.length
      ? (() => {
          const atmoNorm = normalizeScanAtmosphereForMatch(scan);
          const scanKey = atmosphereCompositionKey(atmoNorm);
          const vacuumAllowed = linkedAtmo.some((a) => !(a ?? "").trim());
          if (!atmoNorm && vacuumAllowed) return true;
          return linkedAtmo.some((a) => {
            if (!a?.trim()) return false;
            if (a === atmoNorm) return true;
            if (a.toLowerCase() === atmoNorm.toLowerCase()) return true;
            return atmosphereCompositionKey(a) === scanKey;
          });
        })()
      : !!c.atmosphereTypeAnyOf?.length;

    if (applies) {
      if (!planetTempBand) {
        failures.push({
          field: "SurfaceTemperature",
          detail:
            "Atmosphere-linked temperature cap needs SurfaceTemperature (or a mappable PlanetClass) to estimate the surface band.",
        });
      } else if (planetTempBand.maxK > linkedMax) {
        const near = rangeFit(planetTempBand.maxK, undefined, linkedMax) === "near";
        failures.push({
          field: "SurfaceTemperature",
          ...(near ? { soft: true } : {}),
          detail: `With matching atmosphere, codex caps the mean band at ≤ ${linkedMax} K (estimated band max ${planetTempBand.maxK.toFixed(0)} K).${near ? ` Within ${NUMERIC_GATE_TOLERANCE * 100}%. ${DEMOTED_NOTE}` : ""}`,
        });
      } else {
        const atNote = linkedAtmo?.length ? ` (${linkedAtmo.join(" / ")})` : "";
        extraOkReasons.push({
          field: "SurfaceTemperature",
          detail: `Atmosphere-linked cap ≤ ${linkedMax} K satisfied (band max ${planetTempBand.maxK.toFixed(0)} K)${atNote}`,
        });
      }
    }
  }

  const p = scan.SurfacePressure;
  if (c.surfacePressure && (c.surfacePressure.min !== undefined || c.surfacePressure.max !== undefined)) {
    if (p === undefined || p === null) {
      failures.push({
        field: "SurfacePressure",
        detail: "This species defines a pressure range — need SurfacePressure from the detailed scan.",
      });
    } else if (rangeFit(p, c.surfacePressure.min, c.surfacePressure.max) !== "in") {
      const near = rangeFit(p, c.surfacePressure.min, c.surfacePressure.max) === "near";
      failures.push({
        field: "SurfacePressure",
        ...(near ? { soft: true } : {}),
        detail: `${p.toFixed(2)} atm outside allowed ${c.surfacePressure.min ?? "−∞"}…${c.surfacePressure.max ?? "∞"}${near ? `, by under ${NUMERIC_GATE_TOLERANCE * 100}%. ${DEMOTED_NOTE}` : ""}`,
      });
    } else {
      extraOkReasons.push({ field: "SurfacePressure", detail: `${p.toFixed(2)} atm` });
    }
  }

  if (failures.length > 0) {
    return {
      ok: false,
      reasons: failures,
      softOnly: failures.every((f) => f.soft === true),
      passed: [...basePassed, ...extraOkReasons],
    };
  }

  return { ok: true, reasons: [...base.reasons, ...extraOkReasons] };
}

/**
 * The tier the app shows by default.
 *
 * Since planet class and atmosphere stopped being walls, `matches` carries demoted rows too. Any
 * calculation that stands in for "what is on this body" — payout ranges, map value tiers, whether
 * the foot catalog needs to fill a gap — has to use this, or a 19 M Stratum listed at low
 * probability starts setting the expected value of every planet it disagrees with.
 */
export function shownSpeciesMatches<T extends { unlikely?: boolean }>(matches: T[]): T[] {
  return matches.filter((m) => !m.unlikely);
}

export interface MatchDatabaseRun {
  matches: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[];
  genusFilterActive: boolean;
  dssGenusNarrowing: boolean;
  estimatedSurfaceTempK: EstimatedSurfaceTempBand | null;
  approximateMatchingUsed: boolean;
}

type PendingMatch = Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">;

/**
 * Never let a demotion contradict the game's own signal count.
 *
 * The observation term demotes a species that has never been seen under this kind of star, and on a
 * handful of bodies that took the shown list below the number of genera the game reports — which is
 * impossible, and shows up in the probe as a provable data defect. The count is not a preference:
 * `k` genera are down there whatever our corpus has seen.
 *
 * So demotions are handed back, weakest evidence first, until the shown list can satisfy the count
 * again. Only rows demoted *solely* by the host-star observation term are eligible: a candidate that
 * also disagrees on temperature or planet class was not demoted by this and must not be rescued by
 * it. Restoring by ascending determinism means the species whose host star matters least gives way
 * first, which is the same ordering the demotion itself was decided on.
 */
function restoreDemotionsBelowSignalCount(
  strict: PendingMatch[],
  unlikely: PendingMatch[],
  signalCount: number | null,
): void {
  if (signalCount == null || !Number.isFinite(signalCount) || signalCount <= 0) return;

  const generaOf = (rows: PendingMatch[]) =>
    new Set(rows.filter((m) => !m.entry.predictionUnsupported).map((m) => m.entry.genusDataDir));
  if (generaOf(strict).size >= signalCount) return;

  const eligible = unlikely
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => (m.unlikelyReasons ?? []).every((r) => r.field === "StarType"))
    .sort((a, b) => hostStarDeterminism(a.m.entry) - hostStarDeterminism(b.m.entry));

  const restored = new Set<number>();
  for (const { m, i } of eligible) {
    if (generaOf(strict).size >= signalCount) break;
    strict.push({ entry: m.entry, reasons: m.reasons });
    restored.add(i);
  }
  if (restored.size === 0) return;
  const keep = unlikely.filter((_, i) => !restored.has(i));
  unlikely.length = 0;
  unlikely.push(...keep);
}

function hostStarDeterminism(entry: SpeciesEntry): number {
  return speciesHostStarObservations(entry)?.determinism ?? 0;
}

export function matchDatabaseToScan(
  db: SpeciesDatabase,
  scan: PlanetScan,
  genusHints: GenusHint[] | null,
  organicGenusLocks: OrganicGenusLock[] | null | undefined,
  options?: {
    includeBacterium?: boolean;
    matchContext?: SpeciesMatchContext | null;
    /**
     * `FSSBodySignals` biological count for this body, when the game has reported one.
     *
     * The game places one genus per signal, so the count is a hard fact about the body and the
     * candidate list has to be able to satisfy it. Supplied here so a demotion can be undone when it
     * would leave fewer candidate genera than the game says are present — see
     * {@link restoreDemotionsBelowSignalCount}.
     */
    biologicalSignals?: number | null;
  },
): MatchDatabaseRun {
  const includeBacterium = options?.includeBacterium === true;
  const matchContext = options?.matchContext ?? null;
  const species = includeBacterium ? db.species : db.species.filter((e) => !isBacteriumSpeciesEntry(e));

  let narrowed = filterByGenusHints(species, genusHints);
  /**
   * When DSS lists Bacterium (or bacterial codex hints), optionally keep bacterium rows alongside
   * other DSS genera. If DSS does not mention bacterium, do not re-inject it here — genus filter stands.
   */
  if (includeBacterium && dssHintsIncludeBacterium(genusHints)) {
    const bacteriumRows = species.filter(isBacteriumSpeciesEntry);
    const seen = new Set(narrowed.map((e) => e.id));
    for (const e of bacteriumRows) {
      if (!seen.has(e.id)) {
        narrowed.push(e);
        seen.add(e.id);
      }
    }
  }
  narrowed = applyOrganicGenusLocks(narrowed, organicGenusLocks, db);
  if (
    includeBacterium &&
    !dssHintsIncludeBacterium(genusHints) &&
    organicScanConfirmsNonBacteriumGenus(organicGenusLocks, db)
  ) {
    narrowed = narrowed.filter((e) => !isBacteriumSpeciesEntry(e));
  }
  const genusFilterActive = !!(genusHints && genusHints.length);
  const dssGenusNarrowing = genusFilterActive;

  const est = estimatedTemperatureRangeForScan(scan);
  const estimatedSurfaceTempK: EstimatedSurfaceTempBand | null = est
    ? { minK: est.tMin, maxK: est.tMax, midK: est.tMid }
    : scan.SurfaceTemperature != null
      ? (() => {
          const t = Math.round(scan.SurfaceTemperature!);
          return { minK: t, maxK: t, midK: t };
        })()
      : null;

  const planetTempBand = resolvePlanetTemperatureBand(scan, est);

  const strict: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[] = [];
  /**
   * Candidates whose only failures are weighted terms rather than walls. They are listed, tagged
   * with what demoted them, and collapsed behind "show unlikely (N)" in the UI - never deleted.
   * See {@link MatchReason.soft}: the planet-class list alone rejected 4.14% of the bodies where
   * the species was actually observed.
   */
  const unlikely: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[] = [];
  for (const entry of narrowed) {
    const r = speciesMatchesCriteria(entry, scan, planetTempBand, est, matchContext);
    if (r.ok) {
      strict.push({ entry, reasons: r.reasons });
    } else if (r.softOnly) {
      unlikely.push({
        entry,
        reasons: [...(r.passed ?? []), ...r.reasons],
        unlikely: true,
        unlikelyReasons: r.reasons,
      });
    }
  }

  restoreDemotionsBelowSignalCount(strict, unlikely, options?.biologicalSignals ?? null);

  if (strict.length > 0 || unlikely.length > 0) {
    const { matches, injected } = injectOrganicLockConfirmedSpecies(
      [...strict, ...unlikely],
      organicGenusLocks,
      db,
    );
    return {
      matches,
      genusFilterActive,
      dssGenusNarrowing,
      estimatedSurfaceTempK,
      // A demoted row is a real candidate with a named reason, not a distance guess, so it does not
      // put the whole panel into "approximate" mode.
      approximateMatchingUsed: injected,
    };
  }

  /**
   * Nothing matched, not even softly.
   *
   * There used to be four fallbacks here — DSS physical slack, nearest-by-temperature, a lone-genus
   * temperature stretch, and a closest-by-distance list capped at 8 — all of them compensation for a
   * strict path that returned nothing too often. Measured across 13,713 scanned bodies at every
   * slack setting, every one of them now fires **zero times**: once planet class and atmosphere
   * demote instead of excluding, something almost always lands in the unlikely tier, and exactly one
   * body in the whole corpus comes back empty.
   *
   * Guessing was the right answer to an empty list. It is the wrong answer to a list that is empty
   * because the body genuinely contradicts every species we know.
   */
  const { matches } = injectOrganicLockConfirmedSpecies([], organicGenusLocks, db);
  return {
    matches,
    genusFilterActive,
    dssGenusNarrowing,
    estimatedSurfaceTempK,
    approximateMatchingUsed: matches.length > 0,
  };
}
