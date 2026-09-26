import type { ExplorationScanRecord } from "../shared/types.js";
import type { GameStateStore } from "./gameState.js";
import { bodyScanValueCredits, starScanValueCredits } from "./explorationValue.js";
import { explorationRecordIsStellar } from "./explorationStellar.js";
import { commanderFirstDiscoveredBody } from "./developerPopulatedSystems.js";

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

/** Journal `Scan.WasDiscovered`: `false` = commander is first discoverer (bonus) — never in the Bubble. */
function firstDiscovererFromRecord(r: ExplorationScanRecord): boolean {
  return commanderFirstDiscoveredBody(r.systemAddress, r.wasDiscovered);
}

/**
 * Whether a merged row is worth anything to the unsold total.
 *
 * Belt clusters never are; a body only a nav beacon described cannot be sold; and a body already sold
 * stays sold when it is scanned again ({@link GameStateStore.soldBodyKeys}).
 */
function unsoldValueCounts(store: GameStateStore, key: string, r: ExplorationScanRecord): boolean {
  if (isBeltExplorationRecord(r)) return false;
  if (r.playerScanned === false) return false;
  return !store.soldBodyKeys.has(key);
}

/**
 * The unsold exploration data, split the way the Data Value modal shows it.
 *
 * - **FSS row:** every star and body scanned but not mapped — honk, FSS, arrival auto-scan.
 * - **DSS row:** every planet mapped with the surface scanner, at its mapped value.
 *
 * This is the only estimator. The header pill, the HUD and the modal used to run two different ones:
 * the pill summed every merged row, the modal only bodies that had carried an `FSSBodySignals` line.
 * After a sale the rows the sale never touched (nav-beacon scans, re-scanned sold bodies) stayed in
 * the pill and not in the modal — "unsold data" on the main screen, 0 in the breakdown (Discord,
 * 2026-09-25). Now the pill is the sum of these rows.
 */
export function explorationDataValueBreakdown(
  store: GameStateStore,
  systemAddress?: number,
): {
  fssScanCount: number;
  fssValueCredits: number;
  dssScanCount: number;
  dssValueCredits: number;
  totalCredits: number;
} {
  const pref = systemAddress != null ? `${systemAddress}:` : null;
  let fssCount = 0;
  let fssValue = 0;
  let dssCount = 0;
  let dssValue = 0;
  for (const [k, r] of store.explorationScans) {
    if (pref && !k.startsWith(pref)) continue;
    if (!unsoldValueCounts(store, k, r)) continue;
    const fd = firstDiscovererFromRecord(r);
    if (isExplorationStarRecord(r)) {
      fssCount += 1;
      fssValue += starScanValueCredits(r.stellarMass ?? 1, r.starType, fd).value;
      continue;
    }
    if (!r.planetClass) continue;
    const tf = terraformableFromExplorationRecord(r);
    const mass = r.massEM ?? 1;
    const mapped = store.dssMappedBodyKeys.has(k);
    const fm = firstMapperForDssPayout(store, k, r, mapped);
    const eff = mapped && store.dssMappingEfficientByBodyKey.get(k) === true;
    const v = bodyScanValueCredits(r.planetClass, tf, mass, fd, fm, false, eff);
    if (mapped) {
      dssCount += 1;
      dssValue += v.dssMapped;
    } else {
      fssCount += 1;
      fssValue += v.fss;
    }
  }
  const fssValueCredits = Math.round(fssValue);
  const dssValueCredits = Math.round(dssValue);
  return {
    fssScanCount: fssCount,
    fssValueCredits,
    dssScanCount: dssCount,
    dssValueCredits,
    totalCredits: fssValueCredits + dssValueCredits,
  };
}

/** Unsold exploration data value — the header pill and HUD. The sum of {@link explorationDataValueBreakdown}. */
export function estimateExplorationJournalDataCredits(store: GameStateStore): number {
  return explorationDataValueBreakdown(store).totalCredits;
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

/** {@link estimateExplorationJournalDataCredits} limited to one `systemAddress` (the focused system). */
export function estimateExplorationJournalDataCreditsForSystem(
  store: GameStateStore,
  systemAddress: number,
): number {
  return explorationDataValueBreakdown(store, systemAddress).totalCredits;
}
