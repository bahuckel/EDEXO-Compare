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
import { describeSystemBodyVerdict, evaluateSystemBodyGate } from "../shared/systemBodyGates.js";
import {
  REQUIRED_GAS_MIN_SHARE_PCT,
  requiredAtmosphereShare,
  gasSharePercent,
} from "../shared/atmosphereGasShare.js";
export { REQUIRED_GAS_MIN_SHARE_PCT } from "../shared/atmosphereGasShare.js";
import {
  describePresenceBranches,
  evaluatePresenceBranch,
  describeBodyForPresence,
} from "../shared/presenceBranches.js";
export { PRESENCE_BRANCH_FIELDS } from "../shared/presenceBranches.js";
import { atmosphereIsUnfavoured } from "../shared/atmospherePreference.js";
import { journalSurfaceGravityToG, THIN_ATMOSPHERE_MAX_ATM, journalPressureToAtm } from "../shared/journalPhysics.js";
import {
  describeVerdict,
  evaluateSpatialGate,
  gateForSpeciesId,
  type SpatialCatalogue,
} from "../shared/spatialGates.js";
import {
  describeHostStarVerdict,
  evaluateHostStarGate,
  hostStarGateForSpeciesId,
} from "../shared/hostStarGates.js";
import { observedAtGravity } from "./speciesGravityObservations.js";
import { regionalGenusShare, regionalPresence } from "./regionSpeciesData.js";
import { regionPresenceDetail, regionGenusShareDetail } from "../shared/regionAbsence.js";
import { getProjectRoot } from "./paths.js";
import { observedUnderAtmosphere } from "./speciesAtmosphereObservations.js";
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
import {
  MIN_TEMPERATURE_OBSERVATIONS,
  NEAR_TEMPERATURE_WINDOW_K,
  observedAtTemperature,
  observedNearTemperature,
} from "./speciesTemperatureObservations.js";
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

/**
 * A species' temperature band as a person would read it: `≤190 K`, `160–190 K`, `≥300 K`.
 *
 * Built by hand inline once, and the open-low case printed the ceiling twice — a commander looking
 * at why Tubus was demoted on a 193 K body was told "species range is ≤190190 K". The number was
 * right and unreadable, which is the worst way for an explanation to fail: it looks like the app is
 * confused rather than the sentence.
 */
export function describeTempBand(band: { lo: number; hi: number }): string {
  const openLo = band.lo === OPEN_LO;
  const openHi = band.hi === OPEN_HI;
  if (openLo && openHi) return "any temperature";
  if (openLo) return `≤${band.hi} K`;
  if (openHi) return `≥${band.lo} K`;
  return `${band.lo}–${band.hi} K`;
}

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

/**
 * How much of a gas has to be in the mix before a plant can be said to live in it.
 *
 * Reported from the field: a body whose atmosphere is 99 % CO₂ and 0.99 % SO₂ is not a sulphur
 * dioxide world, and offering the SO₂-only genus there wastes a trip. Five per cent is the owner's
 * line and it is the only number in this file that came from playing the game rather than from
 * measuring the corpus, which is why it is named rather than inlined.
 */
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

/**
 * Does the corpus place this species on the body's side of a codex temperature edge?
 *
 * `observedAtTemperature` answers from a display bin, and a display bin is wide — 18 K for Stratum
 * cucumisis. Where that bin lies wholly beyond the codex band (Fungoida stabitis above 424 K, the
 * case the rescue was built for) its observations are on the body's side, and it answers as before.
 * Where it **straddles** the edge it cannot: cucumisis's bin 180-198 K held 175 sightings, its own
 * bodies sit at 191 K and above on 99.7 % of 312, and the bin was admitting it on every 180-189 K
 * body — exactly where Stratum excutitus and limaxus live.
 *
 * So a straddling bin hands the question to the fine histogram: sightings within
 * `NEAR_TEMPERATURE_WINDOW_K` of the body and beyond the edge, measured against the same floor.
 * Paleas at 162.1 K finds the 33 bodies recorded at 162.6-165 K and is rescued; cucumisis at 184 K
 * finds none and is demoted — softly, since a thin record is not an impossibility.
 */
function sightingsBeyondEdge(
  entry: SpeciesEntry,
  obs: { binLowK: number; binHighK: number },
  kelvin: number,
  lo: number | undefined,
  hi: number | undefined,
): { straddles: boolean; near: number | null } {
  if (lo !== undefined && kelvin < lo) {
    if (obs.binHighK <= lo) return { straddles: false, near: null };
    return { straddles: true, near: observedNearTemperature(entry, kelvin, { below: lo }) };
  }
  if (hi !== undefined && kelvin > hi) {
    if (obs.binLowK >= hi) return { straddles: false, near: null };
    return { straddles: true, near: observedNearTemperature(entry, kelvin, { above: hi }) };
  }
  return { straddles: false, near: null };
}

