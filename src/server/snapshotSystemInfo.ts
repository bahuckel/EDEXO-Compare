/**
 * The system-level parts of the snapshot: the journal systems list, the looked-up system's view, the D-scan count, the fuel range line, notable bodies. Split out of snapshot.ts (code review D, 2026-09-27).
 */
import { greenGiantLabel } from "../shared/greenGasGiant.js";
import { bodyFeatures, directParent } from "../shared/bodyFeatures.js";
import { notableOptions } from "./notableOptions.js";
import { greenGiantForRecord, type GreenGiantSources } from "./greenGiants.js";
import { isTerraformableState } from "../shared/terraformState.js";
import type {
  DScanBodiesDTO,
  ExplorationScanRecord,
  JournalSystemInfo,
  LiveShipFuelRangeDTO,
  NotableBodyInfo,
  RemoteViewDTO,
  SystemMapSnapshot,
} from "../shared/types.js";
import {
  explorationRecordIsBeltClusterLike,
  explorationRecordIsClearlyWorld,
  explorationRecordIsStellar,
} from "./explorationStellar.js";
import { FirstFootfallLookup } from "./firstFootfallLookup.js";
import type { GameStateStore } from "./gameState.js";
import { analyzeNavRouteFuel } from "./navRouteFuel.js";
import { isBarycentreSyntheticBodyId } from "./orbitUtils.js";
import { StarRolesConfig, countPhysicalBodiesInSystemMapTree } from "./systemMap.js";

/**
 * One lookup for the life of the process, bound to whichever store is building the snapshot.
 *
 * It caches verdicts and rate-limits itself, so it has to outlive a single snapshot; the store
 * reference is refreshed rather than the object rebuilt, or every snapshot would start with an empty
 * cache and ask EDSM again.
 */
let firstFootfallLookup: FirstFootfallLookup | null = null;
let firstFootfallStore: { hasVisitedSystemNamed: (name: string) => boolean } | null = null;

export function firstFootfallLookupFor(store: {
  hasVisitedSystemNamed: (name: string) => boolean;
}): FirstFootfallLookup {
  firstFootfallStore = store;
  firstFootfallLookup ??= new FirstFootfallLookup({
    hasVisited: (name) => firstFootfallStore?.hasVisitedSystemNamed(name) ?? false,
  });
  return firstFootfallLookup;
}

/**
 * Journal-system list, memoized.
 *
 * Building it walks every visited system, body, journal scan, EDSM record and FSS map in the store
 * (hundreds of thousands of entries after a long play history) and then sorts the result. It was
 * 116 ms of the 186 ms snapshot build — 62% — and it was redone on every push.
 *
 * The signature is the sizes of every collection the build reads. All of them only grow, and a name
 * is only ever filled in for an address that has none, so equal sizes mean an identical result.
 */
let cachedJournalSystems: { signature: string; value: JournalSystemInfo[] } | null = null;

/** One collator; `localeCompare` with options builds a new one per comparison. */
const systemNameCollator = new Intl.Collator(undefined, { sensitivity: "base" });

function journalSystemsSignature(store: GameStateStore): string {
  return [
    store.visitedSystems.size,
    store.bodies.size,
    store.explorationScans.size,
    store.edsmExplorationByKey.size,
    store.fssDiscoveryScanBySystem.size,
    store.fssAllBodiesFoundCountBySystem.size,
    store.fssAllBodiesCompleteSystems.size,
  ].join(":");
}

export function buildJournalSystems(store: GameStateStore): JournalSystemInfo[] {
  const signature = journalSystemsSignature(store);
  if (cachedJournalSystems && cachedJournalSystems.signature === signature) {
    return cachedJournalSystems.value;
  }
  const value = buildJournalSystemsUncached(store);
  cachedJournalSystems = { signature, value };
  return value;
}

