import type { ExplorationScanRecord } from "../shared/types.js";
import type { GameStateStore } from "./gameState.js";
import { bodyScanValueCredits, starScanValueCredits, systemHonkCredits, type HonkBody } from "./explorationValue.js";
import { explorationRecordIsStellar } from "./explorationStellar.js";
import { commanderFirstDiscoveredBody } from "./developerPopulatedSystems.js";
import { isTerraformableState } from "../shared/terraformState.js";

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
  return isTerraformableState(r.terraformState);
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
type ExplorationBreakdown = ReturnType<typeof explorationDataValueBreakdownUncached>;

/*
  The whole-history total is walked on every snapshot — every scan the commander ever made, with the
  value formula for each — and was a quarter of a live refresh (code review §E, 2026-09-27). Kept until
  anything it reads moves: the scans (revision), what was sold, and the three DSS maps (sizes and how
  many are true, so a flip without a size change still counts).
*/
// Per store: two stores with the same counts are still two histories (tests hold several at once).
const wholeHistoryMemo = new WeakMap<GameStateStore, { sig: string; value: ExplorationBreakdown }>();

function trueCount(m: Map<string, boolean>): number {
  let n = 0;
  for (const v of m.values()) if (v) n++;
  return n;
}

export function explorationDataValueBreakdown(store: GameStateStore, systemAddress?: number): ExplorationBreakdown {
  if (systemAddress != null) return explorationDataValueBreakdownUncached(store, systemAddress);
  const sig = [
    store.explorationScansRevision,
    store.explorationScans.size,
    store.soldBodyKeys.size,
    store.dssMappedBodyKeys.size,
    store.dssFirstMapperEligibleByBodyKey.size,
    trueCount(store.dssFirstMapperEligibleByBodyKey),
    store.dssMappingEfficientByBodyKey.size,
    trueCount(store.dssMappingEfficientByBodyKey),
  ].join("|");
  const hit = wholeHistoryMemo.get(store);
  if (hit?.sig === sig) return hit.value;
  const value = explorationDataValueBreakdownUncached(store);
  wholeHistoryMemo.set(store, { sig, value });
  return value;
}

function explorationDataValueBreakdownUncached(
  store: GameStateStore,
  systemAddress?: number,
): {
  fssScanCount: number;
  fssValueCredits: number;
  /** Part of {@link fssValueCredits}: the honk, paid with each unsold system that has its arrival star. */
  honkValueCredits: number;
  dssScanCount: number;
  dssValueCredits: number;
  totalCredits: number;
} {
  let fssCount = 0;
  let fssValue = 0;
  let dssCount = 0;
  let dssValue = 0;
  // Per system: the arrival star (and whether it is a first discovery) and the other unsold bodies.
  const honkBySystem = new Map<number, { arrivalFd: boolean | null; bodies: HonkBody[] }>();
  const honkOf = (addr: number) => {
    let h = honkBySystem.get(addr);
    if (!h) honkBySystem.set(addr, (h = { arrivalFd: null, bodies: [] }));
    return h;
  };
  /*
    One system: its records from the store's per-system index, not a prefix test over every scan the
    commander ever made (the system map asks this on each snapshot; ~0.6 ms, profiled 2026-10-01).
  */
  const rows: Iterable<[string, ExplorationScanRecord]> =
    systemAddress != null
      ? store.liveScansInSystem(systemAddress).map((r) => [`${r.systemAddress}:${r.bodyId}`, r] as [string, ExplorationScanRecord])
      : store.explorationScans;
  for (const [k, r] of rows) {
    if (!unsoldValueCounts(store, k, r)) continue;
    const fd = firstDiscovererFromRecord(r);
    if (isExplorationStarRecord(r)) {
      fssCount += 1;
      fssValue += starScanValueCredits(r.stellarMass ?? 1, r.starType, fd).value;
      if (!((r.distanceFromArrivalLs ?? 0) > 0)) honkOf(r.systemAddress).arrivalFd = fd;
      else honkOf(r.systemAddress).bodies.push({ kind: "star", stellarMass: r.stellarMass ?? 1, starType: r.starType });
      continue;
    }
    if (!r.planetClass) continue;
    const tf = terraformableFromExplorationRecord(r);
    const mass = r.massEM ?? 1;
    honkOf(r.systemAddress).bodies.push({ kind: "planet", planetClass: r.planetClass, terraformable: tf, massEM: mass });
    const mapped = store.dssMappedBodyKeys.has(k);
    const fm = firstMapperForDssPayout(store, k, r, mapped);
    const eff = mapped && store.dssMappingEfficientByBodyKey.get(k) === true;
    const v = bodyScanValueCredits(r.planetClass, tf, mass, fd, fm, true, eff);
    if (mapped) {
      dssCount += 1;
      dssValue += v.dssMapped;
    } else {
      fssCount += 1;
      fssValue += v.fss;
    }
  }
  let honkValue = 0;
  for (const h of honkBySystem.values()) {
    if (h.arrivalFd != null) honkValue += systemHonkCredits(h.bodies, h.arrivalFd);
  }
  fssValue += honkValue;
  const fssValueCredits = Math.round(fssValue);
  const dssValueCredits = Math.round(dssValue);
  return {
    fssScanCount: fssCount,
    fssValueCredits,
    honkValueCredits: Math.round(honkValue),
    dssScanCount: dssCount,
    dssValueCredits,
    totalCredits: fssValueCredits + dssValueCredits,
  };
}

/** Unsold exploration data value — the header pill and HUD. The sum of {@link explorationDataValueBreakdown}. */
export function estimateExplorationJournalDataCredits(store: GameStateStore): number {
  return explorationDataValueBreakdown(store).totalCredits;
}

/** {@link estimateExplorationJournalDataCredits} limited to one `systemAddress` (the focused system). */
export function estimateExplorationJournalDataCreditsForSystem(
  store: GameStateStore,
  systemAddress: number,
): number {
  return explorationDataValueBreakdown(store, systemAddress).totalCredits;
}
