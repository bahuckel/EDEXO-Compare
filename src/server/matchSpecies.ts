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
  DssPhysicalSlackRatios,
} from "../shared/types.js";
import { journalSurfaceGravityToG, THIN_ATMOSPHERE_MAX_ATM } from "../shared/journalPhysics.js";
import {
  normalizeScanAtmosphereForMatch,
  atmosphereCompositionKey,
  atmosphereAllowlistMeansAnyThinCompositionOnly,
} from "../shared/scanAtmosphereMatch.js";
import { atmosphereBucketForEstimator, estimatedTemperatureRangeForScan } from "./planetTemperature.js";
import { dssHintsIncludeBacterium } from "../shared/genusHints.js";
import { filterByGenusHints } from "./genusMatchUtils.js";
import { applyOrganicGenusLocks, organicScanConfirmsNonBacteriumGenus, collectResolvedOrganicLockSpeciesIds } from "./organicLocks.js";
import { spectralKeysFromJournalStarType } from "../shared/starSpectralKeys.js";
import { volcanismJournalMatchesFragments } from "../shared/volcanismMatch.js";
import { isBacteriumSpeciesEntry } from "../shared/speciesBacterium.js";

export { isBacteriumSpeciesEntry };
const OPEN_LO = -1e15;
const OPEN_HI = 1e15;
const PRESSURE_WEIGHT = 250;
const CLOSEST_MATCH_CAP = 8;

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

const GRAVITY_WEIGHT = 80;

function planetBandWidthForSlack(planet: PlanetTemperatureBand): number {
  const span = planet.maxK - planet.minK;
  if (span >= 1) return span;
  const mid = (planet.minK + planet.maxK) / 2;
  return Math.max(1, Math.abs(mid) * 0.05);
}

/**
 * Extend the planet band by `ratio × width` only on the edge facing a non-overlapping species interval
 * (avoids inflating the hot end when the species is colder than the band, helping atmosphere-linked caps).
 */
function expandPlanetTempBandTowardSpecies(
  planet: PlanetTemperatureBand,
  species: { lo: number; hi: number },
  ratio: number,
): PlanetTemperatureBand | null {
  if (tempBandsOverlap(planet, species)) return null;
  const w = planetBandWidthForSlack(planet);
  const slack = w * ratio;
  if (species.hi < planet.minK) {
    return { minK: planet.minK - slack, maxK: planet.maxK };
  }
  if (species.lo > planet.maxK) {
    return { minK: planet.minK, maxK: planet.maxK + slack };
  }
  return {
    minK: planet.minK - slack,
    maxK: planet.maxK + slack,
  };
}

/**
 * When DSS hints narrow to one or more genera but strict gates fail, pick the codex row with smallest
 * temperature separation to the planet band within each `genusDataDir` (ignores other gates).
 */
function buildDssGenusNearestTemperatureMatches(
  narrowed: SpeciesEntry[],
  planetTempBand: PlanetTemperatureBand,
): Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[] {
  const byGenus = new Map<string, SpeciesEntry[]>();
  for (const e of narrowed) {
    const g = e.genusDataDir;
    const list = byGenus.get(g) ?? [];
    list.push(e);
    byGenus.set(g, list);
  }

  const out: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[] = [];

  for (const group of byGenus.values()) {
    let best: { entry: SpeciesEntry; tempSep: number; band: { lo: number; hi: number } } | null = null;
    for (const entry of group) {
      const band = speciesTempBand(entry.criteria);
      if (!band) continue;
      const sep = tempSeparation(planetTempBand, band);
      if (
        !best ||
        sep < best.tempSep - 1e-9 ||
        (Math.abs(sep - best.tempSep) <= 1e-9 && entry.id.localeCompare(best.entry.id) < 0)
      ) {
        best = { entry, tempSep: sep, band };
      }
    }
    if (!best) continue;

    const spLo = best.band.lo === OPEN_LO ? "…" : `${best.band.lo.toFixed(0)}`;
    const spHi = best.band.hi === OPEN_HI ? "…" : `${best.band.hi.toFixed(0)}`;
    const detail =
      best.tempSep === 0 ?
        `DSS narrowed this genus — codex temperature band overlaps the estimator ${planetTempBand.minK.toFixed(0)}–${planetTempBand.maxK.toFixed(0)} K band (${spLo}–${spHi} K for this row). Other codex gates were not re-checked; verify in-game.`
      : `DSS narrowed this genus — nearest codex row by temperature: estimator ${planetTempBand.minK.toFixed(0)}–${planetTempBand.maxK.toFixed(0)} K vs species ${spLo}–${spHi} K (gap ${best.tempSep.toFixed(1)} K). Other codex gates were not checked; verify in-game.`;

    out.push({
      entry: best.entry,
      reasons: [{ field: "Match mode", detail }],
      approximateMatch: true,
      dssNearestTemperatureMatch: true,
    });
  }

  out.sort((a, b) => a.entry.genusDataDir.localeCompare(b.entry.genusDataDir) || a.entry.id.localeCompare(b.entry.id));
  return out;
}