function buildJournalSystemsUncached(store: GameStateStore): JournalSystemInfo[] {
  const byAddr = new Map<number, string>();
  for (const [addr, name] of store.visitedSystems) {
    byAddr.set(addr, name);
  }
  for (const b of store.bodies.values()) {
    const prev = byAddr.get(b.systemAddress);
    const fromBody = b.starSystem?.trim();
    if (!prev && fromBody) byAddr.set(b.systemAddress, fromBody);
  }
  const ensureAddrName = (addr: number, name: string | null | undefined) => {
    const n = name?.trim();
    if (!n) return;
    const prev = byAddr.get(addr);
    if (!prev) byAddr.set(addr, n);
  };
  for (const r of store.explorationScans.values()) {
    ensureAddrName(r.systemAddress, r.starSystem);
  }
  for (const r of store.edsmExplorationByKey.values()) {
    ensureAddrName(r.systemAddress, r.starSystem);
  }
  for (const [addr, disc] of store.fssDiscoveryScanBySystem) {
    ensureAddrName(addr, disc.systemName);
  }
  for (const addr of store.fssAllBodiesFoundCountBySystem.keys()) {
    const disc = store.fssDiscoveryScanBySystem.get(addr);
    ensureAddrName(addr, disc?.systemName ?? null);
    if (!byAddr.has(addr)) byAddr.set(addr, disc?.systemName?.trim() || `System ${addr}`);
  }
  for (const addr of store.fssAllBodiesCompleteSystems) {
    if (!byAddr.has(addr)) {
      const disc = store.fssDiscoveryScanBySystem.get(addr);
      byAddr.set(addr, disc?.systemName?.trim() || `System ${addr}`);
    }
  }
  const out: JournalSystemInfo[] = [];
  for (const [systemAddress, starSystem] of byAddr) {
    out.push({ systemAddress, starSystem });
  }
  out.sort((a, b) => systemNameCollator.compare(a.starSystem, b.starSystem));
  return out;
}

export function resolveViewingSystemName(store: GameStateStore, viewingAddr: number | null): string | null {
  if (viewingAddr == null) return null;
  const fromVisit = store.visitedSystems.get(viewingAddr);
  if (fromVisit?.trim()) return fromVisit.trim();
  for (const b of store.bodies.values()) {
    if (b.systemAddress === viewingAddr && b.starSystem?.trim()) return b.starSystem.trim();
  }
  // A looked-up system: its name comes with the lookup, never through the visited list.
  return (
    store.remoteSystems.get(viewingAddr)?.starSystem ??
    store.remoteLookups.get(viewingAddr)?.starSystem ??
    null
  );
}

/** The looked-up system on screen, while it is one: fetching, failed, or showing Spansh's bodies. */
export function buildRemoteView(store: GameStateStore): RemoteViewDTO | null {
  const addr = store.viewingSystemAddress;
  if (addr == null) return null;
  const pending = store.remoteLookups.get(addr);
  if (pending) {
    return {
      systemAddress: addr,
      starSystem: pending.starSystem,
      state: pending.state,
      ...(pending.error ? { error: pending.error } : {}),
    };
  }
  if (!store.isShowingRemoteSystem(addr)) return null;
  const sys = store.remoteSystems.get(addr)!;
  return {
    systemAddress: addr,
    starSystem: sys.starSystem,
    state: "ready",
    fetchedAt: sys.fetchedAt,
    sourceUpdatedAt: sys.sourceUpdatedAt,
    bodyCount: sys.records.length,
    bioBodyCount: sys.bio.length,
    ...(typeof sys.signalBodyCount === "number" ? { signalBodyCount: sys.signalBodyCount } : {}),
  };
}

export function scanBodyKey(systemAddress: number, bodyId: number): string {
  return `${systemAddress}:${bodyId}`;
}

/**
 * Journal progress is 0–1; converting with round() often overshoots (e.g. one body in an 8-body system).
 * Use a conservative integer body count from Progress alone.
 */
function fssHonkProgressBodyCount(progress: number, total: number): number {
  if (total <= 0) return 0;
  if (progress >= 1 - 1e-9) return total;
  const x = progress * total;
  return Math.min(total, Math.max(0, Math.floor(x + 1e-9)));
}