function speciesNeedsTemperatureGate(c: SpeciesCriterion): boolean {
  return speciesTempBand(c) !== null;
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
export function resolvePlanetTemperatureBand(
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
           *
           * Nor even a demotion when the corpus has watched this species grow under the atmosphere
           * anyway (§44) — the last of the six fields to get the §27 treatment, and the most
           * cautious of them, because 0.33 % is a good list. The floor there rules out a mislabel
           * rather than weighing a distribution.
           */
          const observedHere = observedUnderAtmosphere(entry, atmoNorm);
          if (observedHere) {
            reasons.push({
              field: "AtmosphereType",
              detail: `${atmoNorm} — outside the codex list, but ${observedHere.observations} of ${observedHere.total} observed bodies for this species are ${observedHere.label}.`,
            });
          } else {
            failures.push({
              field: "AtmosphereType",
              soft: true,
              detail: `Codex lists ${allowedStr}; got ${atmoNorm === "" ? "(none)" : atmoNorm}. ${DEMOTED_NOTE}`,
            });
          }
        } else {
          reasons.push({ field: "AtmosphereType", detail: atmoNorm === "" ? "(none / vacuum)" : atmoNorm });
        }
      }
    }
  }

  /**
   * How much of the air is actually the gas — the question `AtmosphereType` cannot answer.
   *
   * The type names the **dominant** gas, and a trailing `Rich` means the named gas is there but
   * something else dominates: across 8,000 journal scans `NeonRich` air averages **5.5 % neon** and
   * never exceeds 49.74 %. Both the loader and `atmosphereCompositionKey` fold that suffix away,
   * which is right for most species and hides the only thing separating a few pairs of them:
   *
   * ```
   * Fonticulua campestris   argon 51.97 – 100.00 %    761 bodies
   * Fonticulua upupam       argon  0.36 –  49.68 %     56 bodies
   * ```
   *
   * Two ranges that do not touch, on one folded label. Upupam had been sitting at 15-17 % on bodies
   * that were unmistakably its own, because nothing in the matcher could see the difference.
   *
   * **Soft**, like every atmosphere verdict here — the band demotes with its number shown rather
   * than deleting the row, and a foot sample there lifts it back (`sampledHere`).
   */
  const gasBands = c.atmosphereGasSharePct;
  if (gasBands?.length) {
    const comp = scan.atmosphereComposition;
    // No composition, no opinion. Every scan measured carries it, but a cached or pre-Odyssey one
    // may not, and a rejection invented from missing data is worse than a rare body let through.
    if (Array.isArray(comp) && comp.length > 0) {
      for (const band of gasBands) {
        const pct = gasSharePercent(scan, band.gas) ?? 0;
        const belowMin = band.min !== undefined && pct < band.min;
        const aboveMax = band.max !== undefined && pct > band.max;
        if (!belowMin && !aboveMax) {
          reasons.push({
            field: "AtmosphereType",
            detail: `${band.gas} ${pct.toFixed(1)} % of the atmosphere${
              band.min !== undefined && band.max !== undefined
                ? ` (needs ${band.min}-${band.max} %)`
                : band.min !== undefined
                  ? ` (needs ≥ ${band.min} %)`
                  : ` (needs ≤ ${band.max} %)`
            }`,
          });
          continue;
        }
        const want =
          band.min !== undefined && band.max !== undefined
            ? `${band.min}-${band.max} %`
            : belowMin
              ? `at least ${band.min} %`
              : `at most ${band.max} %`;
        failures.push({
          field: "AtmosphereType",
          soft: true,
          detail: `${entry.displayName} needs ${want} ${band.gas}; this body is ${pct.toFixed(2)} % — every observed body for it sits inside that band. ${DEMOTED_NOTE}`,
        });
      }
    }
  }

  /**
   * A gas the genus cannot live without, measured against how much of it is actually there.
   *
   * Recepta needs sulphur dioxide. Blu Thua EM-D d12-25 A 1 a is a **carbon dioxide** body — 99.01 %
   * CO₂ — that carries 0.99 % SO₂ in the mix, and both Recepta species were offered on the shown
   * list. Two separate things were wrong with that. The atmosphere test only ever read
   * `AtmosphereType`, which names the *dominant* gas and so says nothing about the trace; and the
   * observation floor was then overruling the miss anyway, on the strength of corpus bodies
   * labelled "Thin Carbon dioxide".
   *
   * So: read the composition, and require **{@link REQUIRED_GAS_MIN_SHARE_PCT} %** of it before the
   * gas counts as an atmosphere something can grow in. One per cent is a trace, not a habitat.
   *
   * Soft, not a wall. A trace of the right gas is a long shot rather than an impossibility, and the
   * app already has a place for long shots — the unlikely tier, behind "show unlikely (N)". The
   * commander asked for exactly that: hidden below with the others, not deleted.
   */
  const requiredAtmo = c.atmosphereTypeRequiredAnyOf;
  if (requiredAtmo?.length) {
    const verdict = requiredAtmosphereShare(scan, atmoNorm, requiredAtmo);
    if (verdict.kind !== "ok") {
      failures.push({
        field: "AtmosphereType",
        soft: true,
        detail:
          verdict.kind === "trace"
            ? `${entry.genus} needs ${requiredAtmo.join(" / ")}; this body has ${(verdict.pct ?? 0).toFixed(2)} % of it in a ${atmoNorm || "(none)"} atmosphere — below the ${REQUIRED_GAS_MIN_SHARE_PCT} % a spawn needs. ${DEMOTED_NOTE}`
            : `${entry.genus} needs ${requiredAtmo.join(" / ")}; journal has ${atmoNorm === "" ? "(none)" : atmoNorm}. ${DEMOTED_NOTE}`,
      });
    } else if (verdict.pct != null) {
      reasons.push({
        field: "AtmosphereType",
        detail: `${verdict.gas} ${verdict.pct.toFixed(1)} % of the atmosphere`,
      });
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

  /**
   * Region: what actually grows here, as opposed to what could.
   *
   * The last gate, and the only one that asks a question about the galaxy rather than about the rock
   * under the ship. Conditions cannot separate two species that share a codex row and live half a
   * galaxy apart — on Blu Thua EM-D d12-25 A 1 a they admitted twenty species for nine signals, and
   * every loser the owner named was a region miss. Tussock caputus has 22,026 records in Inner Orion
   * Spur; Tussock pennatis has five.
   *
   * Soft, and quiet when it does not know: `unknown` covers every region the corpus has barely
   * touched, and somebody has to be the first to record a species somewhere. See
   * `shared/regionAbsence.ts` for the two thresholds and how they were measured.
   */
  if (ctx?.regionIndex) {
    const region = regionalPresence(getProjectRoot(), ctx.regionIndex, entry.id);
    if (region?.presence === "absent") {
      failures.push({
        field: "Region",
        soft: true,
        detail: regionPresenceDetail(region.regionName, region, true),
      });
    } else if (region?.presence === "present") {
      reasons.push({ field: "Region", detail: regionPresenceDetail(region.regionName, region, false) });
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

  /*
    Presence branches, evaluated before anything else this function adds.

    They live here rather than in `speciesMatchesExcludingTempPressure` only because a branch may
    read the temperature band, which that function does not receive. Nothing about the verdict is
    conditional on the gates around it: a body that satisfies no branch does not have the species,
    whatever else it agrees with.
  */
  if (c.presenceAnyOf?.length) {
    let passedBranch: string | null = null;
    for (const branch of c.presenceAnyOf) {
      const why = evaluatePresenceBranch(branch, scan, planetTempBand);
      if (why) {
        passedBranch = why;
        break;
      }
    }
    if (passedBranch) {
      extraOkReasons.push({ field: "Presence", detail: passedBranch });
    } else {
      failures.push({
        field: "Presence",
        detail: `${describePresenceBranches(c.presenceAnyOf)} — none satisfied: ${describeBodyForPresence(scan)}`,
      });
    }
  }

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
      const speciesRange = describeTempBand(band);
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
      const edgeCheck = observedHere
        ? sightingsBeyondEdge(entry, observedHere, scan.SurfaceTemperature!, c.surfaceTemperatureK?.min, c.surfaceTemperatureK?.max)
        : null;
      // No fine histogram to ask: the display bin answers, as it always did.
      const beyond =
        !!edgeCheck &&
        (!edgeCheck.straddles || edgeCheck.near === null || edgeCheck.near >= MIN_TEMPERATURE_OBSERVATIONS);
      if (observedHere && beyond) {
        extraOkReasons.push({
          field: "SurfaceTemperature",
          detail: `${scan.SurfaceTemperature!.toFixed(1)} K — outside the codex ${speciesRange}, but ${observedHere.observations} of ${observedHere.total} observed bodies sit between ${observedHere.binLowK.toFixed(0)} and ${observedHere.binHighK.toFixed(0)} K.`,
        });
      } else if (observedHere) {
        failures.push({
          field: "SurfaceTemperature",
          soft: true,
          detail:
            `${scan.SurfaceTemperature!.toFixed(1)} K — outside the codex ${speciesRange}, and only ` +
            `${Math.round(edgeCheck?.near ?? 0)} of ${observedHere.total} observed bodies sit within ` +
            `${NEAR_TEMPERATURE_WINDOW_K} K of it on this side of the edge. ${DEMOTED_NOTE}`,
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

  /*
    The measured band: where the species actually lives, inside the codex band. Soft always — it is
    the record, and the record's edges are not impossibilities. See SpeciesCriterion.softTemperatureK.
  */
  const softBand = c.softTemperatureK;
  const tMeasured = scan.SurfaceTemperature;
  if (softBand && typeof tMeasured === "number" && Number.isFinite(tMeasured)) {
    const below = softBand.min !== undefined && tMeasured < softBand.min;
    const above = softBand.max !== undefined && tMeasured > softBand.max;
    if (below || above) {
      failures.push({
        field: "SurfaceTemperature",
        soft: true,
        detail:
          `${tMeasured.toFixed(1)} K is ${above ? `above ${softBand.max}` : `below ${softBand.min}`} K, ` +
          `where this species is rarely recorded even though the codex allows it. ${DEMOTED_NOTE}`,
      });
    }
  }

  const linkedMax = c.whenAtmosphereLinkedMaxTempK;
  const linkedMin = c.whenAtmosphereLinkedMinTempK;
  const linkedAtmo = c.whenAtmosphereLinkedAtmosphereAnyOf;
  if (linkedMax !== undefined || linkedMin !== undefined) {
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
      } else if (
        (linkedMax !== undefined && planetTempBand.maxK > linkedMax) ||
        (linkedMin !== undefined && planetTempBand.minK < linkedMin)
      ) {
        /**
         * Observation overrules the atmosphere-linked band, exactly as it overrules the flat one.
         *
         * The flat path has done this since section 27 -- Fungoida stabitis reads 180-195 K in the
         * codex and has been found nine times above 424 K -- and the linked path did not, purely
         * because no species had needed it yet. Moving Concha renibus onto the linked keys exposed
         * the asymmetry: one body where the commander actually found it fell out of the shown tier,
         * not because the rule changed but because the rescue was missing on this branch.
         *
         * So the owner's codex band is the default and measured reality still wins over it. Anything
         * else would make the correct rule score worse than the wrong one.
         */
        const observedLinkedRaw = observedAtTemperature(entry, scan.SurfaceTemperature);
        // Same rule as the flat band: a bin straddling the linked edge is not evidence for this side.
        const linkedCheck = observedLinkedRaw
          ? sightingsBeyondEdge(entry, observedLinkedRaw, scan.SurfaceTemperature!, linkedMin, linkedMax)
          : null;
        const observedLinked =
          observedLinkedRaw &&
          linkedCheck &&
          (!linkedCheck.straddles || linkedCheck.near === null || linkedCheck.near >= MIN_TEMPERATURE_OBSERVATIONS)
            ? observedLinkedRaw
            : null;
        if (observedLinkedRaw && !observedLinked) {
          failures.push({
            field: "SurfaceTemperature",
            soft: true,
            detail:
              `${(scan.SurfaceTemperature ?? 0).toFixed(0)} K is outside the codex band for this atmosphere, and only ` +
              `${Math.round(linkedCheck?.near ?? 0)} observed bodies sit within ${NEAR_TEMPERATURE_WINDOW_K} K of it on this side of the edge. ${DEMOTED_NOTE}`,
          });
        } else if (observedLinked) {
          extraOkReasons.push({
            field: "SurfaceTemperature",
            detail: `${(scan.SurfaceTemperature ?? 0).toFixed(0)} K is outside the codex band for this atmosphere, but ${observedLinked.observations} of ${observedLinked.total} observed bodies for this species sit at this temperature.`,
          });
        } else if (linkedMax !== undefined && planetTempBand.maxK > linkedMax) {
          const near = rangeFit(planetTempBand.maxK, undefined, linkedMax) === "near";
          failures.push({
            field: "SurfaceTemperature",
            ...(near ? { soft: true } : {}),
            detail: `With matching atmosphere, codex caps the mean band at ≤ ${linkedMax} K (estimated band max ${planetTempBand.maxK.toFixed(0)} K).${near ? ` Within ${NUMERIC_GATE_TOLERANCE * 100}%. ${DEMOTED_NOTE}` : ""}`,
          });
        } else if (linkedMin !== undefined && planetTempBand.minK < linkedMin) {
          /**
           * The floor half of the band, and it only exists because a species had one.
           *
           * Concha renibus reads 180-195 K **for carbon dioxide only**; water atmospheres carry no
           * temperature rule at all. Written as a flat range it gated water bodies at 438 K that the
           * codex never meant to exclude, and the only thing keeping the species visible on them was
           * an observation histogram — which vanished the moment a rebuild dropped it.
           */
          const near = rangeFit(planetTempBand.minK, linkedMin, undefined) === "near";
          failures.push({
            field: "SurfaceTemperature",
            ...(near ? { soft: true } : {}),
            detail: `With matching atmosphere, codex floors the mean band at ≥ ${linkedMin} K (estimated band min ${planetTempBand.minK.toFixed(0)} K).${near ? ` Within ${NUMERIC_GATE_TOLERANCE * 100}%. ${DEMOTED_NOTE}` : ""}`,
          });
        }
      } else {
        const atNote = linkedAtmo?.length ? ` (${linkedAtmo.join(" / ")})` : "";
        extraOkReasons.push({
          field: "SurfaceTemperature",
          detail:
            linkedMin !== undefined && linkedMax !== undefined
              ? `Atmosphere-linked band ${linkedMin}–${linkedMax} K satisfied (estimated ${planetTempBand.minK.toFixed(0)}–${planetTempBand.maxK.toFixed(0)} K)${atNote}`
              : linkedMin !== undefined
                ? `Atmosphere-linked floor ≥ ${linkedMin} K satisfied (band min ${planetTempBand.minK.toFixed(0)} K)${atNote}`
                : `Atmosphere-linked cap ≤ ${linkedMax} K satisfied (band max ${planetTempBand.maxK.toFixed(0)} K)${atNote}`,
        });
      }
    }
  }

  /*
    A pressure range, in atmospheres — the unit the species rows write.

    The scan does not always speak it: a journal `Scan` writes **pascals** and a body hydrated from
    EDSM or Spansh arrives in atmospheres. Compared raw, a 0.005 atm body read from the journal is
    "506" and clears any minimum a row could write, so the gate could only ever fire on hydrated
    data. `journalPressureToAtm` is the conversion the rest of the app already uses.

    **Soft, on every miss.** A pressure band is a measured separator, not an impossibility: Osseus
    discus lives above ~0.01 atm on 99 % of its bodies and spiralis below it on 99 %, and the 1 % on
    the wrong side are real plants. A hard gate hid them; this demotes them with the reason shown.
  */
  const rawP = scan.SurfacePressure;
  if (c.surfacePressure && (c.surfacePressure.min !== undefined || c.surfacePressure.max !== undefined)) {
    if (rawP === undefined || rawP === null) {
      failures.push({
        field: "SurfacePressure",
        detail: "This species defines a pressure range — need SurfacePressure from the detailed scan.",
      });
    } else {
      const p = journalPressureToAtm(rawP);
      const fit = rangeFit(p, c.surfacePressure.min, c.surfacePressure.max);
      const shown = p < 0.01 ? p.toFixed(4) : p.toFixed(3);
      if (fit !== "in") {
        failures.push({
          field: "SurfacePressure",
          soft: true,
          detail: `${shown} atm outside ${c.surfacePressure.min ?? "−∞"}–${c.surfacePressure.max ?? "∞"} atm${fit === "near" ? `, by under ${NUMERIC_GATE_TOLERANCE * 100}%` : ""}. ${DEMOTED_NOTE}`,
        });
      } else {
        extraOkReasons.push({ field: "SurfacePressure", detail: `${shown} atm` });
      }
    }
  }

  /*
    Outside the range this species has actually been found in — a demotion, never a gate.

    It runs last, on a row that has cleared every codex gate, and it only ever adds a *soft* failure:
    the row leaves the default panel and waits one click away with this sentence attached. Nothing is
    excluded, which is the entire difference between this and replacing the gate.

    Replacing it was measured and is worse on every headline — recall 97.9 to 97.4 %, value-weighted
    97.4 to 97.0 %, precision 43.2 to 39.4 % on *more* candidates. The codex bands are deliberately
    wider than anything yet observed and that width earns its keep. Used softly the same numbers pay:
    decidable bodies 497 to 527 (35.1 to 37.2 %), mean ambiguity 4.80 to 4.71 genera, and the two
    tiers together do not move at all — 616 found and 9 missed either way. Three species step out of
    the default panel and none is lost.

    Skipped entirely when the species has no envelope: under twenty bodies is a handful of anecdotes,
    and demoting a row against three observations would assert more than we know.
  */
  const envelope = entry.observedTemperatureK;
  const tHere = scan.SurfaceTemperature;
  if (envelope && typeof tHere === "number" && Number.isFinite(tHere) && failures.length === 0) {
    if (tHere < envelope.min || tHere > envelope.max) {
      failures.push({
        // Its own field name, not "SurfaceTemperature": the signal-count rescue has to be able to
        // tell this from a codex-gate near miss, and it reads better in the tooltip besides.
        field: "ObservedTemperature",
        soft: true,
        detail:
          `${tHere.toFixed(1)} K is outside the ${envelope.min.toFixed(0)}–${envelope.max.toFixed(0)} K ` +
          `range this species has been found in across ${envelope.count} bodies. ` +
          `The codex band still allows it. ${DEMOTED_NOTE}`,
      });
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
/**
 * A genus the DSS named keeps at least one row on the shown list.
 *
 * The surface scan is the game telling us what is down there. Every gate in this file is an
 * inference from a corpus of a few thousand bodies, so when the two disagree the corpus is what is
 * wrong — and a genus with every row demoted is the app quietly contradicting the scanner while
 * showing no sign of it.
 *
 * Found on Myiesue CH-L d8-10 body 45: 7 signals, 7 genera named, 5 shown. Concha and Tubus had
 * every row demoted by a 190 K codex ceiling on a 193 K body, 1.6 % over. The commander then landed
 * and found Concha labiata exactly where the scanner said it was.
 *
 * {@link restoreDemotionsBelowSignalCount}'s count rule could not help: it only ever restored rows
 * demoted **solely** for `ObservedTemperature` or `StarType`, and these were `SurfaceTemperature`
 * codex-range demotions, several carrying a second soft reason as well. A count also cannot see
 * *which* genus is missing — it would happily restore a sixth row of a genus already shown.
 *
 * One row per named genus, the least-objected-to first. Everything else stays demoted: this is a
 * floor under the shown list, not a reprieve for the whole genus.
 */
function restoreNamedGenera(
  strict: PendingMatch[],
  unlikely: PendingMatch[],
  dssGenera: ReadonlySet<string> | null,
  generaOf: (rows: PendingMatch[]) => Set<string>,
): void {
  if (!dssGenera?.size) return;
  const shown = generaOf(strict);
  const missing = [...dssGenera].filter((g) => !shown.has(g));
  if (!missing.length) return;

  const restored = new Set<number>();
  for (const genus of missing) {
    const candidates = unlikely
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.entry.genusDataDir === genus && !m.entry.predictionUnsupported)
      // Fewest objections first; a row the corpus merely has not seen beats one that disagrees on
      // three axes at once.
      .sort((a, b) => (a.m.unlikelyReasons?.length ?? 0) - (b.m.unlikelyReasons?.length ?? 0));
    const best = candidates[0];
    if (!best) continue;
    strict.push({ entry: best.m.entry, reasons: best.m.reasons });
    restored.add(best.i);
  }
  if (!restored.size) return;
  const keep = unlikely.filter((_, i) => !restored.has(i));
  unlikely.length = 0;
  unlikely.push(...keep);
}

function restoreDemotionsBelowSignalCount(
  strict: PendingMatch[],
  unlikely: PendingMatch[],
  signalCount: number | null,
  dssGenera: ReadonlySet<string> | null,
): void {
  const generaOf = (rows: PendingMatch[]) =>
    new Set(rows.filter((m) => !m.entry.predictionUnsupported).map((m) => m.entry.genusDataDir));

  restoreNamedGenera(strict, unlikely, dssGenera, generaOf);

  if (signalCount == null || !Number.isFinite(signalCount) || signalCount <= 0) return;
  if (generaOf(strict).size >= signalCount) return;

  /*
    Weakest evidence gives way first, and the observed-temperature envelope is the weakest we have.

    It says "nobody has recorded this species at this temperature yet", which a corpus of a few
    hundred bodies can easily be wrong about. A host-star gate says "this species has never been seen
    under this kind of star", which is a harder observation and is there because of a real report —
    Electricae pluma turning up on a neutron-star body.

    Ordering matters more than it looks. Before this, only star-type demotions were eligible, so a
    body whose shown list fell below the count *because of a temperature demotion* restored the
    Electricae instead of the row that had actually been pushed out — resurrecting the exact bug
    `hostStarGates` exists to hold down. Temperature rows are offered first and the star-type ones
    only if the count still is not met.
  */
  const solely = (m: PendingMatch, field: string) =>
    (m.unlikelyReasons ?? []).length > 0 && (m.unlikelyReasons ?? []).every((r) => r.field === field);

  const byTemperature = unlikely
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => solely(m, "ObservedTemperature"));
  const byStar = unlikely
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => solely(m, "StarType"))
    .sort((a, b) => hostStarDeterminism(a.m.entry) - hostStarDeterminism(b.m.entry));
  const eligible = [...byTemperature, ...byStar];

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

/**
 * Demote candidates whose **spatial** gate fails — INCLUDE-BODY-IDS Phase 7.
 *
 * Runs after the strict/unlikely split rather than inside `speciesMatchesCriteria`, because this is
 * a fact about the *system*, not about the body: every body in a system shares the answer, and
 * threading a galactic coordinate through a per-body criterion would put it in the wrong place.
 *
 * **Demotes, never deletes.** Bark Mounds reach 100 % within 300 ly of a nebula, so a hard cut there
 * would lose nothing — but Electricae radialem only reaches 82 %, meaning about one radialem system
 * in five is further from a *catalogued* nebula than any threshold allows. A hard gate cannot tell
 * "no nebula here" from "no nebula recorded here", so it would silently delete real sightings. The
 * unlikely tier already exists for exactly this: listed, collapsed, and explained.
 *
 * Ordering matters. This runs **before** {@link restoreDemotionsBelowSignalCount}, so a body whose
 * signal count cannot otherwise be satisfied can still pull a spatially-demoted species back — the
 * game reporting N biological signals is a harder fact than a catalogue's completeness.
 */
export function demoteFailedSpatialGates(
  strict: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  unlikely: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  matchContext: SpeciesMatchContext | null | undefined,
  catalogue: SpatialCatalogue | null,
): void {
  const coords = matchContext?.systemCoords;

  /**
   * No position, no verdict — never a failure.
   *
   * But "we could not check" is not the same as "there is nothing to check", and the difference is
   * visible to the reader: a gated species that survives unmarked looks like one that passed. Mark
   * it so the genus split can withhold its percentage, then leave the tiers alone.
   */
  if (!coords || !catalogue) {
    for (const m of strict) {
      if (gateForSpeciesId(m.entry.id)) m.spatialGateUnresolved = true;
    }
    return;
  }

  for (let i = strict.length - 1; i >= 0; i--) {
    const m = strict[i]!;
    const verdict = evaluateSpatialGate(m.entry.id, coords, catalogue);
    if (!verdict || verdict.passes) continue;
    const reason: MatchReason = {
      field: verdict.kind === "core" ? "GalacticCore" : verdict.kind === "nebula" ? "Nebula" : "GuardianSite",
      detail: `${describeVerdict(verdict)} ${verdict.evidence}.`,
      soft: true,
    };
    strict.splice(i, 1);
    unlikely.push({
      ...m,
      reasons: [...m.reasons, reason],
      unlikely: true,
      unlikelyReasons: [...(m.unlikelyReasons ?? []), reason],
    });
  }
}

/**
 * Demote candidates whose **host-star class** gate fails — INCLUDE-BODY-IDS §7.12.
 *
 * Runs beside {@link demoteFailedSpatialGates} and for the same reason: this is a fact about the
 * star, shared by every body that orbits it, and it is measured rather than quoted. Electricae pluma
 * was recorded under a neutron star, white dwarf, A-class star or black hole in all 10,194 sightings
 * `ABSTRACT-COND.md` measured, and under nothing else — O and B, which ed-dsn lists as unconfirmed
 * possibilities, came in at 0 %.
 *
 * Against our own corpus the gate keeps all 31 confirmed pluma bodies and withdraws the species from
 * 591 of the 627 bodies that match the Electricae genus shape, which is the whole point: the shape
 * alone is nearly worthless for telling pluma from radialem.
 *
 * **Demotes, never deletes**, and an unresolved star produces no verdict at all — see
 * `evaluateHostStarGate`. The single write path with the spatial gate is deliberate: both mark
 * `spatialGateUnresolved`-style state through the same tier so the genus split can withhold a
 * percentage rather than normalising one against a candidate nobody can judge.
 */
export function demoteFailedHostStarGates(
  strict: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  unlikely: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  matchContext: SpeciesMatchContext | null | undefined,
): void {
  const classes = matchContext?.hostStarClasses;
  const mainStar = matchContext?.systemMainStarClass ?? null;

  if ((!classes || classes.length === 0) && !mainStar) {
    // No star scanned yet. Not a pass — mark it, so the split does not put a number on it.
    for (const m of strict) {
      if (hostStarGateForSpeciesId(m.entry.id)) m.spatialGateUnresolved = true;
    }
    return;
  }

  for (let i = strict.length - 1; i >= 0; i--) {
    const m = strict[i]!;
    const verdict = evaluateHostStarGate(m.entry.id, classes, mainStar);
    if (!verdict || verdict.passes) continue;
    const reason: MatchReason = {
      field: "StarType",
      detail: `${describeHostStarVerdict(verdict)} ${verdict.evidence}. ${DEMOTED_NOTE}`,
      soft: true,
    };
    strict.splice(i, 1);
    unlikely.push({
      ...m,
      reasons: [...m.reasons, reason],
      unlikely: true,
      unlikelyReasons: [...(m.unlikelyReasons ?? []), reason],
    });
  }
}

/**
 * Demote a species whose system does not hold the companion body it grows alongside.
 *
 * Amphora plant wants an Earth-like world, ammonia world, water giant, or a gas giant with water- or
 * ammonia-based life somewhere in the system; the Brain Trees want an Earth-like world or a gas giant
 * with water-based life. Both conditions sat in the data raising `predictionUnsupported` until the
 * match context learned to carry the system's other bodies.
 *
 * Demotion, not exclusion, and the reason travels with the row: the requirement lists are transcribed
 * community knowledge, and one missing entry on a 3 M credit species should cost a tier rather than
 * the body. An unfinished honk is marked unresolved instead, exactly as the spatial gates do — an
 * Earth-like world nobody has scanned yet is not an Earth-like world that is not there.
 */
export function demoteFailedSystemBodyGates(
  strict: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  unlikely: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  matchContext: SpeciesMatchContext | null | undefined,
): void {
  for (let i = strict.length - 1; i >= 0; i--) {
    const m = strict[i]!;
    const wanted = m.entry.criteria?.systemBodyClassesAnyOf;
    if (!wanted?.length) continue;

    const verdict = evaluateSystemBodyGate(
      wanted,
      matchContext?.systemBodyClasses,
      matchContext?.systemBodyListComplete === true,
    );
    if (!verdict || verdict.kind === "pass") continue;
    if (verdict.kind === "unresolved") {
      // Not a pass. Marked, so nothing downstream counts it as one.
      m.spatialGateUnresolved = true;
      continue;
    }

    const reason: MatchReason = {
      field: "System bodies",
      detail: `${describeSystemBodyVerdict(verdict)}. ${DEMOTED_NOTE}`,
      soft: true,
    };
    strict.splice(i, 1);
    unlikely.push({
      ...m,
      reasons: [...m.reasons, reason],
      unlikely: true,
      unlikelyReasons: [...(m.unlikelyReasons ?? []), reason],
    });
  }
}

/**
 * Demote a species on an atmosphere it is recorded on but rarely wins.
 *
 * The owner's call, after the genus comparison: *"demote tela on CO2, ammonia, nitrogen and argon."*
 * Those are the four where tela takes between 0.3 % and 1.8 % of the bodies its own genus holds,
 * against 47 % on water and 58 % on neon-rich.
 *
 * A demotion rather than an exclusion, for the usual reason: the corpus does record twenty tela
 * bodies on carbon dioxide, and a rule that removed them would be claiming something the data does
 * not say. The row keeps its place behind "show unlikely" and carries the share with it.
 *
 * Runs beside the spatial, host-star and system-body gates and reads the same way: a species with no
 * such list is untouched, and an unknown atmosphere says nothing.
 */
export function demoteUnfavouredAtmospheres(
  strict: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  unlikely: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  scan: PlanetScan,
): void {
  const atmosphere = scan.AtmosphereType ?? scan.Atmosphere ?? null;
  if (!atmosphere) return;

  for (let i = strict.length - 1; i >= 0; i--) {
    const m = strict[i]!;
    const verdict = atmosphereIsUnfavoured(m.entry.criteria?.atmosphereUnfavouredAnyOf, atmosphere);
    if (!verdict) continue;

    const reason: MatchReason = {
      field: "Atmosphere",
      detail:
        `${m.entry.displayName} is recorded on ${verdict.matched} atmospheres but rarely wins one: ` +
        `its own genus holds far more of them. ${DEMOTED_NOTE}`,
      soft: true,
    };
    strict.splice(i, 1);
    unlikely.push({
      ...m,
      reasons: [...m.reasons, reason],
      unlikely: true,
      unlikelyReasons: [...(m.unlikelyReasons ?? []), reason],
    });
  }
}

/**
 * Of two or more species of one genus shown together, demote the one the region barely records.
 *
 * The absence rule judges a species against the galaxy's biology as a whole and cannot see "12
 * divisa against thousands of cultro" — divisa clears it in Galactic Centre at 0.022 %. Given that
 * the genus is on the body, the record's answer to *which species* is each one's share of its genus
 * in the region; under `REGION_GENUS_SHARE_MIN` it is the rare one. See `shared/regionAbsence.ts`.
 *
 * **A tie-breaker, never an eviction.** It only acts between siblings that are shown together, and
 * never demotes the last one standing. Run as a per-species gate it demoted Fonticulua fluctus in
 * Inner Orion Spur — the commander's rarest find, 20 M — on bodies where it was the only Fonticulua
 * shown, and `restoreNamedGenera` then put back a *different* species to fill the named genus. A
 * rare species alone in its slot is still the best answer the body has.
 */
export function demoteRegionallyRareSiblings(
  strict: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  unlikely: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[],
  matchContext: SpeciesMatchContext | null | undefined,
): void {
  const regionIndex = matchContext?.regionIndex;
  if (!regionIndex) return;
  const root = getProjectRoot();
  const byGenus = new Map<string, number[]>();
  strict.forEach((m, i) => {
    const g = m.entry.genusDataDir;
    byGenus.set(g, [...(byGenus.get(g) ?? []), i]);
  });
  const demote: { i: number; reason: MatchReason }[] = [];
  for (const idxs of byGenus.values()) {
    if (idxs.length < 2) continue;
    const rare = idxs
      .map((i) => ({ i, v: regionalGenusShare(root, regionIndex, strict[i]!.entry.id) }))
      .filter((x) => x.v?.rare);
    if (rare.length === 0 || rare.length === idxs.length) continue;
    for (const { i, v } of rare) {
      demote.push({
        i,
        reason: { field: "Region", soft: true, detail: regionGenusShareDetail(v!.regionName, strict[i]!.entry.genus, v!) },
      });
    }
  }
  for (const { i, reason } of demote.sort((a, b) => b.i - a.i)) {
    const m = strict[i]!;
    strict.splice(i, 1);
    unlikely.push({
      ...m,
      reasons: [...m.reasons, reason],
      unlikely: true,
      unlikelyReasons: [...(m.unlikelyReasons ?? []), reason],
    });
  }
}

export function matchDatabaseToScan(
  db: SpeciesDatabase,
  scan: PlanetScan,
  genusHints: GenusHint[] | null,
  organicGenusLocks: OrganicGenusLock[] | null | undefined,
  options?: {
    includeBacterium?: boolean;
    matchContext?: SpeciesMatchContext | null;
    /** Phase 7 point catalogues. Absent means the spatial gates simply do not run. */
    spatialCatalogue?: SpatialCatalogue | null;
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

  demoteFailedSpatialGates(strict, unlikely, matchContext, options?.spatialCatalogue ?? null);
  demoteFailedHostStarGates(strict, unlikely, matchContext);
  demoteFailedSystemBodyGates(strict, unlikely, matchContext);
  demoteUnfavouredAtmospheres(strict, unlikely, scan);
  demoteRegionallyRareSiblings(strict, unlikely, matchContext);

  restoreDemotionsBelowSignalCount(
    strict,
    unlikely,
    options?.biologicalSignals ?? null,
    genusFilterActive ? new Set(narrowed.map((e) => e.genusDataDir)) : null,
  );

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