function valueInOpenCriterionBand(v: number, lo: number, hi: number): boolean {
  if (lo !== OPEN_LO && v < lo) return false;
  if (hi !== OPEN_HI && v > hi) return false;
  return true;
}

/**
 * Widen a codex min/max interval toward journal value `p` by `ratio × span` on the failing side.
 * Returns null if already inside or if the open end cannot be extended (e.g. p above an open max).
 */
function widenCriterionMinMaxToward(
  crit: { min?: number; max?: number },
  p: number,
  ratio: number,
): { min?: number; max?: number } | null {
  const lo = crit.min ?? OPEN_LO;
  const hi = crit.max ?? OPEN_HI;
  const finiteLo = lo === OPEN_LO ? -Infinity : lo;
  const finiteHi = hi === OPEN_HI ? Infinity : hi;
  if (p >= finiteLo && p <= finiteHi) return null;

  let span: number;
  if (Number.isFinite(finiteHi - finiteLo) && finiteHi - finiteLo > 0) span = finiteHi - finiteLo;
  else span = Math.max(Math.abs(p) * 0.02, 1e-6);
  const slack = span * ratio;

  if (p < finiteLo) {
    if (crit.min === undefined) return null;
    return { min: crit.min! - slack, max: crit.max };
  }
  if (crit.max === undefined) return null;
  return { min: crit.min, max: crit.max! + slack };
}

function matchScoreTempPressureGravity(
  scan: PlanetScan,
  planetBand: PlanetTemperatureBand | null,
  c: SpeciesCriterion,
): { score: number; tempSep: number; pressSep: number; gravSep: number } {
  const base = matchScoreTempPressure(scan, planetBand, c);
  let gravSep = 0;
  const gRaw = scan.SurfaceGravity;
  if (c.surfaceGravity && gRaw !== undefined && !Number.isNaN(gRaw)) {
    const g = journalSurfaceGravityToG(gRaw);
    const lo = c.surfaceGravity.min ?? OPEN_LO;
    const hi = c.surfaceGravity.max ?? OPEN_HI;
    if (lo !== OPEN_LO && g < lo) gravSep = lo - g;
    else if (hi !== OPEN_HI && g > hi) gravSep = g - hi;
  }
  return { ...base, gravSep, score: base.score + GRAVITY_WEIGHT * gravSep };
}