export function buildDScanBodiesSnapshot(
  store: GameStateStore,
  focusAddr: number | null,
  nameFallback: string | null,
  systemMap: SystemMapSnapshot | null,
): DScanBodiesDTO | null {
  if (focusAddr == null) return null;
  const disc = store.fssDiscoveryScanBySystem.get(focusAddr);
  const fromAllFound = store.fssAllBodiesFoundCountBySystem.get(focusAddr);
  const mapOk = systemMap != null && systemMap.systemAddress === focusAddr;
  const fromMapForFound = mapOk ? countPhysicalBodiesInSystemMapTree(systemMap.tree) : null;
  const fromMapInt = fromMapForFound ?? 0;

  const fromJournal = countMergedExplorationBodiesTowardDScanFound(store, focusAddr);

  /** FSS honk lines are absent for many pre-FSS / old journals — derive totals from Scan merge + map + EDSM. */
  let total = Math.max(disc?.bodyCount ?? 0, fromAllFound ?? 0);
  if (total <= 0) {
    total = Math.max(fromJournal, fromMapInt);
  } else {
    total = Math.max(total, fromJournal, fromMapInt);
  }

  if (total <= 0) return null;

  const systemName = disc?.systemName.trim() || nameFallback?.trim() || `System ${focusAddr}`;
  const complete = store.fssAllBodiesCompleteSystems.has(focusAddr);
  // Owner, 2026-09-25: say whether the system was honked. FSSAllBodiesFound counts as yes — a one-
  // or two-star system is finished without one, and "no honk" there tells the commander nothing.
  const honked = disc != null || fromAllFound != null || complete;
  if (complete) {
    return { systemName, found: total, total, complete: true, honked };
  }
  const fromProgress = disc ? fssHonkProgressBodyCount(disc.progress, total) : 0;
  const fallbackFound = Math.min(total, Math.max(0, fromProgress, fromJournal));
  const found = Math.min(total, fromMapForFound != null ? fromMapForFound : fallbackFound);
  return { systemName, found, total, complete: false, honked };
}

export function buildLiveShipFuelRangeDTO(
  store: GameStateStore,
  starRoles: StarRolesConfig,
): LiveShipFuelRangeDTO | null {
  const main = store.liveStatusFuelMainT;
  const res = store.liveStatusFuelReserveT;
  const hasLiveStatusFuel = (main != null && Number.isFinite(main)) || (res != null && Number.isFinite(res));
  const fuelMain = main != null && Number.isFinite(main) ? Math.max(0, main) : 0;
  const fuelRes = res != null && Number.isFinite(res) ? Math.max(0, res) : 0;
  const fuelTotalTForNav = hasLiveStatusFuel ? fuelMain + fuelRes : null;

  /*
    Ask about the systems ahead before the route is analysed, so the verdicts are in the cache by the
    time this snapshot or the next one reads them. The call is fire-and-forget and rate-limited
    inside the lookup; nothing here waits on the network.
  */
  const lookup = firstFootfallLookupFor(store);
  lookup.request((store.liveNavRoute ?? []).map((w) => w.starSystem));

  const navRoute = analyzeNavRouteFuel({
    route: store.liveNavRoute,
    currentSystemAddress: store.currentSystemAddress,
    currentSystemName: store.currentSystem,
    fuelTotalT: fuelTotalTForNav,
    lastFsdFuelT: store.lastFsdJumpFuelUsedT,
    lastFsdDistLy: store.lastFsdJumpDistLy,
    loadoutMaxJumpLy: store.loadoutMaxJumpRangeLy,
    starRoles,
    firstFootfallVerdict: (name) => lookup.verdict(name),
    firstFootfallNote: (name) => lookup.note(name),
  });

  if (!hasLiveStatusFuel && !navRoute) return null;

  const fuelTotal = hasLiveStatusFuel ? fuelMain + fuelRes : 0;
  const maxR = store.loadoutMaxJumpRangeLy;
  const fu = store.lastFsdJumpFuelUsedT;
  const jd = store.lastFsdJumpDistLy;
  let estFuelPerMaxJump: number | null = null;
  let calibration: LiveShipFuelRangeDTO["calibration"] = "none";
  if (maxR != null && maxR > 0 && fu != null && fu > 0 && jd != null && jd > 0) {
    estFuelPerMaxJump = fu * (maxR / jd);
    calibration = "fsd_sample";
  }
  const safetyT = 0.08;
  let estJumps: number | null = null;
  if (
    hasLiveStatusFuel &&
    estFuelPerMaxJump != null &&
    estFuelPerMaxJump > 1e-6 &&
    !(navRoute?.onPlot && typeof navRoute.routeJumpsRemaining === "number")
  ) {
    estJumps = Math.max(0, Math.floor(Math.max(0, fuelTotal - safetyT) / estFuelPerMaxJump));
  }

  return {
    hasLiveStatusFuel,
    fuelMainT: fuelMain,
    fuelReserveT: fuelRes,
    fuelTotalT: fuelTotal,
    maxJumpRangeLy: maxR,
    estFuelPerMaxJumpT: estFuelPerMaxJump,
    estJumpsRemaining: estJumps,
    calibration,
    navRoute,
  };
}

