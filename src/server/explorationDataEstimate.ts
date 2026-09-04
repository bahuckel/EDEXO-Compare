import type { ExplorationScanRecord } from "../shared/types.js";
import type { GameStateStore } from "./gameState.js";
import { bodyScanValueCredits, starScanValueCredits } from "./explorationValue.js";
import { explorationRecordIsStellar } from "./explorationStellar.js";

/** DSS first-mapper multiplier: use value frozen at `SAAScanComplete` when present (see `dssFirstMapperEligibleByBodyKey`). */
export function firstMapperForDssPayout(
  store: GameStateStore,
  bodyKey: string,
  r: ExplorationScanRecord,
  mapped: boolean,
): boolean {
  if (!mapped) return false;
  const frozen = store.dssFirstMapperEligibleByBodyKey.get(bodyKey);
  if (frozen !== undefined) return frozen;
  return r.wasMapped === false;
}

const isExplorationStarRecord = explorationRecordIsStellar;

function terraformableFromExplorationRecord(r: ExplorationScanRecord): boolean {
  return (r.terraformState ?? "").toLowerCase().includes("terraformable");
}

/** Belt clusters — skip for UC-style exploration totals (same as system map). */
function isBeltExplorationRecord(r: ExplorationScanRecord): boolean {
  const bt = (r.bodyType ?? "").replace(/\s+/g, "").toLowerCase();
  if (bt === "asteroidcluster") return true;
  const pc = (r.planetClass ?? "").toLowerCase();
  if (pc.includes("belt cluster") || pc.includes("asteroid cluster")) return true;
  const bn = (r.bodyName ?? "").toLowerCase();
  if (bn.includes("belt cluster")) return true;
  return false;
}

/** Journal `Scan.WasDiscovered`: `false` = commander is first discoverer (bonus). */
function firstDiscovererFromRecord(r: ExplorationScanRecord): boolean {
  return r.wasDiscovered === false;
}

/**
 * Approximate exploration-data UC value from merged journal `Scan` rows + DSS completion.
 * Uses `WasDiscovered` for discovery bonus; DSS mapped value uses `WasMapped` frozen at `SAAScanComplete`
 * so post-map `Scan` events do not strip first-mapper credit (MattG / Pioneer-style formulae).
 */
export function estimateExplorationJournalDataCredits(store: GameStateStore): number {
  let total = 0;
  for (const [k, r] of store.explorationScans) {
    if (isBeltExplorationRecord(r)) continue;
    const tf = terraformableFromExplorationRecord(r);
    const mass = r.massEM ?? 1;
    const mapped = store.dssMappedBodyKeys.has(k);
    const isStar = isExplorationStarRecord(r);
    const fd = firstDiscovererFromRecord(r);
    if (isStar) {
      const sm = r.stellarMass ?? 1;
      const sv = starScanValueCredits(sm, r.starType, fd);
      total += sv.value;
    } else if (r.planetClass) {
      const fm = firstMapperForDssPayout(store, k, r, mapped);
      const eff = mapped && store.dssMappingEfficientByBodyKey.get(k) === true;
      const v = bodyScanValueCredits(r.planetClass, tf, mass, fd, fm, false, eff);
      total += mapped ? v.dssMapped : v.fss;
    }
  }
  return Math.round(total);
}

/**
 * Data Value modal: FSS from journal `FSSBodySignals` (unique body keys), DSS from `SAAScanComplete` (planetary only).
 * Credits need merged `Scan` rows where present (belts excluded from value sums).
 */
export function explorationDataValueBreakdown(store: GameStateStore): {
  fssScanCount: number;
  fssValueCredits: number;
  dssScanCount: number;
  dssValueCredits: number;
} {
  let fssValue = 0;
  for (const k of store.fssBodySignalsBodyKeys) {
    const r = store.explorationScans.get(k);
    if (!r || isBeltExplorationRecord(r)) continue;
    const tf = terraformableFromExplorationRecord(r);
    const mass = r.massEM ?? 1;
    const fd = firstDiscovererFromRecord(r);
    const isStar = isExplorationStarRecord(r);
    if (isStar) {
      const sm = r.stellarMass ?? 1;
      fssValue += starScanValueCredits(sm, r.starType, fd).value;
    } else if (r.planetClass) {
      fssValue += bodyScanValueCredits(r.planetClass, tf, mass, fd, false, false, false).fss;
    }
  }

  let dssValue = 0;
  let dssScanCount = 0;
  for (const bk of store.dssMappedBodyKeys) {
    const r = store.explorationScans.get(bk);
    if (!r || isBeltExplorationRecord(r)) continue;
    const isStar = isExplorationStarRecord(r);
    if (!isStar && r.planetClass) {
      dssScanCount += 1;
      const tf = terraformableFromExplorationRecord(r);
      const mass = r.massEM ?? 1;
      const fd = firstDiscovererFromRecord(r);
      const fm = firstMapperForDssPayout(store, bk, r, true);
      const eff = store.dssMappingEfficientByBodyKey.get(bk) === true;
      dssValue += bodyScanValueCredits(r.planetClass, tf, mass, fd, fm, false, eff).dssMapped;
    }
  }

  return {
    fssScanCount: store.fssBodySignalsBodyKeys.size,
    fssValueCredits: Math.round(fssValue),
    dssScanCount,
    dssValueCredits: Math.round(dssValue),
  };
}

/** Moons/planets with `SAAScanComplete` in journal (excludes stars and asteroid belts). */
export function countDssMappedPlanetaryBodies(store: GameStateStore): number {
  let n = 0;
  for (const bk of store.dssMappedBodyKeys) {
    const r = store.explorationScans.get(bk);
    if (!r || isBeltExplorationRecord(r)) continue;
    const isStar = isExplorationStarRecord(r);
    if (!isStar && r.planetClass) n++;
  }
  return n;
}

/**
 * Same heuristic as {@link estimateExplorationJournalDataCredits} limited to one `systemAddress`
 * (focused system — Interstellar Factors style sell total for merged Scan rows there).
 */
export function estimateExplorationJournalDataCreditsForSystem(
  store: GameStateStore,
  systemAddress: number,
): number {
  let total = 0;
  const pref = `${systemAddress}:`;
  for (const [k, r] of store.explorationScans) {
    if (!k.startsWith(pref)) continue;
    if (isBeltExplorationRecord(r)) continue;
    const tf = terraformableFromExplorationRecord(r);
    const mass = r.massEM ?? 1;
    const mapped = store.dssMappedBodyKeys.has(k);
    const isStar = isExplorationStarRecord(r);
    const fd = firstDiscovererFromRecord(r);
    if (isStar) {
      const sm = r.stellarMass ?? 1;
      const sv = starScanValueCredits(sm, r.starType, fd);
      total += sv.value;
    } else if (r.planetClass) {
      const fm = firstMapperForDssPayout(store, k, r, mapped);
      const eff = mapped && store.dssMappingEfficientByBodyKey.get(k) === true;
      const v = bodyScanValueCredits(r.planetClass, tf, mass, fd, fm, false, eff);
      total += mapped ? v.dssMapped : v.fss;
    }
  }
  return Math.round(total);
}
