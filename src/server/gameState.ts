import type {
  BodyExoState,
  ExplorationScanRecord,
  JournalLine,
  PlanetScan,
  GenusHint,
  OrganicGenusLock,
  SpeciesEntry,
  DssPhysicalSlackRatios,
} from "../shared/types.js";
import type { JournalHistoryPreset } from "../shared/journalHistoryPreset.js";
import {
  displayLabelFromOrganicLine,
  nextOrganicProgressCount,
  speciesKeyFromOrganicJournal,
  speciesKeyFromSellBio,
  speciesEntryMatchesOrganicLabel,
  normOrganicToken,
} from "./organicTracking.js";
import { barycentreSyntheticBodyId, directParentPlanetId } from "./orbitUtils.js";
import { getProjectRoot } from "./paths.js";
import {
  journalLineCarriesPlanetMetrics,
  planetScanFromExplorationRecord,
  recordFootScanned,
} from "./footScannedCatalog.js";
import { explorationRecordIsBeltClusterLike, explorationRecordIsStellar } from "./explorationStellar.js";
import { greatCircleDistanceMeters, type FootTravelFix } from "./footTravelStatus.js";
import type { ExoOrganicTrackerInternal } from "./exoOrganicTracker.js";
import {
  wipeOrganicSampleSession,
  clearPersistedOrganicSampleSession,
  normStatusBodyName,
} from "./organicSampleSessionFile.js";
import type { NavRouteWaypointDTO } from "./navRouteFuel.js";
function bodyKey(systemAddress: number, bodyId: number): string {
  return `${systemAddress}:${bodyId}`;
}

/** Recent journal lines (chronological) for foot-catalog naming: find body label on lines *before* each `ScanOrganic` Analyse. */
const FOOT_JOURNAL_BUFFER_MAX = 600;

function journalLineNumericBodyId(line: JournalLine): number | undefined {
  if (typeof line.BodyID === "number" && Number.isFinite(line.BodyID)) return line.BodyID;
  if (typeof line.Body === "number" && Number.isFinite(line.Body)) return line.Body;
  return undefined;
}

function journalLineMatchesBodyIds(line: JournalLine, systemAddress: number, bodyId: number): boolean {
  if (typeof line.SystemAddress !== "number" || line.SystemAddress !== systemAddress) return false;
  return journalLineNumericBodyId(line) === bodyId;
}

function journalLineBodyDisplayName(line: JournalLine): string | null {
  const b = line.Body;
  if (typeof b === "string" && b.trim()) return b.trim();
  const bn = line.BodyName;
  if (typeof bn === "string" && bn.trim()) return bn.trim();
  return null;
}
export type PendingOrganicSample = {
  fullKey: string;
  bodyKey: string;
  speciesKey: string;
  label: string;
};

export type OrganicAnalyseProgress = { count: number; label: string };

/** Increment when journal-derived snapshot shape changes — invalidates on-disk merge cache. */
export const JOURNAL_MERGE_CACHE_FORMAT = 2;

/** Serializable journal-derived slice of {@link GameStateStore} (not user prefs). */
export type JournalMergeCachePayload = {
  format: number;
  commanderName: string | null;
  currentSystem: string | null;
  currentSystemAddress: number | null;
  viewingSystemAddress: number | null;
  visitedSystems: [number, string][];
  bodies: [string, BodyExoState][];
  explorationScans: [string, ExplorationScanRecord][];
  fssBodySignalsBodyKeys: string[];
  dssMappedBodyKeys: string[];
  dssFirstMapperEligibleByBodyKey: [string, boolean][];
  dssMappingEfficientByBodyKey: [string, boolean][];
  orbitParentPlanetByBody: [string, number][];
  lastEventIso: string | null;
  footJournalContextBuffer: JournalLine[];
  organicAnalyseByKey: [string, OrganicAnalyseProgress][];
  bodyDetailedFootfallState: [string, boolean][];
  firstFootfallBodies: string[];
  pendingOrganicSales: PendingOrganicSample[];
  fssAllBodiesCompleteSystems: number[];
  fssDiscoveryScanBySystem: [number, { systemName: string; bodyCount: number; progress: number }][];
  /** Optional — `FSSAllBodiesFound.Count` per system. */
  fssAllBodiesFoundCountBySystem?: [number, number][];
  /** Present when {@link format} >= 2. */
  fsdJumpWasDiscoveredBySystem?: [number, boolean][];
  remainingJumpsInRoute?: number | null;
  loadoutMaxJumpRangeLy?: number | null;
  loadoutFuelMainCapacityT?: number | null;
  loadoutFuelReserveCapacityT?: number | null;
  lastFsdJumpFuelUsedT?: number | null;
  lastFsdJumpDistLy?: number | null;
};

function ensureBody(
  map: Map<string, BodyExoState>,
  systemAddress: number,
  bodyId: number,
  bodyName: string,
  starSystem: string,
  ts: string,
): BodyExoState {
  const key = bodyKey(systemAddress, bodyId);
  let b = map.get(key);
  if (!b) {
    b = {
      key,
      bodyName,
      bodyId,
      systemAddress,
      starSystem,
      biologicalSignals: null,
      genusHints: null,
      dssComplete: false,
      scan: null,
      signalHints: null,
      organicGenusLocks: [],
      confirmedVariants: [],
      updatedAt: ts,
    };
    map.set(key, b);
  } else {
    if (bodyName) b.bodyName = bodyName;
    b.starSystem = starSystem;
    b.updatedAt = ts;
  }
  return b;
}

function asSignals(raw: unknown): { Type?: string; Type_Localised?: string; Count?: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw as { Type?: string; Type_Localised?: string; Count?: number }[];
}

function biologicalCount(signals: ReturnType<typeof asSignals>): number | null {
  for (const s of signals) {
    const loc = (s.Type_Localised ?? "").trim();
    const ty = (s.Type ?? "").trim();
    const locLo = loc.toLowerCase();
    const tyLo = ty.toLowerCase();
    if (locLo === "biological" || tyLo.includes("biological") || tyLo.includes("signaltype_biological")) {
      return typeof s.Count === "number" ? s.Count : null;
    }
  }
  return null;
}

function mergeScannerSignalHints(
  existing: string[] | null | undefined,
  lineSignals: unknown,
): string[] | null {
  const raw = asSignals(lineSignals);
  const set = new Set<string>();
  for (const x of existing ?? []) {
    const t = x.trim();
    if (t) set.add(t);
  }
  for (const s of raw) {
    const ty = (s.Type ?? "").trim();
    const loc = (s.Type_Localised ?? "").trim();
    if (ty) set.add(ty);
    if (loc) set.add(loc);
  }
  return set.size ? [...set] : (existing ?? null);
}

function asGenuses(raw: unknown): GenusHint[] | null {
  if (!Array.isArray(raw)) return null;
  const out: GenusHint[] = [];
  for (const g of raw) {
    const o = g as Record<string, unknown>;
    const glRaw = firstString(o, ["Genus_Localised", "genus_localised", "GenusLocalised"]);
    const giRaw = firstString(o, ["Genus", "genus"]);
    if (!glRaw && !giRaw) continue;
    out.push({ Genus_Localised: glRaw || giRaw, Genus: giRaw || glRaw });
  }
  return out.length ? out : null;
}