function isPlanetLikeExplorationRecord(rec: ExplorationScanRecord): boolean {
  if (explorationRecordIsStellar(rec)) return false;
  const bt = (rec.bodyType ?? "").trim().toLowerCase();
  if (bt === "star") return false;
  if (bt.includes("belt cluster")) return false;
  if (bt.includes("planetaryring")) return false;
  return !!(rec.planetClass?.trim() || (rec.terraformState ?? "").trim());
}

/** Bodies that count toward D-scan “found” as journal `Scan` rows merge (stars + worlds; not belts/rings/bary rows). */
function explorationRecordCountsTowardDScanFound(rec: ExplorationScanRecord): boolean {
  if (rec.isBarycentreJournal === true) return false;
  if (isBarycentreSyntheticBodyId(rec.bodyId)) return false;
  if (rec.isSynthetic === true) return false;
  if (explorationRecordIsBeltClusterLike(rec)) return false;
  const bt = (rec.bodyType ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (bt.includes("belt cluster")) return false;
  if (bt.includes("planetary ring") || bt.replace(/\s+/g, "") === "planetaryring") return false;
  if (explorationRecordIsStellar(rec)) return true;
  if (isPlanetLikeExplorationRecord(rec)) return true;
  if (explorationRecordIsClearlyWorld(rec)) return true;
  return false;
}

function countMergedExplorationBodiesTowardDScanFound(store: GameStateStore, systemAddress: number): number {
  const prefix = `${systemAddress}:`;
  const seenBodyIds = new Set<number>();
  const consider = (rec: ExplorationScanRecord) => {
    if (!explorationRecordCountsTowardDScanFound(rec)) return;
    seenBodyIds.add(rec.bodyId);
  };
  for (const rec of store.liveScansInSystem(systemAddress)) consider(rec);
  for (const [k, rec] of store.edsmExplorationByKey) {
    if (!k.startsWith(prefix)) continue;
    consider(rec);
  }
  return seenBodyIds.size;
}

function shortNotableBodyLabel(bodyName: string, candidates: (string | null | undefined)[]): string {
  const bn = bodyName.trim();
  if (!bn) return bn;
  const ordered = [...new Set(candidates.map((c) => (c ?? "").trim()).filter(Boolean))];
  for (const s of ordered) {
    const bnLow = bn.toLowerCase();
    const sLow = s.toLowerCase();
    if (bnLow.startsWith(sLow + " ")) return bn.slice(s.length).trim();
  }
  return bn;
}

function explorationRecordIsTerraformable(rec: ExplorationScanRecord): boolean {
  return isTerraformableState(rec.terraformState);
}

function abbreviateNotablePlanetClass(pc: string): string {
  const n = pc.trim();
  const low = n.toLowerCase();
  if (!n) return "";
  if (low.includes("high metal content")) return "HMC";
  if (low.includes("metal rich")) return "Metal-rich";
  if (low === "rocky body" || (low.startsWith("rocky") && low.includes("body"))) return "Rocky";
  if (low === "icy body" || (low.startsWith("icy") && low.includes("body"))) return "Icy";
  if (low.includes("gas giant")) return "Gas giant";
  if (n.length <= 18) return n;
  return n.split(/\s+/).slice(0, 3).join(" ");
}

function notableTagForRecord(rec: ExplorationScanRecord): string | null {
  const pc = (rec.planetClass ?? "").trim();
  const norm = pc.toLowerCase().replace(/\s+/g, " ");
  const tf = explorationRecordIsTerraformable(rec);
  const tfSuffix = tf ? " - Terraformable" : "";

  if (pc === "Earthlike body" || (norm.includes("earth") && norm.includes("like"))) {
    return `Earth-like${tfSuffix}`;
  }
  if (pc === "Ammonia world" || norm.includes("ammonia world")) {
    return `Ammonia world${tfSuffix}`;
  }
  if (pc === "Water world" || (norm.includes("water") && norm.includes("world"))) {
    return `Water world${tfSuffix}`;
  }
  // Rare (owner, 2026-09-30: a couple of dozen in EDSM) — and not the common "Helium rich gas giant".
  if (norm === "helium gas giant") return `Helium gas giant${tfSuffix}`;

  if (!tf) return null;

  const abbr = abbreviateNotablePlanetClass(pc);
  return abbr ? `${abbr} - Terraformable` : "Terraformable";
}

export function buildNotableBodiesForFocusedSystem(
  store: GameStateStore,
  focusedSystemName: string | null,
): NotableBodyInfo[] {
  const focusAddr = store.viewingSystemAddress ?? store.currentSystemAddress;
  if (focusAddr == null) return [];
  return notableBodiesForSystem(store, focusAddr, focusedSystemName);
}

/**
 * What the commander scanned in one system (owner, 2026-09-30, for the boxel list: "15/15 scanned"):
 * his own scans, live or sold, of stars and worlds (no belts, rings or barycentres), against the
 * system's body count when the FSS told him one.
 */
export function systemBodyTally(store: GameStateStore, systemAddress: number): { scanned: number; total: number | null } {
  const ids = new Set<number>();
  for (const rec of [...store.liveScansInSystem(systemAddress), ...store.soldScansInSystem(systemAddress)]) {
    if (rec.edsmHydrated || rec.isSynthetic || !explorationRecordCountsTowardDScanFound(rec)) continue;
    ids.add(rec.bodyId);
  }
  const disc = store.fssDiscoveryScanBySystem.get(systemAddress);
  const known = Math.max(disc?.bodyCount ?? 0, store.fssAllBodiesFoundCountBySystem.get(systemAddress) ?? 0);
  const total = known > 0 ? Math.max(known, ids.size) : null;
  return { scanned: ids.size, total };
}

/** The Notable card's list for any system (the focused one, or each system of a boxel). */
export function notableBodiesForSystem(
  store: GameStateStore,
  focusAddr: number,
  focusedSystemName: string | null,
): NotableBodyInfo[] {
  const opts = notableOptions();
  const greenSrc: GreenGiantSources | null = opts.green
    ? { ...opts.green, greenCodexBodies: store.greenCodexBodies, k10Systems: store.k10Systems }
    : null;

  const all = new Map<number, ExplorationScanRecord>();
  const byBodyId = new Map<number, ExplorationScanRecord>();
  /*
    Sold bodies too, marked (owner, 2026-09-30: "include sold but mark them"): a system he already
    cashed in still has its green gas giant and its shepherd moon. A live scan of the same body wins.
  */
  const archivedIds = new Set<number>();
  const live = store.liveScansInSystem(focusAddr);
  const liveIds = new Set(live.map((r) => r.bodyId));
  const sold = store.soldScansInSystem(focusAddr).filter((r) => !liveIds.has(r.bodyId));
  for (const r of sold) archivedIds.add(r.bodyId);
  for (const rec of [...live, ...sold]) {
    all.set(rec.bodyId, rec);
    // Stars only count through a feature (ancient, ringed); planets through anything.
    const star = explorationRecordIsStellar(rec) && !rec.isSynthetic && !!rec.starType;
    if (!isPlanetLikeExplorationRecord(rec) && !(star && opts.features.size)) continue;
    byBodyId.set(rec.bodyId, rec);
  }

  const out: NotableBodyInfo[] = [];
  for (const rec of byBodyId.values()) {
    const green = greenSrc ? greenGiantForRecord(rec, greenSrc) : null;
    let features: NotableBodyInfo["features"];
    if (opts.features.size) {
      const dp = directParent(rec.parents);
      const parent = dp && dp.kind !== "Null" ? (all.get(dp.id) ?? null) : null;
      const hits = bodyFeatures(rec, parent).filter((f) => opts.features.has(f.key));
      if (hits.length) features = hits;
    }
    const tag =
      notableTagForRecord(rec) ?? (green ? greenGiantLabel(green) : null) ?? (features ? features.map((f) => f.label).join(" · ") : null);
    if (!tag) continue;
    const bk = scanBodyKey(rec.systemAddress, rec.bodyId);
    const archived = archivedIds.has(rec.bodyId);
    const fullName = rec.bodyName?.trim() || `Body ${rec.bodyId}`;
    const bodyLabelShort = shortNotableBodyLabel(fullName, [
      rec.starSystem,
      focusedSystemName,
      store.currentSystem,
    ]);
    out.push({
      bodyName: fullName,
      bodyLabelShort,
      systemAddress: rec.systemAddress,
      bodyId: rec.bodyId,
      tag,
      // The archive row of a sold body keeps its mapping; data lost on death is listed, not "sold".
      dssMapped: store.dssMappedBodyKeys.has(bk) || (archived && store.archivedDssMappedBodyKeys.has(bk)),
      ...(green ? { green } : {}),
      ...(features ? { features } : {}),
      ...(archived && store.soldBodyKeys.has(bk) ? { sold: true } : {}),
    });
  }
  out.sort((a, b) => a.bodyId - b.bodyId);
  return out;
}