function tryDssGenusEntryWithPhysicalSlack(
  entry: SpeciesEntry,
  scan: PlanetScan,
  planetTempBand: PlanetTemperatureBand | null,
  est: { tMin: number; tMax: number; tMid: number } | null,
  matchContext: SpeciesMatchContext | null,
  slack: DssPhysicalSlackRatios,
): Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits"> | null {
  const c = entry.criteria;
  let planet = planetTempBand;
  let tempSlack = false;
  const sb = speciesTempBand(c);

  if (speciesNeedsTemperatureGate(c)) {
    if (!planet || !sb) return null;
    if (!tempBandsOverlap(planet, sb)) {
      if (slack.temperature <= 0) return null;
      const exp = expandPlanetTempBandTowardSpecies(planet, sb, slack.temperature);
      if (!exp || !tempBandsOverlap(exp, sb)) return null;
      planet = exp;
      tempSlack = true;
    }
  }

  let pressureSlack = false;
  let newPressure = c.surfacePressure;
  const pbPre = speciesPressureBand(c);
  const surfP = scan.SurfacePressure;
  if (pbPre && surfP != null && !Number.isNaN(surfP)) {
    if (!valueInOpenCriterionBand(surfP, pbPre.lo, pbPre.hi)) {
      if (slack.pressure <= 0) return null;
      const w = widenCriterionMinMaxToward(c.surfacePressure!, surfP, slack.pressure);
      if (!w) return null;
      newPressure = { ...c.surfacePressure, ...w };
      const pbPost = speciesPressureBand({ ...c, surfacePressure: newPressure });
      if (!pbPost || !valueInOpenCriterionBand(surfP, pbPost.lo, pbPost.hi)) return null;
      pressureSlack = true;
    }
  }

  let gravitySlack = false;
  let newGravity = c.surfaceGravity;
  const gRaw = scan.SurfaceGravity;
  if (c.surfaceGravity && gRaw !== undefined && !Number.isNaN(gRaw)) {
    const g = journalSurfaceGravityToG(gRaw);
    const gLo = c.surfaceGravity.min ?? OPEN_LO;
    const gHi = c.surfaceGravity.max ?? OPEN_HI;
    if (!valueInOpenCriterionBand(g, gLo, gHi)) {
      if (slack.gravity <= 0) return null;
      const w = widenCriterionMinMaxToward(c.surfaceGravity, g, slack.gravity);
      if (!w) return null;
      newGravity = { ...c.surfaceGravity, ...w };
      const gPostLo = newGravity.min ?? OPEN_LO;
      const gPostHi = newGravity.max ?? OPEN_HI;
      if (!valueInOpenCriterionBand(g, gPostLo, gPostHi)) return null;
      gravitySlack = true;
    }
  }

  if (!tempSlack && !pressureSlack && !gravitySlack) return null;

  const relaxedEntry: SpeciesEntry = {
    ...entry,
    criteria: {
      ...entry.criteria,
      surfacePressure: newPressure,
      surfaceGravity: newGravity,
    },
  };

  const full = speciesMatchesCriteria(relaxedEntry, scan, planet, est, matchContext);
  if (!full.ok) return null;

  const slackParts: string[] = [];
  if (tempSlack) slackParts.push(`temperature estimator ±${(slack.temperature * 100).toFixed(0)}%`);
  if (pressureSlack) slackParts.push(`pressure codex range ±${(slack.pressure * 100).toFixed(0)}%`);
  if (gravitySlack) slackParts.push(`gravity codex range ±${(slack.gravity * 100).toFixed(0)}%`);

  const slackDetail = `DSS genus — codex gates satisfied using physical slack toward the scan (${slackParts.join(", ")}). Estimator / journal conversion is approximate; verify in-game.`;

  return {
    entry,
    reasons: [...full.reasons.filter((r) => r.field !== "Match mode"), { field: "Match mode", detail: slackDetail }],
    approximateMatch: true,
    dssPhysicalSlackMatch: true,
  };
}