function firstString(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function mergeGenusHints(existing: GenusHint[] | null, incoming: GenusHint[] | null): GenusHint[] | null {
  if (!incoming?.length) return existing?.length ? existing : null;
  if (!existing?.length) return incoming;
  const seen = new Set<string>();
  const out: GenusHint[] = [];
  for (const h of [...existing, ...incoming]) {
    const k = `${h.Genus}\0${h.Genus_Localised}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  return out.length ? out : null;
}

function strEqLoose(a: string | undefined, b: string | undefined): boolean {
  return (a ?? "").trim() === (b ?? "").trim();
}

function normVolc(s: string | undefined): string {
  const v = (s ?? "").trim().toLowerCase();
  if (!v || v.includes("no volcanism")) return "";
  return v;
}

/**
 * Moons of the same planet often share exobiology; used to mirror FSS / DSS / scans / on-foot data to siblings.
 * Terraform, atmosphere type, and journal temp/pressure are allowed to differ moderately or be one-sided missing.
 */
function explorationRecordsSimilarForSharedExo(a: ExplorationScanRecord, b: ExplorationScanRecord): boolean {
  if (!strEqLoose(a.planetClass, b.planetClass)) return false;

  const tA = (a.terraformState ?? "").trim();
  const tB = (b.terraformState ?? "").trim();
  if (tA && tB && tA !== tB) return false;

  const atA = (a.atmosphereType ?? "").trim();
  const atB = (b.atmosphereType ?? "").trim();
  if (atA && atB && atA !== atB) return false;

  const atmA = (a.atmosphere ?? "").trim();
  const atmB = (b.atmosphere ?? "").trim();
  if (atmA && atmB && atmA !== atmB) return false;

  if (a.landable !== undefined && b.landable !== undefined && a.landable !== b.landable) return false;

  if (normVolc(a.volcanism) !== normVolc(b.volcanism)) return false;

  if (a.surfaceGravity != null && b.surfaceGravity != null) {
    const d = Math.abs(a.surfaceGravity - b.surfaceGravity);
    if (d > Math.max(0.35, Math.abs(a.surfaceGravity) * 0.06)) return false;
  }
  if (a.surfaceTemperature != null && b.surfaceTemperature != null) {
    const d = Math.abs(a.surfaceTemperature - b.surfaceTemperature);
    if (d > 120) return false;
  }
  if (a.surfacePressure != null && b.surfacePressure != null) {
    const ma = Math.max(Math.abs(a.surfacePressure), Math.abs(b.surfacePressure), 0.01);
    const d = Math.abs(a.surfacePressure - b.surfacePressure);
    if (d > Math.max(0.35, ma * 0.25)) return false;
  }

  return true;
}

function organicLockGenusKey(lock: OrganicGenusLock): string {
  const s = (lock.genusSymbol ?? "").trim().toLowerCase();
  const l = (lock.genusLocalised ?? "").trim().toLowerCase();
  return `${s}\0${l}`;
}

/** All moons of the same planet as `sourceBodyId` (excludes self), using merged `Scan` parents and/or orbit map. */
function siblingMoonBodyIdsUnified(
  store: GameStateStore,
  systemAddress: number,
  sourceBodyId: number,
): number[] {
  const sk = bodyKey(systemAddress, sourceBodyId);
  const sourceRec = store.explorationScans.get(sk);
  const parentFromRec = sourceRec ? directParentPlanetId(sourceRec.parents) : null;
  const parentFromOrbit = store.orbitParentPlanetByBody.get(sk);
  const parent = parentFromRec ?? parentFromOrbit ?? null;
  if (parent == null) return [];

  const out = new Set<number>();
  const prefix = `${systemAddress}:`;
  for (const [, rec] of store.explorationScans) {
    if (rec.systemAddress !== systemAddress) continue;
    if (directParentPlanetId(rec.parents) === parent) out.add(rec.bodyId);
  }
  for (const [bk, p] of store.orbitParentPlanetByBody) {
    if (!bk.startsWith(prefix) || p !== parent) continue;
    const bid = Number(bk.slice(prefix.length));
    if (Number.isFinite(bid)) out.add(bid);
  }
  out.delete(sourceBodyId);
  return [...out];
}

function buildSiblingPlanetScan(
  store: GameStateStore,
  source: PlanetScan,
  systemAddress: number,
  siblingBodyId: number,
  siblingRec: ExplorationScanRecord | null,
): PlanetScan {
  const bk = bodyKey(systemAddress, siblingBodyId);
  const wfKnown = store.bodyDetailedFootfallState.has(bk);
  const wf = wfKnown ? store.bodyDetailedFootfallState.get(bk) : undefined;
  const name =
    siblingRec?.bodyName?.trim() || store.bodies.get(bk)?.bodyName?.trim() || `Body ${siblingBodyId}`;
  const star = siblingRec?.starSystem?.trim() || source.StarSystem;
  return {
    BodyName: name,
    BodyID: siblingBodyId,
    StarSystem: star,
    SystemAddress: systemAddress,
    PlanetClass: siblingRec?.planetClass ?? source.PlanetClass,
    Atmosphere: siblingRec?.atmosphere ?? source.Atmosphere,
    AtmosphereType: siblingRec?.atmosphereType ?? source.AtmosphereType,
    SurfaceGravity: siblingRec?.surfaceGravity ?? source.SurfaceGravity,
    SurfaceTemperature: siblingRec?.surfaceTemperature ?? source.SurfaceTemperature,
    SurfacePressure: siblingRec?.surfacePressure ?? source.SurfacePressure,
    SemiMajorAxis: siblingRec?.semiMajorAxis ?? source.SemiMajorAxis,
    TidalLock: siblingRec?.tidalLock ?? source.TidalLock,
    Volcanism: siblingRec?.volcanism ?? source.Volcanism,
    Landable: siblingRec?.landable ?? source.Landable,
    TerraformState: siblingRec?.terraformState ?? source.TerraformState,
    WasFootfalled: wf !== undefined ? wf : undefined,
    materials: Array.isArray(siblingRec?.materials)
      ? (siblingRec!.materials as PlanetScan["materials"])
      : source.materials,
    atmosphereComposition: Array.isArray(siblingRec?.atmosphereComposition)
      ? (siblingRec!.atmosphereComposition as PlanetScan["atmosphereComposition"])
      : source.atmosphereComposition,
    composition: (siblingRec?.composition as PlanetScan["composition"]) ?? source.composition,
    radius: siblingRec?.radius ?? source.radius,
  };
}

export class GameStateStore {
  /** From journal `LoadGame.Commander` (latest session in merged logs). */
  commanderName: string | null = null;
  currentSystem: string | null = null;
  currentSystemAddress: number | null = null;
  /**
   * When set, the UI lists bodies for this system instead of `currentSystemAddress`.
   * Cleared on FSD/carrier jump so the app tracks the commander again.
   */
  viewingSystemAddress: number | null = null;
  /** Systems seen in the merged journal (jumps, Location, FSS complete) for picker / search. */
  readonly visitedSystems = new Map<number, string>();
  readonly bodies = new Map<string, BodyExoState>();
  /**
   * Merged `Scan` rows for bodies in-system (basic + detailed) for system map / exploration estimates.
   * Key: `${systemAddress}:${bodyId}` (not cleared on jump — keyed by address).
   */
  readonly explorationScans = new Map<string, ExplorationScanRecord>();

  /**
   * Bumped on every write to {@link explorationScans}. Consumers cache per-system indexes and
   * per-body computations keyed on this — records are replaced rather than mutated, so map size
   * alone is not a safe signature.
   */
  explorationScansRevision = 0;
  /**
   * EDSM fallback rows for system map only (no journal `Scan` in merged logs for that system).
   * Cleared per body when a real journal {@link mergeExplorationScan} arrives.
   */
  readonly edsmExplorationByKey = new Map<string, ExplorationScanRecord>();
  /** Bodies with at least one journal `FSSBodySignals` line (FSS “scan” of that body); keyed globally, not current system only. */
  readonly fssBodySignalsBodyKeys = new Set<string>();
  /** Bodies that completed DSS probe mapping (`SAAScanComplete` in journal); keyed globally. */
  readonly dssMappedBodyKeys = new Set<string>();
  /**
   * First-mapper bonus eligibility frozen at `SAAScanComplete` from merged `Scan.WasMapped` at that time.
   * Later `Scan` lines often set `WasMapped: true` after your map; without this, DSS estimates wrongly drop the bonus.
   */
  readonly dssFirstMapperEligibleByBodyKey = new Map<string, boolean>();
  /** `SAAScanComplete`: `ProbesUsed` <= `EfficiencyTarget` — optional tail multiplier on mapped estimate. */
  readonly dssMappingEfficientByBodyKey = new Map<string, boolean>();
  /**
   * Moons of a gas giant: maps `systemAddress:bodyId` → parent **planet** bodyId from journal `Parents`.
   * Lets FSS/DSS propagate before every moon has a full merged `Scan` row.
   */
  readonly orbitParentPlanetByBody = new Map<string, number>();
  lastEventIso: string | null = null;

  /**
   * Sliding window of merged journal JSON lines in **time order** (oldest → newest).
   * Used only to resolve `Body` / `BodyName` from the nearest prior journal entry for a given
   * `systemAddress` + body id — **not** tied to the commander's “current” system.
   */
  readonly footJournalContextBuffer: JournalLine[] = [];

  /**
   * Exobiology analyse progress per body + codex identity (from ScanOrganic).
   * Key: `${systemAddress}:${bodyId}::${speciesKey}`
   */
  readonly organicAnalyseByKey = new Map<string, OrganicAnalyseProgress>();
  /**
   * Latest `WasFootfalled` from journal detailed scans per body (systemAddress:bodyId).
   * false = no footfall yet at time of that scan; used with Disembark to detect first footfall.
   */
  readonly bodyDetailedFootfallState = new Map<string, boolean>();
  /** Bodies where this commander gets first-footfall organic payout (1× + 4× bonus = 5× list in valuation). */
  readonly firstFootfallBodies = new Set<string>();
  /** Completed samples (3× Analyse) not removed by SellOrganicData / Died — FIFO for sales without body on BioData. */
  pendingOrganicSales: PendingOrganicSample[] = [];

  /** SystemAddress values where journal reported `FSSAllBodiesFound` (FSS discovery pass finished). */
  readonly fssAllBodiesCompleteSystems = new Set<number>();
  /**
   * Authoritative body tally from journal `FSSAllBodiesFound.Count` when present (stars/planets/moons count).
   */
  readonly fssAllBodiesFoundCountBySystem = new Map<number, number>();
  /**
   * Latest merged journal `FSSDiscoveryScan` (honk) per system.
   * `bodyCount` is bodies only (stars/planets/moons); `progress` is 0–1 FSS discovery progress.
   */
  readonly fssDiscoveryScanBySystem = new Map<
    number,
    { systemName: string; bodyCount: number; progress: number }
  >();

  /**
   * `FSDJump` / `CarrierJump` merged `WasDiscovered` for arrived `SystemAddress`.
   */
  readonly fsdJumpWasDiscoveredBySystem = new Map<number, boolean>();
  remainingJumpsInRoute: number | null = null;

  /** Journal `Loadout` / `LoadGame` — FSD range with minimal fuel (Ly). */
  loadoutMaxJumpRangeLy: number | null = null;
  /** From journal `Loadout.FuelCapacity` (tonnes). */
  loadoutFuelMainCapacityT: number | null = null;
  loadoutFuelReserveCapacityT: number | null = null;
  /** Latest `FSDJump` sample for fuel-per-ly calibration. */
  lastFsdJumpFuelUsedT: number | null = null;
  lastFsdJumpDistLy: number | null = null;

  /** From live `Status.json` poll (tonnes); null when file missing or parse failed. */
  liveStatusFuelMainT: number | null = null;
  liveStatusFuelReserveT: number | null = null;
  private lastLiveShipFuelPushKey: string | null = null;

  /** Parsed `NavRoute.json` from the journal folder (live file; not journal-cached). */
  liveNavRoute: NavRouteWaypointDTO[] | null = null;
  private lastLiveNavRoutePushKey: string | null = null;

  /** User pref: show HUD + poll Status.json (launcher / settings). */
  footTravelOdometerEnabled = false;
  /** True while odometer accumulates distance for the persisted organic sample session body. */
  footTravelOdometerTracking = false;
  /** Metres accumulated while tracking (great-circle); cleared when a new tracking session starts or pref off. */
  footTravelDistanceMeters = 0;
  footTravelPrevLat: number | null = null;
  footTravelPrevLon: number | null = null;
  footTravelLastPlanetRadiusM: number | null = null;

  /**
   * Foot odometer is only counted when `Status.json` body name matches this normalized name (same session body).
   */
  footSessionBodyKey: string | null = null;
  footSessionBodyNameNorm: string | null = null;

  /** Electron overlay: live organic sample distance (see `exoOrganicTracker.ts`). */
  exoOrganicTracker: ExoOrganicTrackerInternal | null = null;
  /** Latest Status.json fix; updated on poll when overlay may be active. */
  exoOrganicLastFix: FootTravelFix | null = null;

  /** When true, bacterium genus/species rules are included in body search (default off, can leak spoilers). */
  includeBacteriumInSearch = false;

  /**
   * How much journal history to merge: all logs in the folder, or a rolling window from “now”.
   * Separately persisted in user settings JSON (not part of the journal merge payload).
   */
  journalHistoryPreset: JournalHistoryPreset = "all";

  /**
   * System map `+` / `++` thresholds (CR per species: list × 5 if this commander has first-footfall on the body, else × 1).
   * Clamped to 1M…20M; `++` is always strictly greater than `+`.
   */
  exoMapTierPlusMinCr = 10_000_000;
  exoMapTierPlusPlusMinCr = 17_000_000;

  /** When true, header “Data value” includes estimated FSS/DSS UC value from merged scans (see Options). */
  includeExplorationScanDataInDataValue = false;

  /**
   * Options: extra slack on DSS / lone-genus physical fallbacks (0–50%). See {@link getDssPhysicalSlackRatios}.
   */
  dssSlackTemperaturePercent = 0;
  dssSlackPressurePercent = 0;
  dssSlackGravityPercent = 0;

  /** Consumed once in `buildSnapshot` so the client can select that bio body tab. */
  private pendingUiAutoSelectBodyKey: string | null = null;

  /** Web client POST — which planetary body tab is active (for Exo-Candidates overlay). */
  uiSelectedBodyKey: string | null = null;

  /** Last journal Touchdown on a planet (commander). */
  overlayTouchdownBodyKey: string | null = null;

  /**
   * Read the pending one-shot key without consuming it.
   *
   * Consuming belongs to the broadcast path only ({@link clearPendingUiAutoSelectBodyKey}); when
   * the consume lived inside buildSnapshot, any /api/state poll could swallow the key before the
   * WebSocket clients ever saw it.
   */
  peekPendingUiAutoSelectBodyKey(): string | null {
    return this.pendingUiAutoSelectBodyKey;
  }

  clearPendingUiAutoSelectBodyKey(): void {
    this.pendingUiAutoSelectBodyKey = null;
  }

  /** Queue a one-shot tab focus when the body is already in the focused system's bio list. */
  requestUiAutoSelectBody(systemAddress: number, bodyId: number): void {
    const focus = this.viewingSystemAddress ?? this.currentSystemAddress;
    if (focus === null || focus !== systemAddress) return;
    const bk = bodyKey(systemAddress, bodyId);
    if (!this.bodies.has(bk)) return;
    this.pendingUiAutoSelectBodyKey = bk;
  }

  /** Returns whether the value changed, so callers can skip a pointless snapshot broadcast. */
  setUiSelectedBodyKeyFromClient(key: string | null): boolean {
    if (key !== null) {
      const focus = this.viewingSystemAddress ?? this.currentSystemAddress;
      const parts = key.split(":");
      if (focus === null || parts.length < 2) return false;
      const addr = Number(parts[0]);
      if (!Number.isFinite(addr) || addr !== focus) return false;
      if (!this.bodies.has(key)) return false;
    }
    if (this.uiSelectedBodyKey === key) return false;
    this.uiSelectedBodyKey = key;
    return true;
  }

  setIncludeExplorationScanDataInDataValue(value: boolean): void {
    this.includeExplorationScanDataInDataValue = value;
  }

  setIncludeBacteriumInSearch(value: boolean): void {
    this.includeBacteriumInSearch = value;
  }

  setJournalHistoryPreset(value: JournalHistoryPreset): void {
    this.journalHistoryPreset = value;
  }

  /** True if merged journal has at least one `Scan` row (any body) for this system. */
  hasJournalExplorationScansForSystem(systemAddress: number): boolean {
    const p = `${systemAddress}:`;
    for (const k of this.explorationScans.keys()) {
      if (k.startsWith(p)) return true;
    }
    return false;
  }

  /**
   * True when journal has at least one merged `Scan` that can populate the system map (belt-cluster rows alone do not).
   * Used to decide whether EDSM body hydration is still useful.
   */
  hasMappableJournalExplorationForSystem(systemAddress: number): boolean {
    const p = `${systemAddress}:`;
    for (const [k, r] of this.explorationScans) {
      if (!k.startsWith(p)) continue;
      if (!explorationRecordIsBeltClusterLike(r)) return true;
    }
    return false;
  }

  hasEdsmExplorationForSystem(systemAddress: number): boolean {
    const p = `${systemAddress}:`;
    for (const k of this.edsmExplorationByKey.keys()) {
      if (k.startsWith(p)) return true;
    }
    return false;
  }

  /**
   * Commander has journal memory of this system (visited list, any body, or any exploration scan).
   */
  isKnownJournalSystem(systemAddress: number): boolean {
    if (this.visitedSystems.has(systemAddress)) return true;
    const p = `${systemAddress}:`;
    for (const k of this.bodies.keys()) {
      if (k.startsWith(p)) return true;
    }
    for (const k of this.explorationScans.keys()) {
      if (k.startsWith(p)) return true;
    }
    return false;
  }

  /** Replace EDSM-only scan rows for one system (used when journal has no `Scan` data to draw the map). */
  replaceEdsmExplorationForSystem(systemAddress: number, records: ExplorationScanRecord[]): void {
    const prefix = `${systemAddress}:`;
    for (const k of [...this.edsmExplorationByKey.keys()]) {
      if (k.startsWith(prefix)) this.edsmExplorationByKey.delete(k);
    }
    for (const r of records) {
      if (r.systemAddress !== systemAddress) continue;
      this.edsmExplorationByKey.set(bodyKey(systemAddress, r.bodyId), r);
    }
  }

  getDssPhysicalSlackRatios(): DssPhysicalSlackRatios {
    const clampPct = (n: number) => Math.max(0, Math.min(50, Math.round(Number(n))));
    return {
      temperature: clampPct(this.dssSlackTemperaturePercent) / 100,
      pressure: clampPct(this.dssSlackPressurePercent) / 100,
      gravity: clampPct(this.dssSlackGravityPercent) / 100,
    };
  }

  setDssPhysicalSlackPercents(
    temperaturePercent: number,
    pressurePercent: number,
    gravityPercent: number,
  ): void {
    const clamp = (n: number) => Math.max(0, Math.min(50, Math.round(Number(n))));
    this.dssSlackTemperaturePercent = clamp(temperaturePercent);
    this.dssSlackPressurePercent = clamp(pressurePercent);
    this.dssSlackGravityPercent = clamp(gravityPercent);
  }

  setFootTravelOdometerEnabled(value: boolean): void {
    this.footTravelOdometerEnabled = value;
    if (!value) this.resetFootTravelRuntime({ clearPersistedFile: true });
  }

  /**
   * Start or restart foot odometer for `data/organic_sample_session.json` (typically after a new Sample sequence).
   */
  beginFootTravelOdometerSession(bodyKey: string, bodyNameNorm: string | null): void {
    if (!this.footTravelOdometerEnabled) return;
    this.footTravelOdometerTracking = true;
    this.footTravelDistanceMeters = 0;
    this.footTravelPrevLat = null;
    this.footTravelPrevLon = null;
    this.footTravelLastPlanetRadiusM = null;
    this.footSessionBodyKey = bodyKey;
    this.footSessionBodyNameNorm =
      bodyNameNorm && bodyNameNorm.trim() ? normOrganicToken(bodyNameNorm) : null;
  }

  /** Legacy no-op path — session persists across Embark; prefer explicit {@link wipeOrganicSampleSession}. */
  endFootTravelOdometerSession(): void {
    /* intentional: foot + organic HUD session survives boarding ship */
  }

  /**
   * Integrate lat/lon from Status.json while tracking.
   * Skips bogus jumps (>800 m per tick @ ~150 ms poll ⇒ speed glitch).
   */
  applyFootTravelSample(
    latDeg: number,
    lonDeg: number,
    planetRadiusM: number,
    statusBodyName?: string | null,
  ): void {
    if (!this.footTravelOdometerEnabled || !this.footTravelOdometerTracking) return;
    if (!(planetRadiusM > 0 && Number.isFinite(planetRadiusM))) return;
    if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return;
    if (this.footSessionBodyNameNorm) {
      const st = normStatusBodyName(statusBodyName ?? null);
      if (!st || st !== this.footSessionBodyNameNorm) return;
    }

    const rLast = this.footTravelLastPlanetRadiusM;
    if (
      rLast != null &&
      rLast > 0 &&
      Math.abs(planetRadiusM - rLast) / Math.max(rLast, planetRadiusM) > 0.02
    ) {
      this.footTravelPrevLat = null;
      this.footTravelPrevLon = null;
    }
    this.footTravelLastPlanetRadiusM = planetRadiusM;

    const plat = this.footTravelPrevLat;
    const plon = this.footTravelPrevLon;
    if (plat != null && plon != null) {
      const d = greatCircleDistanceMeters(plat, plon, latDeg, lonDeg, planetRadiusM);
      if (d > 0 && d <= 800) {
        this.footTravelDistanceMeters += d;
      }
    }
    this.footTravelPrevLat = latDeg;
    this.footTravelPrevLon = lonDeg;
  }

  resetFootTravelRuntime(opts?: { clearPersistedFile?: boolean }): void {
    this.footTravelOdometerTracking = false;
    this.footTravelDistanceMeters = 0;
    this.footTravelPrevLat = null;
    this.footTravelPrevLon = null;
    this.footTravelLastPlanetRadiusM = null;
    this.footSessionBodyKey = null;
    this.footSessionBodyNameNorm = null;
    if (opts?.clearPersistedFile) {
      clearPersistedOrganicSampleSession(getProjectRoot());
    }
  }

  setExoMapTierThresholds(plusMinCr: number, plusPlusMinCr: number): void {
    const lo = 1_000_000;
    const hi = 20_000_000;
    let p = Math.round(plusMinCr);
    let pp = Math.round(plusPlusMinCr);
    if (!Number.isFinite(p) || !Number.isFinite(pp)) return;
    p = Math.max(lo, Math.min(hi, p));
    pp = Math.max(lo, Math.min(hi, pp));
    if (pp <= p) {
      pp = p + 1;
      if (pp > hi) {
        p = hi - 1;
        pp = hi;
      }
    }
    this.exoMapTierPlusMinCr = p;
    this.exoMapTierPlusPlusMinCr = pp;
  }

  /** Clear journal-derived exobiology: scan progress, pending sell value, first-footfall flags. Does not re-read the journal. */
  resetExobiologyTracking(): void {
    this.organicAnalyseByKey.clear();
    this.pendingOrganicSales = [];
    this.firstFootfallBodies.clear();
    this.bodyDetailedFootfallState.clear();
    this.exoOrganicTracker = null;
    this.exoOrganicLastFix = null;
    clearPersistedOrganicSampleSession(getProjectRoot());
    this.resetFootTravelRuntime();
  }

  /**
   * Journal file rolled or full re-parse — clears commander session context.
   * `includeBacteriumInSearch`, `includeExplorationScanDataInDataValue`, exo map tier thresholds, and
   * DSS physical slack percents are user prefs and are intentionally preserved.
   */
  resetAll(): void {
    this.bodies.clear();
    this.explorationScans.clear();
    this.explorationScansRevision += 1;
    this.edsmExplorationByKey.clear();
    this.commanderName = null;
    this.currentSystem = null;
    this.currentSystemAddress = null;
    this.viewingSystemAddress = null;
    this.visitedSystems.clear();
    this.lastEventIso = null;
    this.organicAnalyseByKey.clear();
    this.bodyDetailedFootfallState.clear();
    this.firstFootfallBodies.clear();
    this.pendingOrganicSales = [];
    this.fssAllBodiesCompleteSystems.clear();
    this.fssAllBodiesFoundCountBySystem.clear();
    this.fssDiscoveryScanBySystem.clear();
    this.orbitParentPlanetByBody.clear();
    this.dssMappedBodyKeys.clear();
    this.dssFirstMapperEligibleByBodyKey.clear();
    this.dssMappingEfficientByBodyKey.clear();
    this.fssBodySignalsBodyKeys.clear();
    this.footJournalContextBuffer.length = 0;
    this.pendingUiAutoSelectBodyKey = null;
    this.uiSelectedBodyKey = null;
    this.overlayTouchdownBodyKey = null;
    this.fsdJumpWasDiscoveredBySystem.clear();
    this.remainingJumpsInRoute = null;
    this.loadoutMaxJumpRangeLy = null;
    this.loadoutFuelMainCapacityT = null;
    this.loadoutFuelReserveCapacityT = null;
    this.lastFsdJumpFuelUsedT = null;
    this.lastFsdJumpDistLy = null;
    this.liveStatusFuelMainT = null;
    this.liveStatusFuelReserveT = null;
    this.lastLiveShipFuelPushKey = null;
    this.liveNavRoute = null;
    this.lastLiveNavRoutePushKey = null;
    this.resetFootTravelRuntime();
    this.exoOrganicTracker = null;
    this.exoOrganicLastFix = null;
  }

  /** Remember a system name from the journal (for the system browser). */
  rememberVisitedSystem(starSystem: string, systemAddress: number): void {
    const n = starSystem.trim();
    if (!n) return;
    this.visitedSystems.set(systemAddress, n);
  }

  setViewingSystemAddress(systemAddress: number | null): void {
    this.viewingSystemAddress = systemAddress;
  }

  /** Commander location after FSD/carrier jump — does not delete other systems’ bodies. */
  resetSystem(starSystem: string, systemAddress: number): void {
    this.rememberVisitedSystem(starSystem, systemAddress);
    this.currentSystem = starSystem;
    this.currentSystemAddress = systemAddress;
  }

  /** True when journal shows three organic analyses for this database row on this body. */
  isOrganicAnalysisCompleteForEntry(bodyStateKey: string, entry: SpeciesEntry): boolean {
    const prefix = `${bodyStateKey}::`;
    for (const [k, v] of this.organicAnalyseByKey) {
      if (!k.startsWith(prefix)) continue;
      if (v.count < 3) continue;
      if (speciesEntryMatchesOrganicLabel(entry, v.label)) return true;
    }
    return false;
  }

  bodyHasFirstFootfall(bodyStateKey: string): boolean {
    return this.firstFootfallBodies.has(bodyStateKey);
  }

  setLocation(starSystem: string, systemAddress: number): void {
    this.rememberVisitedSystem(starSystem, systemAddress);
    this.currentSystem = starSystem;
    this.currentSystemAddress = systemAddress;
  }

  /**
   * Journal `ScanBaryCentre`: mutual orbit for `{ Null: BodyID }` in `Scan.Parents`.
   * Stored at `bodyId = barycentreSyntheticBodyId(journalNullId)` so rows never collide with real body scans.
   */
  mergeBarycentreJournalLine(line: JournalLine, ts: string): void {
    const systemAddress = line.SystemAddress as number;
    const nullIdRaw = line.BodyID as number;
    if (typeof systemAddress !== "number" || typeof nullIdRaw !== "number" || !Number.isFinite(nullIdRaw))
      return;
    const syntheticId = barycentreSyntheticBodyId(nullIdRaw);
    const k = bodyKey(systemAddress, syntheticId);
    const prev = this.explorationScans.get(k);
    const pickStr = (v: unknown): string | undefined =>
      typeof v === "string" && v.trim() ? v.trim() : undefined;
    const pickNum = (v: unknown): number | undefined =>
      typeof v === "number" && Number.isFinite(v) ? v : undefined;

    const rec: ExplorationScanRecord = {
      ...(prev ?? {
        systemAddress,
        bodyId: syntheticId,
        bodyName: `Bary ⊥${nullIdRaw}`,
        starSystem: "",
        updatedAt: ts,
      }),
      systemAddress,
      bodyId: syntheticId,
      bodyName: prev?.bodyName?.trim() ? prev.bodyName : `Bary ⊥${nullIdRaw}`,
      starSystem: pickStr(line.StarSystem) ?? prev?.starSystem ?? (this.currentSystem ?? "").trim() ?? "",
      updatedAt: ts,
      isBarycentreJournal: true,
      journalBarycentreNullId: nullIdRaw,
    };

    const setNum = (key: keyof ExplorationScanRecord, v: unknown) => {
      const n = pickNum(v);
      if (n !== undefined) (rec as unknown as Record<string, unknown>)[key as string] = n;
    };

    setNum("semiMajorAxis", line.SemiMajorAxis);
    setNum("eccentricity", line.Eccentricity);
    setNum("orbitalInclination", line.OrbitalInclination);
    setNum("periapsis", line.Periapsis);
    setNum("orbitalPeriod", line.OrbitalPeriod);
    setNum("ascendingNode", line.AscendingNode);
    setNum("meanAnomaly", line.MeanAnomaly);

    this.explorationScans.set(k, rec);
    this.explorationScansRevision += 1;
    this.edsmExplorationByKey.delete(k);
  }

  mergeExplorationScan(line: JournalLine, ts: string): void {
    const systemAddress = line.SystemAddress as number;
    const bodyId = line.BodyID as number;
    const bodyName = line.BodyName as string;
    if (
      typeof systemAddress !== "number" ||
      typeof bodyId !== "number" ||
      typeof bodyName !== "string" ||
      !bodyName.trim()
    ) {
      return;
    }
    const k = bodyKey(systemAddress, bodyId);
    const prev = this.explorationScans.get(k);
    const pickStr = (v: unknown): string | undefined =>
      typeof v === "string" && v.trim() ? v.trim() : undefined;
    const pickNum = (v: unknown): number | undefined =>
      typeof v === "number" && Number.isFinite(v) ? v : undefined;
    const pickBool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

    const rec: ExplorationScanRecord = {
      ...(prev ?? {
        systemAddress,
        bodyId,
        bodyName: bodyName.trim(),
        starSystem: "",
        updatedAt: ts,
      }),
      systemAddress,
      bodyId,
      bodyName: bodyName.trim(),
      starSystem: pickStr(line.StarSystem) ?? prev?.starSystem ?? (this.currentSystem ?? "").trim() ?? "",
      updatedAt: ts,
    };

    const setStr = (key: keyof ExplorationScanRecord, v: unknown) => {
      const s = pickStr(v);
      if (s) (rec as unknown as Record<string, unknown>)[key as string] = s;
    };
    const setNum = (key: keyof ExplorationScanRecord, v: unknown) => {
      const n = pickNum(v);
      if (n !== undefined) (rec as unknown as Record<string, unknown>)[key as string] = n;
    };
    const setBool = (key: keyof ExplorationScanRecord, v: unknown) => {
      const b = pickBool(v);
      if (b !== undefined) (rec as unknown as Record<string, unknown>)[key as string] = b;
    };

    setStr("scanType", line.ScanType);
    setStr("bodyType", line.BodyType);
    setStr("planetClass", line.PlanetClass);
    setStr("starType", line.StarType);
    setNum("subclass", line.Subclass);
    setStr("luminosity", (line as Record<string, unknown>).Luminosity);
    setNum("stellarMass", line.StellarMass);
    setNum("massEM", line.MassEM);
    setStr("terraformState", line.TerraformState);
    setBool("landable", line.Landable);
    setNum("semiMajorAxis", line.SemiMajorAxis);
    setNum("distanceFromArrivalLs", (line as Record<string, unknown>).DistanceFromArrivalLS);
    setNum("surfaceTemperature", line.SurfaceTemperature);
    setNum("surfaceGravity", line.SurfaceGravity);
    setNum("surfacePressure", line.SurfacePressure);
    setNum("radius", line.Radius);
    setStr("atmosphereType", line.AtmosphereType);
    setStr("atmosphere", line.Atmosphere);
    setStr("volcanism", line.Volcanism);
    setBool("tidalLock", line.TidalLock);
    setBool("wasDiscovered", (line as Record<string, unknown>).WasDiscovered);
    setBool("wasMapped", (line as Record<string, unknown>).WasMapped);
    setNum("eccentricity", line.Eccentricity);
    setNum("orbitalInclination", line.OrbitalInclination);
    setNum("periapsis", line.Periapsis);
    setNum("orbitalPeriod", line.OrbitalPeriod);
    setNum("ascendingNode", line.AscendingNode);
    setNum("meanAnomaly", line.MeanAnomaly);
    setNum("rotationPeriod", (line as Record<string, unknown>).RotationPeriod);
    setNum("axialTilt", (line as Record<string, unknown>).AxialTilt);

    if (line.Parents !== undefined) rec.parents = line.Parents;

    if (line.AtmosphereComposition !== undefined) {
      const incoming = line.AtmosphereComposition;
      if (
        Array.isArray(incoming) &&
        incoming.length === 0 &&
        Array.isArray(prev?.atmosphereComposition) &&
        prev.atmosphereComposition.length > 0
      ) {
        /* Keep prev detailed composition — later basic scans sometimes send empty arrays. */
      } else {
        rec.atmosphereComposition = incoming;
      }
    }
    if (line.Materials !== undefined) {
      const incoming = line.Materials;
      if (
        Array.isArray(incoming) &&
        incoming.length === 0 &&
        Array.isArray(prev?.materials) &&
        prev.materials.length > 0
      ) {
        /* Keep prev detailed materials — basic / repeat scans often carry Materials: [] and would wipe Zinc etc. */
      } else {
        rec.materials = incoming;
      }
    }
    if (line.Composition !== undefined) {
      const incoming = line.Composition;
      const ik = incoming && typeof incoming === "object" ? Object.keys(incoming as object).length : 0;
      const pk =
        prev?.composition && typeof prev.composition === "object"
          ? Object.keys(prev.composition as object).length
          : 0;
      if (ik === 0 && pk > 0) {
        /* Same pattern as materials: do not replace rich composition with an empty object. */
      } else {
        rec.composition = line.Composition;
      }
    }

    this.explorationScans.set(k, rec);
    this.explorationScansRevision += 1;
    this.edsmExplorationByKey.delete(k);

    const moonOf = directParentPlanetId(rec.parents);
    if (moonOf != null) this.orbitParentPlanetByBody.set(k, moonOf);
    else this.orbitParentPlanetByBody.delete(k);

    const inCurrentSystem = this.currentSystemAddress !== null && systemAddress === this.currentSystemAddress;
    if (moonOf != null && inCurrentSystem) {
      ensureBody(
        this.bodies,
        systemAddress,
        bodyId,
        rec.bodyName,
        rec.starSystem?.trim() || this.currentSystem || "",
        ts,
      );
      this.syncExoStateFromSiblingMoons(systemAddress, bodyId, ts);
    }
  }

  /**
   * When a merged `Scan` row establishes a moon's parent planet, pull FSS/DSS/detailed scan data from a sibling
   * if this body was missing it (journal lines can arrive with FSS/DSS on moon B before B's first `Scan`).
   */
  private syncExoStateFromSiblingMoons(systemAddress: number, bodyId: number, ts: string): void {
    const sk = bodyKey(systemAddress, bodyId);
    const self = this.bodies.get(sk);
    if (!self) return;
    const selfRec = this.explorationScans.get(sk) ?? null;
    let changed = false;

    for (const bid of siblingMoonBodyIdsUnified(this, systemAddress, bodyId)) {
      const sib = this.bodies.get(bodyKey(systemAddress, bid));
      if (!sib) continue;
      const sibRec = this.explorationScans.get(bodyKey(systemAddress, bid)) ?? null;
      if (selfRec && sibRec && !explorationRecordsSimilarForSharedExo(selfRec, sibRec)) continue;

      if (sib.biologicalSignals != null) {
        const n = self.biologicalSignals ?? 0;
        if (sib.biologicalSignals > n) {
          self.biologicalSignals = sib.biologicalSignals;
          changed = true;
        }
      }
      if (sib.genusHints?.length) {
        const merged = mergeGenusHints(self.genusHints, sib.genusHints);
        if (merged && merged.length > (self.genusHints?.length ?? 0)) {
          self.genusHints = merged;
          changed = true;
        }
      }
      if (sib.dssComplete && !self.dssComplete) {
        self.dssComplete = true;
        changed = true;
      }
      if (sib.scan?.PlanetClass && !self.scan?.PlanetClass) {
        self.scan = buildSiblingPlanetScan(this, sib.scan, systemAddress, bodyId, selfRec);
        changed = true;
      }
    }
    if (changed) self.updatedAt = ts;
  }

  /** Append after each `apply` (in `finally`) so the buffer contains only lines **before** the next event. */
  private appendFootJournalContext(line: JournalLine): void {
    this.footJournalContextBuffer.push(line);
    const over = this.footJournalContextBuffer.length - FOOT_JOURNAL_BUFFER_MAX;
    if (over > 0) this.footJournalContextBuffer.splice(0, over);
  }

  /** Nearest prior journal line (same system + body id) that carries a `Body` or `BodyName` string. */
  private findRecentJournalBodyName(systemAddress: number, bodyId: number): string | null {
    for (let i = this.footJournalContextBuffer.length - 1; i >= 0; i--) {
      const jl = this.footJournalContextBuffer[i]!;
      if (!journalLineMatchesBodyIds(jl, systemAddress, bodyId)) continue;
      const nm = journalLineBodyDisplayName(jl);
      if (nm) return nm;
    }
    return null;
  }

  /** Nearest prior line in the same system with a non-empty `StarSystem` string. */
  private findRecentJournalStarSystem(systemAddress: number): string | null {
    for (let i = this.footJournalContextBuffer.length - 1; i >= 0; i--) {
      const jl = this.footJournalContextBuffer[i]!;
      if (typeof jl.SystemAddress !== "number" || jl.SystemAddress !== systemAddress) continue;
      const ss = jl.StarSystem;
      if (typeof ss === "string" && ss.trim()) return ss.trim();
    }
    return null;
  }

  apply(line: JournalLine): void {
    const event = line.event;
    const ts = (line.timestamp as string) ?? new Date().toISOString();
    this.lastEventIso = ts;

    try {
      if (event === "LoadGame") {
        const cmd = line.Commander as string | undefined;
        if (typeof cmd === "string" && cmd.trim()) this.commanderName = cmd.trim();
        const fc = (line as Record<string, unknown>).FuelCapacity;
        if (typeof fc === "number" && Number.isFinite(fc) && fc > 0) {
          this.loadoutFuelMainCapacityT = fc;
        }
        return;
      }

      if (event === "Loadout") {
        const mjr = (line as Record<string, unknown>).MaxJumpRange;
        if (typeof mjr === "number" && Number.isFinite(mjr) && mjr > 0) {
          this.loadoutMaxJumpRangeLy = mjr;
        }
        const fc = (line as Record<string, unknown>).FuelCapacity;
        if (fc && typeof fc === "object") {
          const o = fc as Record<string, unknown>;
          const main = o.Main;
          const res = o.Reserve;
          if (typeof main === "number" && Number.isFinite(main) && main > 0) {
            this.loadoutFuelMainCapacityT = main;
          }
          if (typeof res === "number" && Number.isFinite(res) && res >= 0) {
            this.loadoutFuelReserveCapacityT = res;
          }
        }
        return;
      }

      if (event === "FSDJump") {
        const fu = (line as Record<string, unknown>).FuelUsed;
        const jd = (line as Record<string, unknown>).JumpDist;
        if (
          typeof fu === "number" &&
          Number.isFinite(fu) &&
          fu > 0 &&
          typeof jd === "number" &&
          Number.isFinite(jd) &&
          jd > 0
        ) {
          this.lastFsdJumpFuelUsedT = fu;
          this.lastFsdJumpDistLy = jd;
        }
      }

      if (event === "FSDJump" || event === "CarrierJump") {
        const sys = line.StarSystem as string;
        const addr = line.SystemAddress as number;
        if (sys && typeof addr === "number") {
          const wd = (line as Record<string, unknown>).WasDiscovered;
          if (typeof wd === "boolean") {
            this.fsdJumpWasDiscoveredBySystem.set(addr, wd);
          }
          this.viewingSystemAddress = null;
          this.resetSystem(sys, addr);
        }
        return;
      }

      if (event === "FSDTarget") {
        const rj = (line as Record<string, unknown>).RemainingJumpsInRoute;
        if (typeof rj === "number" && Number.isFinite(rj)) {
          this.remainingJumpsInRoute = Math.max(0, Math.floor(rj));
        }
        return;
      }

      if (event === "Location") {
        const sys = line.StarSystem as string;
        const addr = line.SystemAddress as number;
        if (sys && typeof addr === "number") this.setLocation(sys, addr);
        return;
      }

      if (event === "FSSDiscoveryScan") {
        const addr = line.SystemAddress as number;
        const sysRaw = line.SystemName as string | undefined;
        const bodyCountRaw = line.BodyCount as number | undefined;
        const progressRaw = line.Progress as number | undefined;
        if (typeof addr !== "number" || typeof bodyCountRaw !== "number" || !Number.isFinite(bodyCountRaw))
          return;
        const bodyCount = Math.max(0, Math.floor(bodyCountRaw));
        if (bodyCount <= 0) return;
        let progress = typeof progressRaw === "number" && Number.isFinite(progressRaw) ? progressRaw : 0;
        progress = Math.max(0, Math.min(1, progress));
        const sysTrim = typeof sysRaw === "string" && sysRaw.trim() ? sysRaw.trim() : "";
        this.fssDiscoveryScanBySystem.set(addr, {
          systemName: sysTrim,
          bodyCount,
          progress,
        });
        if (sysTrim) this.rememberVisitedSystem(sysTrim, addr);
        return;
      }

      if (event === "FSSAllBodiesFound") {
        const addr = line.SystemAddress as number;
        const sysNm = line.SystemName as string | undefined;
        const sysStar = line.StarSystem as string | undefined;
        const sysRaw = (typeof sysNm === "string" && sysNm.trim() ? sysNm : sysStar) as string | undefined;
        const cntRaw = (line as Record<string, unknown>).Count;
        if (typeof addr === "number") {
          this.fssAllBodiesCompleteSystems.add(addr);
          if (typeof cntRaw === "number" && Number.isFinite(cntRaw)) {
            const n = Math.max(0, Math.floor(cntRaw));
            if (n > 0) this.fssAllBodiesFoundCountBySystem.set(addr, n);
          }
          if (sysRaw?.trim()) this.rememberVisitedSystem(sysRaw.trim(), addr);
        }
        return;
      }

      if (event === "FSSBodySignals") {
        const systemAddress = line.SystemAddress as number;
        const bodyId = line.BodyID as number;
        if (typeof systemAddress !== "number" || typeof bodyId !== "number") return;

        const bk = bodyKey(systemAddress, bodyId);
        this.fssBodySignalsBodyKeys.add(bk);

        const inCurrent = this.currentSystemAddress !== null && systemAddress === this.currentSystemAddress;
        if (!inCurrent) return;

        const bodyNameRaw = line.BodyName as string | undefined;
        const bodyName = bodyNameRaw?.trim() ? bodyNameRaw.trim() : `Body ${bodyId}`;
        const hints = asGenuses((line as Record<string, unknown>).Genuses);
        const sigArr = asSignals(line.Signals);
        const n = biologicalCount(sigArr);
        if (n === null && !hints && sigArr.length === 0) return;

        const b = ensureBody(this.bodies, systemAddress, bodyId, bodyName, this.currentSystem ?? "", ts);
        if (n !== null) b.biologicalSignals = n;
        if (hints) b.genusHints = mergeGenusHints(b.genusHints, hints);
        const mergedHints = mergeScannerSignalHints(b.signalHints ?? null, line.Signals);
        if (mergedHints) b.signalHints = mergedHints;
        this.propagateExoAmongSimilarMoons(bodyId, systemAddress, ts, "fss_signals");
        return;
      }

      if (event === "SAASignalsFound") {
        const systemAddress = line.SystemAddress as number;
        const bodyId = line.BodyID as number;
        const bodyName = line.BodyName as string;
        if (
          this.currentSystemAddress === null ||
          systemAddress !== this.currentSystemAddress ||
          typeof bodyId !== "number" ||
          !bodyName
        )
          return;

        const hints = asGenuses(line.Genuses);
        const sigArr = asSignals(line.Signals);
        const n = biologicalCount(sigArr);
        if (n === null && !hints && sigArr.length === 0) return;

        const b = ensureBody(this.bodies, systemAddress, bodyId, bodyName, this.currentSystem ?? "", ts);
        if (n !== null) b.biologicalSignals = n;
        if (hints) b.genusHints = hints;
        const mergedHints = mergeScannerSignalHints(b.signalHints ?? null, line.Signals);
        if (mergedHints) b.signalHints = mergedHints;
        this.propagateExoAmongSimilarMoons(bodyId, systemAddress, ts, "saas_signals");
        return;
      }

      if (event === "SAAScanComplete") {
        const systemAddress = line.SystemAddress as number;
        const bodyId = line.BodyID as number;
        if (typeof systemAddress !== "number" || typeof bodyId !== "number") return;

        const bk = bodyKey(systemAddress, bodyId);
        this.dssMappedBodyKeys.add(bk);
        const recForMapper = this.explorationScans.get(bk);
        this.dssFirstMapperEligibleByBodyKey.set(bk, recForMapper ? recForMapper.wasMapped !== true : false);
        const probes = line.ProbesUsed as number | undefined;
        const effTarget = line.EfficiencyTarget as number | undefined;
        const efficient =
          typeof probes === "number" &&
          typeof effTarget === "number" &&
          effTarget > 0 &&
          probes > 0 &&
          probes <= effTarget;
        this.dssMappingEfficientByBodyKey.set(bk, efficient);

        const inCurrent = this.currentSystemAddress !== null && systemAddress === this.currentSystemAddress;
        if (inCurrent) {
          const bodyNameRaw = line.BodyName as string | undefined;
          const bodyName = bodyNameRaw?.trim() ? bodyNameRaw.trim() : `Body ${bodyId}`;
          const b = ensureBody(this.bodies, systemAddress, bodyId, bodyName, this.currentSystem ?? "", ts);
          b.dssComplete = true;
          this.propagateExoAmongSimilarMoons(bodyId, systemAddress, ts, "dss_complete");
        }
        this.requestUiAutoSelectBody(systemAddress, bodyId);
        return;
      }

      if (event === "Touchdown") {
        const playerControlled = line.PlayerControlled === true;
        const taxi = line.Taxi === true;
        const onPlanet = line.OnPlanet === true;
        const onStation = line.OnStation === true;
        const systemAddress = line.SystemAddress as number | undefined;
        const bodyId = line.BodyID as number | undefined;
        const bodyStr = line.Body;
        const starSystem = line.StarSystem;
        if (
          playerControlled &&
          !taxi &&
          onPlanet &&
          !onStation &&
          typeof systemAddress === "number" &&
          typeof bodyId === "number"
        ) {
          const starFromLine = typeof starSystem === "string" && starSystem.trim() ? starSystem.trim() : null;
          const star =
            starFromLine ??
            this.visitedSystems.get(systemAddress)?.trim() ??
            this.currentSystem?.trim() ??
            "";
          const nameFromJournal = typeof bodyStr === "string" && bodyStr.trim() ? bodyStr.trim() : null;
          const nm = nameFromJournal ?? `Body ${bodyId}`;
          ensureBody(this.bodies, systemAddress, bodyId, nm, star, ts);
          this.overlayTouchdownBodyKey = bodyKey(systemAddress, bodyId);
          this.requestUiAutoSelectBody(systemAddress, bodyId);
        }
        return;
      }

      if (event === "ScanBaryCentre") {
        this.mergeBarycentreJournalLine(line, ts);
        const starSystemBary = line.StarSystem as string | undefined;
        const addrBary = line.SystemAddress as number | undefined;
        if (typeof starSystemBary === "string" && starSystemBary.trim() && typeof addrBary === "number") {
          this.rememberVisitedSystem(starSystemBary.trim(), addrBary);
        }
        return;
      }

      if (event === "Scan") {
        const systemAddress = line.SystemAddress as number;
        const bodyId = line.BodyID as number;
        const bodyName = line.BodyName as string;
        if (
          typeof systemAddress === "number" &&
          typeof bodyId === "number" &&
          typeof bodyName === "string" &&
          bodyName.trim()
        ) {
          this.mergeExplorationScan(line, ts);
          const starSystemMerge = line.StarSystem as string | undefined;
          if (typeof starSystemMerge === "string" && starSystemMerge.trim()) {
            this.rememberVisitedSystem(starSystemMerge.trim(), systemAddress);
          }
        }

        const scanType = line.ScanType as string | undefined;
        if (scanType !== "Detailed") return;

        if (
          typeof systemAddress !== "number" ||
          typeof bodyId !== "number" ||
          typeof bodyName !== "string" ||
          !bodyName.trim()
        )
          return;

        const starSystem = line.StarSystem as string;

        const wfRaw = line.WasFootfalled;
        if (typeof wfRaw === "boolean") {
          this.bodyDetailedFootfallState.set(bodyKey(systemAddress, bodyId), wfRaw);
        }

        if (this.currentSystemAddress === null || systemAddress !== this.currentSystemAddress) return;

        const scan: PlanetScan = {
          BodyName: bodyName,
          BodyID: bodyId,
          StarSystem: starSystem,
          SystemAddress: systemAddress,
          PlanetClass: line.PlanetClass as string | undefined,
          Atmosphere: line.Atmosphere as string | undefined,
          AtmosphereType: line.AtmosphereType as string | undefined,
          SurfaceGravity: line.SurfaceGravity as number | undefined,
          SurfaceTemperature: line.SurfaceTemperature as number | undefined,
          SurfacePressure: line.SurfacePressure as number | undefined,
          SemiMajorAxis: line.SemiMajorAxis as number | undefined,
          TidalLock: line.TidalLock as boolean | undefined,
          Volcanism: line.Volcanism as string | undefined,
          Landable: line.Landable as boolean | undefined,
          TerraformState: line.TerraformState as string | undefined,
          WasFootfalled: typeof wfRaw === "boolean" ? wfRaw : undefined,
          materials: line.Materials as PlanetScan["materials"],
          atmosphereComposition: line.AtmosphereComposition as PlanetScan["atmosphereComposition"],
          composition: line.Composition as PlanetScan["composition"],
          radius: line.Radius as number | undefined,
          MassEM: line.MassEM as number | undefined,
          RotationPeriod: (line as Record<string, unknown>).RotationPeriod as number | undefined,
          AxialTilt: (line as Record<string, unknown>).AxialTilt as number | undefined,
          OrbitalPeriod: (line as Record<string, unknown>).OrbitalPeriod as number | undefined,
          Eccentricity: (line as Record<string, unknown>).Eccentricity as number | undefined,
          OrbitalInclination: (line as Record<string, unknown>).OrbitalInclination as number | undefined,
          Periapsis: (line as Record<string, unknown>).Periapsis as number | undefined,
          AscendingNode: (line as Record<string, unknown>).AscendingNode as number | undefined,
          MeanAnomaly: (line as Record<string, unknown>).MeanAnomaly as number | undefined,
        };

        const b = ensureBody(
          this.bodies,
          systemAddress,
          bodyId,
          bodyName,
          starSystem ?? this.currentSystem ?? "",
          ts,
        );
        b.scan = scan;
        if (typeof starSystem === "string" && starSystem.trim()) {
          this.rememberVisitedSystem(starSystem.trim(), systemAddress);
        }
        this.propagateExoAmongSimilarMoons(bodyId, systemAddress, ts, "detailed_scan");
        return;
      }

      if (event === "ScanOrganic") {
        const systemAddress = line.SystemAddress as number;
        const bodyId = line.Body as number;
        const variant = (line.Variant_Localised as string | undefined)?.trim() ?? "";
        const genusLoc = (line.Genus_Localised as string | undefined)?.trim() ?? "";
        const genusSym = (line.Genus as string | undefined)?.trim() ?? "";
        const speciesLoc = (line.Species_Localised as string | undefined)?.trim() ?? "";
        const speciesSym = (line.Species as string | undefined)?.trim() ?? "";
        if (typeof bodyId !== "number" || typeof systemAddress !== "number" || (!variant && !speciesLoc))
          return;

        const bk = bodyKey(systemAddress, bodyId);
        if (this.exoOrganicTracker && this.exoOrganicTracker.bodyKey !== bk) {
          wipeOrganicSampleSession(this, getProjectRoot());
        }
        if (!this.exoOrganicTracker && this.footSessionBodyKey && this.footSessionBodyKey !== bk) {
          wipeOrganicSampleSession(this, getProjectRoot());
        }

        const lock: OrganicGenusLock = {
          genusLocalised: genusLoc,
          genusSymbol: genusSym,
          speciesLocalised: speciesLoc,
          speciesSymbol: speciesSym,
          variantLocalised: variant,
        };

        const speciesKey = speciesKeyFromOrganicJournal(line);
        const fullKey = `${bk}::${speciesKey}`;

        if (journalLineCarriesPlanetMetrics(line)) {
          const lineBodyName =
            typeof line.BodyName === "string" && line.BodyName.trim()
              ? line.BodyName.trim()
              : (this.findRecentJournalBodyName(systemAddress, bodyId) ??
                this.explorationScans.get(bk)?.bodyName ??
                `Body ${bodyId}`);
          this.mergeExplorationScan({ ...line, BodyID: bodyId, BodyName: lineBodyName } as JournalLine, ts);
        }

        const prevProg = this.organicAnalyseByKey.get(fullKey) ?? { count: 0, label: "" };

        const nextCountRaw = nextOrganicProgressCount(prevProg.count, line);
        if (nextCountRaw !== null) {
          const label = displayLabelFromOrganicLine(line);
          const nextCount = Math.max(prevProg.count, nextCountRaw);
          const nextLabel = label || prevProg.label;
          this.organicAnalyseByKey.set(fullKey, { count: nextCount, label: nextLabel });
          if (nextCount >= 3 && !this.pendingOrganicSales.some((p) => p.fullKey === fullKey)) {
            this.pendingOrganicSales.push({
              fullKey,
              bodyKey: bk,
              speciesKey,
              label: nextLabel,
            });
          }
        }

        const scanType = (line.ScanType as string | undefined)?.trim();
        if ((scanType === "Analyse" || scanType === "Sample") && (genusLoc || genusSym)) {
          const rec = this.explorationScans.get(bk);
          const exo = this.bodies.get(bk);
          const baseScan = exo?.scan ?? (rec ? planetScanFromExplorationRecord(rec) : null);
          if (baseScan?.PlanetClass?.trim()) {
            const fromPriorJournal = this.findRecentJournalBodyName(systemAddress, bodyId);
            const lineBodyName =
              typeof line.BodyName === "string" && line.BodyName.trim() ? line.BodyName.trim() : "";
            const bodyName = fromPriorJournal ?? lineBodyName ?? rec?.bodyName ?? `Body ${bodyId}`;
            const starSystem =
              (line.StarSystem as string | undefined)?.trim() ||
              this.findRecentJournalStarSystem(systemAddress) ||
              rec?.starSystem ||
              this.visitedSystems.get(systemAddress) ||
              "";
            try {
              recordFootScanned(getProjectRoot(), {
                systemAddress,
                bodyId,
                bodyName,
                starSystem,
                scan: baseScan,
                lock,
                ts,
                includeBacterium: this.includeBacteriumInSearch,
                dssPhysicalSlack: this.getDssPhysicalSlackRatios(),
                confirmationSource: scanType === "Analyse" ? "analyse" : "sample",
              });
            } catch {
              /* non-fatal: catalog file may be read-only */
            }
          }
        }

        const nameHint = (line.BodyName as string) || `Body ${bodyId}`;
        const recForStar = this.explorationScans.get(bk);
        const starSystem =
          (line.StarSystem as string | undefined)?.trim() ||
          this.findRecentJournalStarSystem(systemAddress) ||
          recForStar?.starSystem ||
          this.visitedSystems.get(systemAddress) ||
          this.currentSystem ||
          "";

        const b = ensureBody(this.bodies, systemAddress, bodyId, nameHint, starSystem, ts);

        if (genusLoc || genusSym) {
          b.organicGenusLocks.push(lock);
        }

        if (variant && !b.confirmedVariants.includes(variant)) b.confirmedVariants.push(variant);
        this.propagateExoAmongSimilarMoons(bodyId, systemAddress, ts, "organic");
        return;
      }

      if (event === "Embark" || event === "Embarked") {
        return;
      }

      if (event === "Disembark" || event === "Disembarked") {
        const onPlanet = line.OnPlanet === true;
        const onStation = line.OnStation === true;
        const bodyId = line.BodyID as number | undefined;
        const systemAddress = line.SystemAddress as number | undefined;
        if (onPlanet && !onStation && typeof bodyId === "number" && typeof systemAddress === "number") {
          const bk = bodyKey(systemAddress, bodyId);
          const detailedSaidUnfootfalled = this.bodyDetailedFootfallState.get(bk) === false;
          const journalFirstFootfall = line.firstfootfall === true || line.FirstFootfall === true;
          if (detailedSaidUnfootfalled || journalFirstFootfall) {
            this.firstFootfallBodies.add(bk);
          }
        }
        return;
      }

      if (event === "Died") {
        this.organicAnalyseByKey.clear();
        this.pendingOrganicSales = [];
        this.exoOrganicLastFix = null;
        wipeOrganicSampleSession(this, getProjectRoot());
        return;
      }

      if (event === "SellOrganicData") {
        const bios = line.BioData;
        if (!Array.isArray(bios)) return;
        for (const raw of bios) {
          if (!raw || typeof raw !== "object") continue;
          const sk = speciesKeyFromSellBio(raw as Record<string, unknown>);
          const idx = this.pendingOrganicSales.findIndex((p) => p.speciesKey === sk);
          if (idx >= 0) {
            const [removed] = this.pendingOrganicSales.splice(idx, 1);
            if (removed) this.organicAnalyseByKey.delete(removed.fullKey);
          }
        }
        return;
      }

      if (event === "SellExplorationData") {
        this.clearExplorationForSoldSystems((line as Record<string, unknown>).Systems);
        return;
      }

      if (event === "MultiSellExplorationData") {
        this.clearExplorationForSoldSystemsMulti((line as Record<string, unknown>).Discovered);
        return;
      }
    } finally {
      this.appendFootJournalContext(line);
    }
  }

  /** Resolve `StarSystem` name from journal to address (visited list or merged exploration rows). */
  private findSystemAddressByStarSystemName(name: string): number | null {
    const n = name.trim().toLowerCase();
    if (!n) return null;
    for (const [addr, sys] of this.visitedSystems) {
      if (sys.trim().toLowerCase() === n) return addr;
    }
    for (const [, rec] of this.explorationScans) {
      if (rec.starSystem?.trim().toLowerCase() === n) return rec.systemAddress;
    }
    return null;
  }

  /** Drop merged exploration / DSS state for a system after cartographic sale (journal replay order). */
  private clearExplorationDataForSystem(systemAddress: number): void {
    const prefix = `${systemAddress}:`;
    for (const k of [...this.explorationScans.keys()]) {
      if (k.startsWith(prefix)) {
        this.explorationScans.delete(k);
        this.explorationScansRevision += 1;
      }
    }
    for (const k of [...this.dssMappedBodyKeys]) {
      if (k.startsWith(prefix)) this.dssMappedBodyKeys.delete(k);
    }
    for (const k of [...this.dssFirstMapperEligibleByBodyKey.keys()]) {
      if (k.startsWith(prefix)) this.dssFirstMapperEligibleByBodyKey.delete(k);
    }
    for (const k of [...this.dssMappingEfficientByBodyKey.keys()]) {
      if (k.startsWith(prefix)) this.dssMappingEfficientByBodyKey.delete(k);
    }
    for (const k of [...this.fssBodySignalsBodyKeys]) {
      if (k.startsWith(prefix)) this.fssBodySignalsBodyKeys.delete(k);
    }
    this.fssAllBodiesCompleteSystems.delete(systemAddress);
    this.fssAllBodiesFoundCountBySystem.delete(systemAddress);
    this.fssDiscoveryScanBySystem.delete(systemAddress);
    for (const k of [...this.orbitParentPlanetByBody.keys()]) {
      if (k.startsWith(prefix)) this.orbitParentPlanetByBody.delete(k);
    }
  }

  /** `SellExplorationData.Systems` — string names and/or objects with SystemAddress / SystemName. */
  private clearExplorationForSoldSystems(systems: unknown): void {
    if (!Array.isArray(systems)) return;
    for (const item of systems) {
      if (typeof item === "string") {
        const addr = this.findSystemAddressByStarSystemName(item);
        if (addr != null) this.clearExplorationDataForSystem(addr);
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      if (typeof o.SystemAddress === "number" && Number.isFinite(o.SystemAddress)) {
        this.clearExplorationDataForSystem(o.SystemAddress);
        continue;
      }
      const nm = o.SystemName ?? o.StarSystem ?? o.System;
      if (typeof nm === "string") {
        const addr = this.findSystemAddressByStarSystemName(nm);
        if (addr != null) this.clearExplorationDataForSystem(addr);
      }
    }
  }

  /** `MultiSellExplorationData.Discovered` — { SystemName, NumBodies }[] (optional SystemAddress). */
  private clearExplorationForSoldSystemsMulti(discovered: unknown): void {
    if (!Array.isArray(discovered)) return;
    for (const item of discovered) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      if (typeof o.SystemAddress === "number" && Number.isFinite(o.SystemAddress)) {
        this.clearExplorationDataForSystem(o.SystemAddress);
        continue;
      }
      const nm = o.SystemName;
      if (typeof nm === "string") {
        const addr = this.findSystemAddressByStarSystemName(nm);
        if (addr != null) this.clearExplorationDataForSystem(addr);
      }
    }
  }

  /**
   * Moons of the same planet typically share biological signals, DSS genus lists, mapped state, and surface stats.
   * Mirrors FSS → `fss_signals`, DSS probe → `saas_signals`, DSS complete → `dss_complete`, detailed `Scan` →
   * `detailed_scan`, ScanOrganic → `organic`.
   */
  private propagateExoAmongSimilarMoons(
    sourceBodyId: number,
    systemAddress: number,
    ts: string,
    mode: "fss_signals" | "saas_signals" | "dss_complete" | "detailed_scan" | "organic",
  ): void {
    const sk = bodyKey(systemAddress, sourceBodyId);
    const sourceBody = this.bodies.get(sk);
    if (!sourceBody) return;

    const sourceRec = this.explorationScans.get(sk) ?? null;
    if (!sourceRec && !this.orbitParentPlanetByBody.has(sk)) return;

    for (const bid of siblingMoonBodyIdsUnified(this, systemAddress, sourceBodyId)) {
      const sibRec = this.explorationScans.get(bodyKey(systemAddress, bid)) ?? null;
      if (sourceRec && sibRec && !explorationRecordsSimilarForSharedExo(sourceRec, sibRec)) continue;

      const sibName =
        sibRec?.bodyName?.trim() ||
        this.bodies.get(bodyKey(systemAddress, bid))?.bodyName?.trim() ||
        `Body ${bid}`;
      const sibStar = sibRec?.starSystem?.trim() || sourceRec?.starSystem?.trim() || this.currentSystem || "";
      const b = ensureBody(this.bodies, systemAddress, bid, sibName, sibStar, ts);

      if (mode === "fss_signals") {
        if (sourceBody.biologicalSignals != null) b.biologicalSignals = sourceBody.biologicalSignals;
        if (sourceBody.genusHints?.length) {
          b.genusHints = mergeGenusHints(b.genusHints, sourceBody.genusHints);
        }
        if (sourceBody.signalHints?.length) {
          const set = new Set<string>([...(b.signalHints ?? []), ...sourceBody.signalHints]);
          b.signalHints = set.size ? [...set] : b.signalHints;
        }
      } else if (mode === "saas_signals") {
        if (sourceBody.biologicalSignals != null) b.biologicalSignals = sourceBody.biologicalSignals;
        // Merge, never replace: the sibling's own DSS result is at least as authoritative as this
        // one's, and overwriting it deleted genera the commander went on to scan there. See the
        // `fss_signals` branch above, which has always merged.
        if (sourceBody.genusHints?.length) {
          b.genusHints = mergeGenusHints(b.genusHints, sourceBody.genusHints);
        }
        if (sourceBody.signalHints?.length) {
          const set = new Set<string>([...(b.signalHints ?? []), ...sourceBody.signalHints]);
          b.signalHints = set.size ? [...set] : b.signalHints;
        }
      } else if (mode === "dss_complete") {
        b.dssComplete = true;
        if (sourceBody.genusHints?.length) {
          b.genusHints = mergeGenusHints(b.genusHints, sourceBody.genusHints);
        }
        if (sourceBody.biologicalSignals != null) b.biologicalSignals = sourceBody.biologicalSignals;
      } else if (mode === "detailed_scan") {
        const srcScan = sourceBody.scan;
        if (srcScan?.PlanetClass) {
          b.scan = buildSiblingPlanetScan(this, srcScan, systemAddress, bid, sibRec);
        }
      } else {
        const seen = new Set(b.organicGenusLocks.map(organicLockGenusKey));
        for (const lock of sourceBody.organicGenusLocks) {
          const gk = organicLockGenusKey(lock);
          if (gk && seen.has(gk)) continue;
          if (gk) seen.add(gk);
          b.organicGenusLocks.push({ ...lock });
        }
        for (const v of sourceBody.confirmedVariants) {
          if (!b.confirmedVariants.includes(v)) b.confirmedVariants.push(v);
        }
      }
    }
  }

  listBioBodies(): BodyExoState[] {
    const focus = this.viewingSystemAddress ?? this.currentSystemAddress;
    if (focus === null) return [];
    return [...this.bodies.values()].filter((b) => {
      if (b.systemAddress !== focus) return false;
      /** FSS `Biological` count 0: omit from bio body list even when DSS listed genera. */
      if (b.biologicalSignals === 0) return false;
      const hasBioCount = b.biologicalSignals !== null && b.biologicalSignals > 0;
      const hasHints = !!(b.genusHints && b.genusHints.length);
      const confirmed = b.confirmedVariants.length > 0;
      const organicLocks = b.organicGenusLocks.length > 0;
      return hasBioCount || hasHints || confirmed || organicLocks;
    });
  }

  /** Exo-Candidates overlay: prefer touchdown while on foot, else client-selected tab. */
  resolveExoOverlayFocusBodyKey(): string | null {
    const posted = this.uiSelectedBodyKey;
    const td = this.overlayTouchdownBodyKey;
    const pick = this.footTravelOdometerTracking && td ? td : (posted ?? td);
    if (!pick) return null;
    const focus = this.viewingSystemAddress ?? this.currentSystemAddress;
    if (focus === null) return null;
    const raw = this.bodies.get(pick);
    if (!raw || raw.systemAddress !== focus) return null;
    const addrPart = pick.split(":")[0];
    if (!addrPart || Number(addrPart) !== focus) return null;
    return pick;
  }

  /**
   * Live `Status.json` fuel — returns true when main/reserve changed (for snapshot push).
   */
  applyLiveShipFuel(mainT: number | null, reserveT: number | null): boolean {
    this.liveStatusFuelMainT = mainT;
    this.liveStatusFuelReserveT = reserveT;
    const key =
      mainT != null && reserveT != null && Number.isFinite(mainT) && Number.isFinite(reserveT)
        ? `${mainT.toFixed(4)}|${reserveT.toFixed(4)}`
        : "x";
    if (key === this.lastLiveShipFuelPushKey) return false;
    this.lastLiveShipFuelPushKey = key;
    return true;
  }

  /**
   * Live `NavRoute.json` — returns true when the plotted route changed (for snapshot push).
   */
  applyLiveNavRoute(waypoints: NavRouteWaypointDTO[] | null): boolean {
    this.liveNavRoute = waypoints;
    const key =
      waypoints && waypoints.length > 0
        ? waypoints.map((w) => `${w.systemAddress}`).join(":")
        : waypoints === null
          ? "null"
          : "empty";
    if (key === this.lastLiveNavRoutePushKey) return false;
    this.lastLiveNavRoutePushKey = key;
    return true;
  }

  /** Journal replay snapshot for disk cache (`format` must match {@link JOURNAL_MERGE_CACHE_FORMAT}). */
  serializeJournalMergePayload(): JournalMergeCachePayload {
    return {
      format: JOURNAL_MERGE_CACHE_FORMAT,
      commanderName: this.commanderName,
      currentSystem: this.currentSystem,
      currentSystemAddress: this.currentSystemAddress,
      viewingSystemAddress: this.viewingSystemAddress,
      visitedSystems: [...this.visitedSystems.entries()],
      bodies: [...this.bodies.entries()],
      explorationScans: [...this.explorationScans.entries()],
      fssBodySignalsBodyKeys: [...this.fssBodySignalsBodyKeys],
      dssMappedBodyKeys: [...this.dssMappedBodyKeys],
      dssFirstMapperEligibleByBodyKey: [...this.dssFirstMapperEligibleByBodyKey.entries()],
      dssMappingEfficientByBodyKey: [...this.dssMappingEfficientByBodyKey.entries()],
      orbitParentPlanetByBody: [...this.orbitParentPlanetByBody.entries()],
      lastEventIso: this.lastEventIso,
      footJournalContextBuffer: this.footJournalContextBuffer.slice(),
      organicAnalyseByKey: [...this.organicAnalyseByKey.entries()],
      bodyDetailedFootfallState: [...this.bodyDetailedFootfallState.entries()],
      firstFootfallBodies: [...this.firstFootfallBodies],
      pendingOrganicSales: this.pendingOrganicSales.map((p) => ({ ...p })),
      fssAllBodiesCompleteSystems: [...this.fssAllBodiesCompleteSystems],
      fssDiscoveryScanBySystem: [...this.fssDiscoveryScanBySystem.entries()],
      fssAllBodiesFoundCountBySystem: [...this.fssAllBodiesFoundCountBySystem.entries()],
      fsdJumpWasDiscoveredBySystem: [...this.fsdJumpWasDiscoveredBySystem.entries()],
      remainingJumpsInRoute: this.remainingJumpsInRoute,
      loadoutMaxJumpRangeLy: this.loadoutMaxJumpRangeLy,
      loadoutFuelMainCapacityT: this.loadoutFuelMainCapacityT,
      loadoutFuelReserveCapacityT: this.loadoutFuelReserveCapacityT,
      lastFsdJumpFuelUsedT: this.lastFsdJumpFuelUsedT,
      lastFsdJumpDistLy: this.lastFsdJumpDistLy,
    };
  }

  /**
   * Restores journal-derived state after {@link resetAll}. User prefs on the store are unchanged
   * (they were not cleared by `resetAll`).
   */
  hydrateJournalMergePayload(data: JournalMergeCachePayload): void {
    if (data.format !== 1 && data.format !== 2) return;
    if (
      !Array.isArray(data.bodies) ||
      !Array.isArray(data.explorationScans) ||
      !Array.isArray(data.visitedSystems)
    ) {
      return;
    }
    this.resetAll();
    this.commanderName = data.commanderName;
    this.currentSystem = data.currentSystem;
    this.currentSystemAddress = data.currentSystemAddress;
    this.viewingSystemAddress = data.viewingSystemAddress;
    this.lastEventIso = data.lastEventIso;
    for (const [addr, name] of data.visitedSystems) this.visitedSystems.set(addr, name);
    for (const [k, v] of data.bodies) this.bodies.set(k, v);
    for (const [k, v] of data.explorationScans) this.explorationScans.set(k, v);
    this.explorationScansRevision += 1;
    for (const k of data.fssBodySignalsBodyKeys) this.fssBodySignalsBodyKeys.add(k);
    for (const k of data.dssMappedBodyKeys) this.dssMappedBodyKeys.add(k);
    for (const [k, v] of data.dssFirstMapperEligibleByBodyKey) this.dssFirstMapperEligibleByBodyKey.set(k, v);
    for (const [k, v] of data.dssMappingEfficientByBodyKey) this.dssMappingEfficientByBodyKey.set(k, v);
    for (const [k, v] of data.orbitParentPlanetByBody) this.orbitParentPlanetByBody.set(k, v);
    this.footJournalContextBuffer.length = 0;
    this.footJournalContextBuffer.push(...data.footJournalContextBuffer);
    for (const [k, v] of data.organicAnalyseByKey) this.organicAnalyseByKey.set(k, v);
    for (const [k, v] of data.bodyDetailedFootfallState) this.bodyDetailedFootfallState.set(k, v);
    for (const k of data.firstFootfallBodies) this.firstFootfallBodies.add(k);
    this.pendingOrganicSales = data.pendingOrganicSales.map((p) => ({ ...p }));
    for (const addr of data.fssAllBodiesCompleteSystems) this.fssAllBodiesCompleteSystems.add(addr);
    for (const [addr, row] of data.fssDiscoveryScanBySystem) {
      this.fssDiscoveryScanBySystem.set(addr, { ...row });
    }
    this.fssAllBodiesFoundCountBySystem.clear();
    for (const [addr, cnt] of data.fssAllBodiesFoundCountBySystem ?? []) {
      if (typeof addr === "number" && typeof cnt === "number" && cnt > 0) {
        this.fssAllBodiesFoundCountBySystem.set(addr, cnt);
      }
    }
    this.fsdJumpWasDiscoveredBySystem.clear();
    if (data.format >= 2) {
      for (const [a, w] of data.fsdJumpWasDiscoveredBySystem ?? []) {
        if (typeof a === "number" && typeof w === "boolean") this.fsdJumpWasDiscoveredBySystem.set(a, w);
      }
      const rj = data.remainingJumpsInRoute;
      this.remainingJumpsInRoute =
        typeof rj === "number" && Number.isFinite(rj) ? Math.max(0, Math.floor(rj)) : null;
    } else {
      this.remainingJumpsInRoute = null;
    }
    const lmj = data.loadoutMaxJumpRangeLy;
    this.loadoutMaxJumpRangeLy = typeof lmj === "number" && Number.isFinite(lmj) && lmj > 0 ? lmj : null;
    const lfm = data.loadoutFuelMainCapacityT;
    this.loadoutFuelMainCapacityT = typeof lfm === "number" && Number.isFinite(lfm) && lfm > 0 ? lfm : null;
    const lfr = data.loadoutFuelReserveCapacityT;
    this.loadoutFuelReserveCapacityT =
      typeof lfr === "number" && Number.isFinite(lfr) && lfr >= 0 ? lfr : null;
    const lff = data.lastFsdJumpFuelUsedT;
    this.lastFsdJumpFuelUsedT = typeof lff === "number" && Number.isFinite(lff) && lff > 0 ? lff : null;
    const ljd = data.lastFsdJumpDistLy;
    this.lastFsdJumpDistLy = typeof ljd === "number" && Number.isFinite(ljd) && ljd > 0 ? ljd : null;
  }
}
