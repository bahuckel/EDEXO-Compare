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
  presenceReportsAnyVolcanism,
} from "../shared/presenceBranches.js";
export { PRESENCE_BRANCH_FIELDS } from "../shared/presenceBranches.js";
import {
  journalSurfaceGravityToG,
  LIGHT_SECOND_METERS,
  THIN_ATMOSPHERE_MAX_ATM,
  journalPressureToAtm,
} from "../shared/journalPhysics.js";
import { type SpatialCatalogue } from "../shared/spatialGates.js";
import { gameGravityLimitG, gameTemperatureCeilingK } from "../shared/gameLimits.js";
export { gameGravityLimitG, gameTemperatureCeilingK } from "../shared/gameLimits.js";
import { observedAtGravity } from "./speciesGravityObservations.js";
import { regionalPresence } from "./regionSpeciesData.js";
import { regionPresenceDetail } from "../shared/regionAbsence.js";
import { tierRegionalPresence } from "./speciesRarityData.js";
import { tierRegionDetail } from "../shared/speciesRarity.js";
import { getProjectRoot } from "./paths.js";
import { colourVariantRuleFor } from "./eddsnColourVariants.js";
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
  collectOwnOrganicLockSpeciesIds,
} from "./organicLocks.js";
import { spectralKeysFromJournalStarType } from "../shared/starSpectralKeys.js";
import { observedOnPlanetClass } from "./speciesPlanetClassObservations.js";
import {
  MIN_TEMPERATURE_OBSERVATIONS,
  NEAR_TEMPERATURE_WINDOW_K,
  observedAtTemperature,
  observedNearTemperature,
} from "./speciesTemperatureObservations.js";
import { observedEnvelopeFactor } from "./observedEnvelope.js";
import { observedWithVolcanism } from "./speciesVolcanismObservations.js";
import { hostStarVerdict, type HostStarVerdict } from "./speciesHostStarObservations.js";
import { volcanismJournalMatchesFragments } from "../shared/volcanismMatch.js";
import { isBacteriumSpeciesEntry } from "../shared/speciesBacterium.js";
import {
  DEMOTED_NOTE,
  restoreDemotionsBelowSignalCount,
  demoteFailedSpatialGates,
  demoteFailedHostStarGates,
  demoteFailedSystemBodyGates,
  weighOutsideStarlight,
  OBSERVED_TEMP_TOLERANCE_K,
  demoteRegionallyRareSiblings,
  demoteDeltahedronixOnOneSignalIcy,
} from "./demotionPasses.js";
export {
  demoteFailedSpatialGates,
  demoteFailedHostStarGates,
  demoteFailedSystemBodyGates,
  weighOutsideStarlight,
  OBSERVED_TEMP_TOLERANCE_K,
  demoteRegionallyRareSiblings,
} from "./demotionPasses.js";

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
  // The body's own finds only: a sibling moon's species are a hint (its genus is merged into this
  // body's genus hints), and injected here they said "ScanOrganic on this body" about a moon nobody
  // had landed on (Skaude EX-A d1-228 5 c, 2026-10-03).
  const wantIds = collectOwnOrganicLockSpeciesIds(organicGenusLocks, db);
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
  /** Kept at a lower chance by a soft band (the orbit's `softBelow`); multiplies "Chance here". */
  presenceFactor?: number;
}

export interface PlanetTemperatureBand {
  minK: number;
  maxK: number;
}