function buildDssGenusSlackPhysicalMatches(
  narrowed: SpeciesEntry[],
  scan: PlanetScan,
  planetTempBand: PlanetTemperatureBand | null,
  est: { tMin: number; tMax: number; tMid: number } | null,
  matchContext: SpeciesMatchContext | null,
  slack: DssPhysicalSlackRatios,
): Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[] {
  if (slack.temperature <= 0 && slack.pressure <= 0 && slack.gravity <= 0) return [];
  const byGenus = new Map<string, SpeciesEntry[]>();
  for (const e of narrowed) {
    const list = byGenus.get(e.genusDataDir) ?? [];
    list.push(e);
    byGenus.set(e.genusDataDir, list);
  }

  const out: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[] = [];

  for (const group of byGenus.values()) {
    let best: {
      m: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">;
      score: number;
    } | null = null;

    for (const entry of group) {
      const m = tryDssGenusEntryWithPhysicalSlack(
        entry,
        scan,
        planetTempBand,
        est,
        matchContext,
        slack,
      );
      if (!m) continue;
      const { score } = matchScoreTempPressureGravity(scan, planetTempBand, entry.criteria);
      if (
        !best ||
        score < best.score - 1e-9 ||
        (Math.abs(score - best.score) <= 1e-9 && m.entry.id.localeCompare(best.m.entry.id) < 0)
      ) {
        best = { m, score };
      }
    }
    if (best) out.push(best.m);
  }

  out.sort((a, b) => a.entry.genusDataDir.localeCompare(b.entry.genusDataDir) || a.entry.id.localeCompare(b.entry.id));
  return out;
}

function tryLoneGenusSpeciesSlackTemperatureMatch(
  entry: SpeciesEntry,
  scan: PlanetScan,
  planetTempBand: PlanetTemperatureBand,
  est: { tMin: number; tMax: number; tMid: number } | null,
  matchContext: SpeciesMatchContext | null,
  tempSlackRatio: number,
): Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits"> | null {
  const c = entry.criteria;
  if (!speciesNeedsTemperatureGate(c)) return null;
  const spBand = speciesTempBand(c)!;
  if (tempBandsOverlap(planetTempBand, spBand)) return null;

  if (tempSlackRatio <= 0) return null;

  const expanded = expandPlanetTempBandTowardSpecies(
    planetTempBand,
    spBand,
    tempSlackRatio,
  );
  if (!expanded || !tempBandsOverlap(expanded, spBand)) return null;

  const full = speciesMatchesCriteria(entry, scan, expanded, est, matchContext);
  if (!full.ok) return null;

  const spLo = spBand.lo === OPEN_LO ? "…" : `${spBand.lo.toFixed(0)}`;
  const spHi = spBand.hi === OPEN_HI ? "…" : `${spBand.hi.toFixed(0)}`;
  const cautionDetail = `Caution: body band ${planetTempBand.minK.toFixed(0)}–${planetTempBand.maxK.toFixed(0)} K (estimator) does not overlap species ${spLo}–${spHi} K. Only DSS row for this genus — included with ${(tempSlackRatio * 100).toFixed(0)}% slack toward species (${expanded.minK.toFixed(0)}–${expanded.maxK.toFixed(0)} K). Surface model is approximate; verify in-game.`;

  const reasonsWithoutSurf = full.reasons.filter((r) => r.field !== "SurfaceTemperature");
  return {
    entry,
    reasons: [...reasonsWithoutSurf, { field: "SurfaceTemperature", detail: cautionDetail }],
    approximateMatch: true,
  };
}

/** Planet band vs species band: overlap ⇒ inhabitable somewhere on the body. */
function tempBandsOverlap(planet: PlanetTemperatureBand, species: { lo: number; hi: number }): boolean {
  return planet.minK <= species.hi && species.lo <= planet.maxK;
}

function resolvePlanetTemperatureBand(
  scan: PlanetScan,
  est: { tMin: number; tMax: number } | null,
): PlanetTemperatureBand | null {
  if (est) return { minK: est.tMin, maxK: est.tMax };
  if (scan.SurfaceTemperature != null && !Number.isNaN(scan.SurfaceTemperature)) {
    const t = scan.SurfaceTemperature;
    return { minK: t, maxK: t };
  }
  return null;
}

function tempSeparation(planet: PlanetTemperatureBand, species: { lo: number; hi: number }): number {
  if (tempBandsOverlap(planet, species)) return 0;
  if (planet.maxK < species.lo) return species.lo - planet.maxK;
  return planet.minK - species.hi;
}

function pressureSeparation(p: number, species: { lo: number; hi: number }): number {
  if (p >= species.lo && p <= species.hi) return 0;
  if (p < species.lo) return species.lo - p;
  return p - species.hi;
}

function matchScoreTempPressure(
  scan: PlanetScan,
  planetBand: PlanetTemperatureBand | null,
  c: SpeciesCriterion,
): { score: number; tempSep: number; pressSep: number } {
  let tempSep = 0;
  const st = speciesTempBand(c);
  if (st) {
    if (planetBand) tempSep = tempSeparation(planetBand, st);
    else tempSep = 1e6;
  }

  let pressSep = 0;
  const pb = speciesPressureBand(c);
  const surfP = scan.SurfacePressure;
  if (pb && surfP != null && !Number.isNaN(surfP)) pressSep = pressureSeparation(surfP, pb);
  else if (pb && (surfP === undefined || surfP === null)) pressSep = 1e3;

  return { score: tempSep + PRESSURE_WEIGHT * pressSep, tempSep, pressSep };
}

/**
 * All journal gates except temperature and pressure (used to pick fallback candidates).
 */
export function speciesMatchesExcludingTempPressure(
  entry: SpeciesEntry,
  scan: PlanetScan,
  matchContext?: SpeciesMatchContext | null,
): { ok: boolean; reasons: MatchReason[] } {
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
    failures.push({
      field: "PlanetClass",
      detail: `Needs one of: ${c.planetClassAnyOf.join(", ")} — journal has “${scan.PlanetClass}”.`,
    });
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
    if (
      atmosphereAllowlistMeansAnyThinCompositionOnly(allowed) &&
      c.atmospherePressureCategory === "thin"
    ) {
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
          const detail =
            p != null && Number.isFinite(p)
              ? `Any thin atmosphere: ${p.toFixed(3)} atm exceeds thin cutoff (${THIN_ATMOSPHERE_MAX_ATM} atm after journal conversion).`
              : `Any thin atmosphere: need DSS surface pressure ≤ ${THIN_ATMOSPHERE_MAX_ATM} atm, or AtmosphereType containing “Thin …”.`;
          failures.push({ field: "AtmosphereType", detail });
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
          failures.push({
            field: "AtmosphereType",
            detail: `Need one of: ${allowedStr}; got ${atmoNorm === "" ? "(none)" : atmoNorm}`,
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

  if ((genusNeedsVolcano || criteriaVolcanoFragments || explicitVolcanoRequired) && !journalReportsAnyVolcanism(scan)) {
    failures.push({
      field: "Volcanism",
      detail: genusNeedsVolcano
        ? "This genus requires active volcanism; journal has an empty or missing Volcanism field (treated as no volcanism)."
        : explicitVolcanoRequired && !criteriaVolcanoFragments
          ? "Species criteria require active volcanism; journal has none listed."
          : `Species criteria require volcanism (${(c.volcanismIncludes ?? []).join(" / ")}); journal has no volcanism listed.`,
    });
  }

  if (criteriaVolcanoFragments) {
    const okV = volcanismJournalMatchesFragments(scan.Volcanism, c.volcanismIncludes!);
    if (!okV) {
      failures.push({
        field: "Volcanism",
        detail: `Need fragment: ${c.volcanismIncludes!.join(" / ")}; journal: ${scan.Volcanism || "(empty)"}`,
      });
    } else {
      reasons.push({ field: "Volcanism", detail: scan.Volcanism || "" });
    }
  } else if (genusNeedsVolcano && journalReportsAnyVolcanism(scan)) {
    reasons.push({ field: "Volcanism", detail: scan.Volcanism || "" });
  }

  const gRaw = scan.SurfaceGravity;
  if (c.surfaceGravity && gRaw !== undefined) {
    const g = journalSurfaceGravityToG(gRaw);
    if (!inRange(g, c.surfaceGravity.min, c.surfaceGravity.max)) {
      failures.push({
        field: "SurfaceGravity",
        detail: `${g.toFixed(3)} g (journal ${gRaw.toFixed(2)} m/s²) outside ${c.surfaceGravity.min ?? "−∞"}…${c.surfaceGravity.max ?? "∞"}`,
      });
    } else {
      reasons.push({
        field: "SurfaceGravity",
        detail: `${g.toFixed(3)} g (${gRaw.toFixed(2)} m/s²)`,
      });
    }
  }

  const starFrags = c.parentStarTypeIncludesAnyOf;
  if (starFrags?.length && ctx?.parentStarType?.trim()) {
    const host = ctx.parentStarType.toLowerCase();
    const okStar = starFrags.some((f) => host.includes((f ?? "").trim().toLowerCase()));
    if (!okStar) {
      failures.push({
        field: "StarType",
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
      if (excluded) {
        failures.push({
          field: "StarType",
          detail: `Genus colour table has no variant for host class ${specKeys.join("/")} — “${ctx.parentStarType}”.`,
        });
      }
    }
  }

  const orb = c.orbitDistanceFromParentStarLs;
  if (orb && (orb.min !== undefined || orb.max !== undefined) && ctx?.orbitDistanceFromParentStarLs != null) {
    const v = ctx.orbitDistanceFromParentStarLs;
    if (!inRange(v, orb.min, orb.max)) {
      failures.push({
        field: "Orbit",
        detail: `Orbit ${v.toFixed(0)} LS from host star — species expects ${orb.min ?? "−∞"}…${orb.max ?? "∞"} LS (semi-major axis → LS).`,
      });
    } else {
      reasons.push({ field: "Orbit", detail: `${v.toFixed(0)} LS from host` });
    }
  }

  const cat = c.atmospherePressureCategory;
  if (cat && ctx?.surfacePressureAtm != null && Number.isFinite(ctx.surfacePressureAtm)) {
    const p = ctx.surfacePressureAtm;
    if (cat === "thin" && p > THIN_ATMOSPHERE_MAX_ATM) {
      failures.push({
        field: "SurfacePressure",
        detail: `Thin atmosphere gate: ${p.toFixed(3)} atm > ${THIN_ATMOSPHERE_MAX_ATM} atm (after journal → atm conversion).`,
      });
    } else if (cat === "thick" && p <= THIN_ATMOSPHERE_MAX_ATM) {
      failures.push({
        field: "SurfacePressure",
        detail: `Thick atmosphere gate: ${p.toFixed(3)} atm ≤ ${THIN_ATMOSPHERE_MAX_ATM} atm.`,
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
    return { ok: false, reasons: failures };
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
): { ok: boolean; reasons: SpeciesMatch["reasons"] } {
  const base = speciesMatchesExcludingTempPressure(entry, scan, matchContext);
  const failures: MatchReason[] = base.ok ? [] : [...base.reasons];
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
      const estNote = estimatedRange
        ? `Estimated surface band ${planetTempBand.minK}–${planetTempBand.maxK} K (mid ~${estimatedRange.tMid} K) does not overlap species ${band.lo === OPEN_LO ? "≤" : ""}${band.lo === OPEN_LO ? band.hi : band.lo}${band.lo !== OPEN_LO && band.hi !== OPEN_HI ? "–" : ""}${band.hi === OPEN_HI ? "" : band.hi} K.`
        : `Journal / planet band ${planetTempBand.minK}–${planetTempBand.maxK} K does not overlap species range.`;
      failures.push({ field: "SurfaceTemperature", detail: estNote });
    } else {
      const surf = scan.SurfaceTemperature;
      const bandTxt =
        estimatedRange != null
          ? `Band ${planetTempBand.minK}–${planetTempBand.maxK} K (journal ${surf != null ? `${surf.toFixed(1)} K` : "n/a"}, heuristic mid ~${estimatedRange.tMid} K) overlaps species gate`
          : `Band ${planetTempBand.minK}–${planetTempBand.maxK} K overlaps species gate`;
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
    const applies =
      linkedAtmo?.length ?
        (() => {
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
      : !!(c.atmosphereTypeAnyOf?.length);

    if (applies) {
      if (!planetTempBand) {
        failures.push({
          field: "SurfaceTemperature",
          detail:
            "Atmosphere-linked temperature cap needs SurfaceTemperature (or a mappable PlanetClass) to estimate the surface band.",
        });
      } else if (planetTempBand.maxK > linkedMax) {
        failures.push({
          field: "SurfaceTemperature",
          detail: `With matching atmosphere, codex caps the mean band at ≤ ${linkedMax} K (estimated band max ${planetTempBand.maxK.toFixed(0)} K).`,
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
    } else if (!inRange(p, c.surfacePressure.min, c.surfacePressure.max)) {
      failures.push({
        field: "SurfacePressure",
        detail: `${p.toFixed(2)} atm outside allowed ${c.surfacePressure.min ?? "−∞"}…${c.surfacePressure.max ?? "∞"}`,
      });
    } else {
      extraOkReasons.push({ field: "SurfacePressure", detail: `${p.toFixed(2)} atm` });
    }
  }

  if (failures.length > 0) {
    return { ok: false, reasons: failures };
  }

  return { ok: true, reasons: [...base.reasons, ...extraOkReasons] };
}

export interface MatchDatabaseRun {
  matches: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[];
  genusFilterActive: boolean;
  dssGenusNarrowing: boolean;
  estimatedSurfaceTempK: EstimatedSurfaceTempBand | null;
  approximateMatchingUsed: boolean;
  /** True when matches are DSS-genus rows chosen by nearest codex temperature only; see {@link SpeciesMatch.dssNearestTemperatureMatch}. */
  dssNearestTemperatureFallback?: boolean;
}

export function matchDatabaseToScan(
  db: SpeciesDatabase,
  scan: PlanetScan,
  genusHints: GenusHint[] | null,
  organicGenusLocks: OrganicGenusLock[] | null | undefined,
  options?: {
    includeBacterium?: boolean;
    matchContext?: SpeciesMatchContext | null;
    dssPhysicalSlack?: DssPhysicalSlackRatios;
  },
): MatchDatabaseRun {
  const includeBacterium = options?.includeBacterium === true;
  const matchContext = options?.matchContext ?? null;
  const dssPhysicalSlack: DssPhysicalSlackRatios = options?.dssPhysicalSlack ?? {
    temperature: 0,
    pressure: 0,
    gravity: 0,
  };
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
  for (const entry of narrowed) {
    const { ok, reasons } = speciesMatchesCriteria(entry, scan, planetTempBand, est, matchContext);
    if (ok) strict.push({ entry, reasons });
  }

  if (strict.length > 0) {
    const { matches, injected } = injectOrganicLockConfirmedSpecies(strict, organicGenusLocks, db);
    return {
      matches,
      genusFilterActive,
      dssGenusNarrowing,
      estimatedSurfaceTempK,
      approximateMatchingUsed: injected,
    };
  }

  if (genusFilterActive && narrowed.length > 0) {
    const dssSlack = buildDssGenusSlackPhysicalMatches(
      narrowed,
      scan,
      planetTempBand,
      est,
      matchContext,
      dssPhysicalSlack,
    );
    if (dssSlack.length > 0) {
      const { matches, injected } = injectOrganicLockConfirmedSpecies(dssSlack, organicGenusLocks, db);
      return {
        matches,
        genusFilterActive,
        dssGenusNarrowing,
        estimatedSurfaceTempK,
        approximateMatchingUsed: true,
        dssNearestTemperatureFallback: true,
      };
    }
  }

  if (genusFilterActive && planetTempBand && narrowed.length > 0) {
    const dssNearest = buildDssGenusNearestTemperatureMatches(narrowed, planetTempBand);
    if (dssNearest.length > 0) {
      const { matches, injected } = injectOrganicLockConfirmedSpecies(dssNearest, organicGenusLocks, db);
      return {
        matches,
        genusFilterActive,
        dssGenusNarrowing,
        estimatedSurfaceTempK,
        approximateMatchingUsed: true,
        dssNearestTemperatureFallback: true,
      };
    }
  }

  const genusCounts = new Map<string, number>();
  for (const e of narrowed) {
    genusCounts.set(e.genusDataDir, (genusCounts.get(e.genusDataDir) ?? 0) + 1);
  }

  const slackCaution: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[] = [];
  if (planetTempBand) {
    for (const entry of narrowed) {
      if (genusCounts.get(entry.genusDataDir) !== 1) continue;
      const m = tryLoneGenusSpeciesSlackTemperatureMatch(
        entry,
        scan,
        planetTempBand,
        est,
        matchContext,
        dssPhysicalSlack.temperature,
      );
      if (m) slackCaution.push(m);
    }
  }

  if (slackCaution.length > 0) {
    const { matches, injected } = injectOrganicLockConfirmedSpecies(slackCaution, organicGenusLocks, db);
    return {
      matches,
      genusFilterActive,
      dssGenusNarrowing,
      estimatedSurfaceTempK,
      approximateMatchingUsed: true,
    };
  }

  // Detailed scan but no strict matches: closest by temperature/pressure distance.
  const candidates: { entry: SpeciesEntry; reasons: MatchReason[]; score: number }[] = [];
  for (const entry of narrowed) {
    const ex = speciesMatchesExcludingTempPressure(entry, scan, matchContext);
    if (!ex.ok) continue;
    const { score, tempSep, pressSep } = matchScoreTempPressure(scan, planetTempBand, entry.criteria);
    const band = speciesTempBand(entry.criteria);
    const needsTemp = speciesNeedsTemperatureGate(entry.criteria);
    const needsPress =
      !!entry.criteria.surfacePressure &&
      (entry.criteria.surfacePressure.min !== undefined ||
        entry.criteria.surfacePressure.max !== undefined);

    if (!needsTemp && !needsPress) continue;

    const approxReasons: MatchReason[] = [
      ...ex.reasons.filter((r) => r.field !== "Source"),
      {
        field: "Match mode",
        detail:
          "No strict temperature/pressure match — showing closest database row(s) by distance to your scan (approximate only).",
      },
    ];

    if (needsTemp && planetTempBand && band) {
      approxReasons.push({
        field: "SurfaceTemperature",
        detail: `Approximate: estimated band ${planetTempBand.minK}–${planetTempBand.maxK} K vs species ${band.lo === OPEN_LO ? "…" : band.lo.toFixed(0)}–${band.hi === OPEN_HI ? "…" : band.hi.toFixed(0)} K (gap ${tempSep.toFixed(1)} K)`,
      });
    } else if (needsTemp && !planetTempBand) {
      approxReasons.push({
        field: "SurfaceTemperature",
        detail: "Approximate: could not build planet temperature band — score uses pressure only.",
      });
    }

    if (needsPress && scan.SurfacePressure != null && speciesPressureBand(entry.criteria)) {
      const pb = speciesPressureBand(entry.criteria)!;
      approxReasons.push({
        field: "SurfacePressure",
        detail: `Approximate: journal ${scan.SurfacePressure.toFixed(2)} atm vs species ${pb.lo === OPEN_LO ? "…" : pb.lo}–${pb.hi === OPEN_HI ? "…" : pb.hi} atm (gap ${pressSep.toFixed(3)} × weighted in score)`,
      });
    }

    if (entry.dataSourceRelPath) {
      approxReasons.push({ field: "Source", detail: entry.dataSourceRelPath });
    }

    candidates.push({ entry, reasons: approxReasons, score });
  }

  if (candidates.length === 0) {
    const { matches, injected } = injectOrganicLockConfirmedSpecies([], organicGenusLocks, db);
    return {
      matches,
      genusFilterActive,
      dssGenusNarrowing,
      estimatedSurfaceTempK,
      approximateMatchingUsed: injected,
    };
  }

  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0]!.score;
  const picked = candidates.filter((c) => c.score <= best + 1e-9).slice(0, CLOSEST_MATCH_CAP);

  const pickedMatches: Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">[] = picked.map((c) => ({
    entry: c.entry,
    reasons: c.reasons,
    approximateMatch: true,
  }));
  const { matches: withLocks } = injectOrganicLockConfirmedSpecies(pickedMatches, organicGenusLocks, db);

  return {
    matches: withLocks,
    genusFilterActive,
    dssGenusNarrowing,
    estimatedSurfaceTempK,
    approximateMatchingUsed: true,
  };
}