function speciesTempBand(c: SpeciesCriterion): { lo: number; hi: number } | null {
  const st = c.surfaceTemperatureK;
  if (!st) return null;
  if (st.min === undefined && st.max === undefined) return null;
  return { lo: st.min ?? OPEN_LO, hi: gameTemperatureCeilingK(st.max) ?? OPEN_HI };
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
  let presenceFactor: number | undefined;

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
        // Listed only with volcanism (SpeciesCriterion.volcanicOnlyAtmospheres).
        const volcanicOnly =
          !matches &&
          atmoNorm !== "" &&
          (c.volcanicOnlyAtmospheres ?? []).some((a) => atmosphereCompositionKey(a) === scanKey);
        // Volcanism must be reported, not merely unknown: every truth body on these atmospheres carries
        // a reading, and letting an unknown one through put gelata beside setisis on ~250 more slots.
        const volcanismKnownHere = scan.Volcanism !== undefined && scan.Volcanism !== null;
        if (volcanicOnly && !presenceReportsAnyVolcanism(scan)) {
          failures.push({
            field: "AtmosphereType",
            soft: true,
            detail: volcanismKnownHere
              ? `${atmoNorm} — this species grows on it only with volcanism, and this body has none. ${DEMOTED_NOTE}`
              : `${atmoNorm} — this species grows on it only with volcanism, and none is reported here. ${DEMOTED_NOTE}`,
          });
        } else if (volcanicOnly) {
          reasons.push({
            field: "AtmosphereType",
            detail: `${atmoNorm} — off the codex list, where this species grows only with volcanism: ${String(scan.Volcanism).trim()}.`,
          });
        } else if (!matches) {
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
          // A species that leaves its codex list only on volcanic ground: no volcanism, no rescue.
          const volcanismKnown = scan.Volcanism !== undefined && scan.Volcanism !== null;
          const rescueBarred =
            !!observedHere && c.offListAtmosphereNeedsVolcanism === true && volcanismKnown && !presenceReportsAnyVolcanism(scan);
          if (observedHere && rescueBarred) {
            failures.push({
              field: "AtmosphereType",
              soft: true,
              detail:
                `${atmoNorm} — outside the codex list; this species is recorded off its list only on volcanic ` +
                `bodies, and this one has none. ${DEMOTED_NOTE}`,
            });
          } else if (observedHere) {
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
    const fit = rangeFit(g, c.surfaceGravity.min, gameGravityLimitG(c.surfaceGravity.max));
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
  let starVerdict = ctx?.parentStarType?.trim()
    ? hostStarVerdict(entry, ctx.parentStarType)
    : ({ kind: "unknown" } as HostStarVerdict);
  /*
    "Never seen under this host star" misfires twice, and both are measured.

    A species whose colour comes from a crust material (ED-DSN's table, `eddsnColourVariants`) has
    no star in its colour rule, and a thin profile's host list is sampling, not a rule: Bacterium
    omentum and verrata were demoted under K hosts, Electricae radialem under several classes.
    Every body in the data carries at least one material of each rare group, so the material never
    rules a species out either — the star term is simply not evidence for these.

    And a colour star follows the system's main star, not a brown or white dwarf the body happens to
    orbit (araneamus, pluma): star-coloured species fit the main star on 96-99 % of their bodies and
    the host on 76-94 %. A class observed as the main star counts as observed.

    Replayed over 82,039 slots: 36 truth slots back for 15 single-species slots; on the 3,687 slots
    from the 2026-09-24 capture — recorded after these rules were set — misses 21 -> 14 alone and
    21 -> 9 with the restore ordering below.
  */
  if (starVerdict.kind === "never") {
    const rule = colourVariantRuleFor(getProjectRoot(), entry.genusDataDir, entry.displayName);
    if (rule?.source === "material") starVerdict = { kind: "unknown" };
  }
  if (starVerdict.kind === "never" && ctx?.systemMainStarClass) {
    const viaMain = hostStarVerdict(entry, ctx.systemMainStarClass);
    if (viaMain.kind === "observed") starVerdict = viaMain;
  }

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
      // The genus tables name families — "D" for every white dwarf, "W" for every Wolf-Rayet — and the
      // journal names the subtype ("DA", "DAB", "WC", "WN"): compared as written, those rows never
      // matched and the gate never fired under either (code review A1, 2026-09-27).
      const family = (k: string) => {
        const u = k.toUpperCase();
        return /^D[A-Z]+$/.test(u) ? "D" : /^W[A-Z]+$/.test(u) ? "W" : u;
      };
      const excluded = specKeys.some((k) =>
        starColorNulls.some((n) => {
          const nu = n.toUpperCase();
          return nu === k.toUpperCase() || nu === family(k);
        }),
      );
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
    const step = orb.min !== undefined && v < orb.min ? orb.softBelow?.find((s) => v >= s.fromLs) : undefined;
    if (fit !== "in" && step) {
      /*
        Under the codex minimum, where the species still grows, only less often: kept, at the chance
        the corpus gives it there. Clypeus speculumi, "5 AU" (2,495 ls): 64 of its 5,974 bodies sit at
        2,300–2,495 ls and one was missed at 2,327 (EDDN ScanOrganic set, 2026-10-03).
      */
      presenceFactor = step.factor;
      reasons.push({
        field: "Orbit",
        detail: `${v.toFixed(0)} LS from host — under the codex ${orb.min} LS, where it is rarer: kept at ×${step.factor} chance.`,
      });
    } else if (fit !== "in") {
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

  /* Known from these systems only (Ingensradices unicus: HIP 87621). A wall, and an unknown system fails. */
  const known = c.systemAddressAnyOf;
  if (known?.length) {
    const sys = ctx?.systemAddress;
    if (sys == null || !known.includes(sys)) {
      failures.push({ field: "Location", detail: "Known from one system only, and this is not it." });
    } else {
      reasons.push({ field: "Location", detail: "The system it is known from" });
    }
  }

  /*
   * Distance from the arrival star — a wall, unlike the orbit range. Crystalline Shards, the one species
   * carrying it: all 5,932 Spansh-dump bodies are ≥ 12,004 Ls from arrival, so a body well inside the
   * rule is not a place they grow. Just inside it (the numeric tolerance) demotes; an unknown distance
   * demotes too, since a cold rock anywhere would otherwise list them.
   */
  const arr = c.distanceFromArrivalLs;
  if (arr && (arr.min !== undefined || arr.max !== undefined)) {
    const v = ctx?.distanceFromArrivalLs;
    if (v == null || !Number.isFinite(v)) {
      failures.push({
        field: "Arrival",
        soft: true,
        detail: `Distance from the arrival star unknown — species needs ${arr.min ?? "−∞"}…${arr.max ?? "∞"} LS. ${DEMOTED_NOTE}`,
      });
    } else {
      const fit = rangeFit(v, arr.min, arr.max);
      if (fit !== "in") {
        failures.push({
          field: "Arrival",
          ...(fit === "near" ? { soft: true } : {}),
          detail: `${v.toFixed(0)} LS from the arrival star — species needs ${arr.min ?? "−∞"}…${arr.max ?? "∞"} LS.${fit === "near" ? ` Within ${NUMERIC_GATE_TOLERANCE * 100}%. ${DEMOTED_NOTE}` : ""}`,
        });
      } else {
        reasons.push({ field: "Arrival", detail: `${v.toFixed(0)} LS from arrival` });
      }
    }
  }

  const cat = c.atmospherePressureCategory;
  if (cat && ctx?.surfacePressureAtm != null && Number.isFinite(ctx.surfacePressureAtm)) {
    const p = ctx.surfacePressureAtm;
    /*
      "Thin" is a ceiling on pressure, and 0 atm is under every ceiling — so an airless body passed
      it. A species with an atmosphere list is judged by that list (vacuum only where it says so);
      one with no list had nothing else to stop it. Fumerola extremus was offered as the one
      certain genus on an airless rock that grew Bark Mounds (owner, Tegnae HT-Z d13-1 1 a,
      2026-09-25). Its 231 recorded sightings are all on thin atmospheres, lowest 0.001 atm.
    */
    const airless = p < 1e-6 && !atmoNorm;
    if (cat === "thin" && airless && !c.atmosphereTypeAnyOf?.length) {
      failures.push({
        field: "SurfacePressure",
        detail: "Needs a thin atmosphere; this body has none (0 atm).",
      });
    } else if (cat === "thin" && p > THIN_ATMOSPHERE_MAX_ATM) {
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
  /*
    The rarity-tier rule (owner, 2026-09-27) first: EDSM's codex, and a region limit that scales with
    how rare the species is (Common 50 systems … Legendary 1) instead of one share for everything.
    The EDAstro share gate below stays as the fallback for anything the tier data does not know.
  */
  const tierVerdict = ctx?.regionName ? tierRegionalPresence(getProjectRoot(), ctx.regionName, entry.id) : null;
  if (tierVerdict && ctx?.regionName) {
    if (tierVerdict.presence === "absent") {
      failures.push({ field: "Region", soft: true, detail: tierRegionDetail(ctx.regionName, tierVerdict, true) });
    } else if (tierVerdict.presence === "present") {
      reasons.push({ field: "Region", detail: tierRegionDetail(ctx.regionName, tierVerdict, false) });
    }
  } else if (ctx?.regionIndex) {
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

  return presenceFactor !== undefined ? { ok: true, reasons, presenceFactor } : { ok: true, reasons };
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
        ? sightingsBeyondEdge(
            entry,
            observedHere,
            scan.SurfaceTemperature!,
            c.surfaceTemperatureK?.min,
            gameTemperatureCeilingK(c.surfaceTemperatureK?.max),
          )
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
      // Exactly on a ceiling a sibling starts at: the edge is the sibling's (attachSharedTemperatureEdges).
      if (entry.temperatureCeilingSharedWith && surf != null && surf === band.hi) {
        failures.push({
          field: "SurfaceTemperature",
          soft: true,
          detail:
            `${surf.toFixed(1)} K is exactly where ${entry.temperatureCeilingSharedWith}'s range begins; recorded bodies ` +
            `at a shared edge are the species that starts there. ${DEMOTED_NOTE}`,
        });
      } else {
        extraOkReasons.push({ field: "SurfaceTemperature", detail: bandTxt });
      }
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

  /*
    The measured orbit ceiling: how wide an orbit round its parent the species is recorded on. Soft
    always, for the same reason as the measured temperature band. See SpeciesCriterion.softMaxSemiMajorAxisLs.
  */
  const smaMax = c.softMaxSemiMajorAxisLs;
  const sma = scan.SemiMajorAxis;
  if (smaMax !== undefined && typeof sma === "number" && Number.isFinite(sma) && sma > 0) {
    const ls = sma / LIGHT_SECOND_METERS;
    if (ls > smaMax) {
      failures.push({
        field: "Orbit",
        soft: true,
        detail:
          `Orbits its parent at ${ls >= 100 ? Math.round(ls).toLocaleString() : ls.toFixed(1)} ls; this species is rarely ` +
          `recorded beyond ${smaMax} ls — it grows on close moons. ${DEMOTED_NOTE}`,
      });
    }
  }

  // Measured absence of volcanism (SpeciesCriterion.softNoVolcanism). Abstains without a volcanism field.
  if (c.softNoVolcanism && scan.Volcanism !== undefined && scan.Volcanism !== null && presenceReportsAnyVolcanism(scan)) {
    failures.push({
      field: "Volcanism",
      soft: true,
      detail: `${String(scan.Volcanism).trim()} — this species is almost never recorded on a volcanic body. ${DEMOTED_NOTE}`,
    });
  }

  const linkedMax = gameTemperatureCeilingK(c.whenAtmosphereLinkedMaxTempK);
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
  let envelopeFactor: number | undefined;
  const envelope = entry.observedTemperatureK;
  const tHere = scan.SurfaceTemperature;
  // See OBSERVED_TEMP_TOLERANCE_K: an envelope edge is a recorded body, not a wall.
  if (envelope && typeof tHere === "number" && Number.isFinite(tHere) && failures.length === 0) {
    const outside =
      tHere < envelope.min - OBSERVED_TEMP_TOLERANCE_K || tHere > envelope.max + OBSERVED_TEMP_TOLERANCE_K;
    const factor = outside ? observedEnvelopeFactor(entry.id) : undefined;
    if (outside && factor !== undefined) {
      // Kept, at how much less likely the corpus says it is out here than its siblings are.
      envelopeFactor = factor;
      extraOkReasons.push({
        field: "ObservedTemperature",
        soft: factor < 1,
        detail:
          `${tHere.toFixed(1)} K is outside the ${envelope.min.toFixed(0)}–${envelope.max.toFixed(0)} K ` +
          `range of its ${envelope.count} profile bodies` +
          (factor < 1 ? `; kept at ×${factor} chance, as rare out here as the corpus has it.` : `; the corpus finds it out here as often as its siblings.`),
      });
    } else if (outside) {
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

  const ok = { ok: true, reasons: [...base.reasons, ...extraOkReasons] };
  const pf =
    base.presenceFactor !== undefined || envelopeFactor !== undefined
      ? (base.presenceFactor ?? 1) * (envelopeFactor ?? 1)
      : undefined;
  return pf !== undefined ? { ...ok, presenceFactor: pf } : ok;
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
    /** True when `biologicalSignals` is a stand-in (an AutoScan-only body), not the game's count. */
    signalCountAssumed?: boolean;
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
  // Species the game leaves out of the signal count are never named by a DSS, so no genus filter
  // or lock may remove them; their own gates (a known system) decide.
  for (const e of species) {
    if (e.criteria?.outsideSignalCount && !narrowed.some((x) => x.id === e.id)) narrowed.push(e);
  }
  const genusFilterActive = !!(genusHints && genusHints.length);
  const dssGenusNarrowing = genusFilterActive;
  /*
    DSS-only rows (the Thargoid entries, owner 2026-10-04): never predicted from the body. Only a DSS
    naming their genus lists them, then without any test of the body; a logged one comes back below
    through the organic locks like any find.
  */
  narrowed = narrowed.filter(
    (e) => !e.dssOnly || (genusFilterActive && filterByGenusHints([e], genusHints).length > 0),
  );

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
    if (entry.dssOnly) {
      strict.push({ entry, reasons: [{ field: "Genus", detail: "The DSS named this genus on the body." }] });
      continue;
    }
    const r = speciesMatchesCriteria(entry, scan, planetTempBand, est, matchContext);
    if (r.ok) {
      strict.push(
        r.presenceFactor !== undefined
          ? { entry, reasons: r.reasons, presenceFactor: r.presenceFactor }
          : { entry, reasons: r.reasons },
      );
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
  weighOutsideStarlight(strict, unlikely, matchContext);
  demoteRegionallyRareSiblings(strict, unlikely, matchContext);
  demoteDeltahedronixOnOneSignalIcy(
    strict,
    unlikely,
    scan.PlanetClass,
    options?.biologicalSignals ?? null,
    options?.signalCountAssumed === true,
  );

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
