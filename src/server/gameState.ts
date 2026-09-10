import type {
  BodyExoState,
  ExplorationScanRecord,
  JournalLine,
  PlanetScan,
  GenusHint,
  OrganicGenusLock,
  SpeciesEntry,
} from "../shared/types.js";
import type { JournalHistoryPreset } from "../shared/journalHistoryPreset.js";
import {
  UNOBSERVED,
  mergeObservation,
  type ObservationSource,
  type ObservedFlag,
} from "../shared/observedFlag.js";
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
import { explorationRecordIsBeltClusterLike } from "./explorationStellar.js";
import { greatCircleDistanceMeters, type FootTravelFix } from "./footTravelStatus.js";
import type { ExoOrganicTrackerInternal } from "./exoOrganicTracker.js";
import {
  wipeOrganicSampleSession,
  clearPersistedOrganicSampleSession,
  normStatusBodyName,
} from "./organicSampleSessionFile.js";
import type { NavRouteWaypointDTO } from "./navRouteFuel.js";
import { codexSpeciesFromLine } from "../shared/codexLog.js";
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

/**
 * Increment when journal-derived snapshot shape changes — invalidates on-disk merge cache.
 *
 * "Shape" includes *adding* a field, not only changing one. Every field here is optional on decode,
 * so a stale cache does not fail: it restores the old shape, the new field comes back empty, and the
 * feature that reads it stays dark with nothing logged anywhere.
 *
 * 5 — no new field. `WasFootfalled` is now read from every scan type and the physics gate tests
 *     content rather than the `Detailed` label, so a cache built by the old code carries wrong
 *     `firstFootfallBodies` and missing body scans. **A change in how the payload is derived
 *     invalidates it exactly as much as a change in its shape** — the owner's Stratum Tectonicas
 *     stayed flagged as a first footfall through a fix that had already landed, because the shape
 *     had not changed and the old answer was restored verbatim.
 * 4 — `systemPositions`, so the galaxy map can place the backlog.
 * 3 — `mainStarWasDiscoveredBySystem`. It was added to the payload without bumping this, so caches
 * written before 2026-09-08 replayed nothing and the FIRST chip could never light for anyone holding
 * one. Bumping forces a single rebuild per user, which is the whole cost.
 */
export const JOURNAL_MERGE_CACHE_FORMAT = 5;

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
  /**
   * Physics-only archive of scans whose system was sold. Optional so a cache written before this
   * existed still loads — it simply has none, until the next rebuild recovers them from the logs.
   */
  soldExplorationScans?: [string, ExplorationScanRecord][];
  fssBodySignalsBodyKeys: string[];
  dssMappedBodyKeys: string[];
  dssFirstMapperEligibleByBodyKey: [string, boolean][];
  dssMappingEfficientByBodyKey: [string, boolean][];
  orbitParentPlanetByBody: [string, number][];
  lastEventIso: string | null;
  footJournalContextBuffer: JournalLine[];
  organicAnalyseByKey: [string, OrganicAnalyseProgress][];
  bodyDetailedFootfallState: [string, boolean][];
  /**
   * Phase 3 provenance. Optional so a cache written before this existed still loads — it simply has
   * no ages until the next rebuild from the logs, and an absent flag reads as unknown, which is the
   * honest answer rather than a silent `false`.
   */
  /** §10.3. Optional so a cache written before this loads; absent simply means "not drawn yet". */
  commanderPos?: { x: number; y: number; z: number } | null;
  bodyFootfallFlag?: [string, ObservedFlag][];
  bodyMappedFlag?: [string, ObservedFlag][];
  firstFootfallBodies: string[];
  /**
   * Codex keys for species this commander has logged (B4). Optional so a cache written before this
   * existed still loads — it simply has none until the next rebuild from the logs.
   */
  codexLoggedSpecies?: string[];
  /** Minutes per approach-and-landing and per sampling run, for the triage screen's own timing (B5). */
  landingMinutesSamples?: number[];
  samplingMinutesSamples?: number[];
  pendingOrganicSales: PendingOrganicSample[];
  fssAllBodiesCompleteSystems: number[];
  fssDiscoveryScanBySystem: [number, { systemName: string; bodyCount: number; progress: number }][];
  /** Optional — `FSSAllBodiesFound.Count` per system. */
  fssAllBodiesFoundCountBySystem?: [number, number][];
  /** Present when {@link format} >= 2. */
  mainStarWasDiscoveredBySystem?: [number, boolean][];
  systemPositions?: [number, { x: number; y: number; z: number }][];
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
   * Scan rows kept for their physics after the commander sold the system's cartographic data.
   *
   * Selling clears {@link explorationScans} for that system, because everything the app says about
   * payouts, first discovery and first mapping has to go with it. That was right for value and
   * wrong for everything else: the same record carries surface gravity, materials, solid
   * composition and — through the system's star rows — the body's host star. The commander sells
   * almost everything, so 13,713 scanned bodies had shrunk to 676 usable scan rows across 75
   * systems, and the matcher was scoring history with the star and composition terms permanently
   * blank.
   *
   * Nothing that computes credits, eligibility or map state may read this map. It is physics only:
   * what the body is, never what it is worth. {@link physicsExplorationScan} is the one accessor.
   */
  readonly soldExplorationScans = new Map<string, ExplorationScanRecord>();

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
  /**
   * Footfall and mapping as tri-states with provenance — INCLUDE-BODY-IDS Phase 3.
   *
   * {@link bodyDetailedFootfallState} above is now a **projection** of `bodyFootfallFlag`, kept
   * because the payout path and the merge cache both speak boolean. Everything writes through
   * {@link observeFootfall} / {@link observeMapped}, so the two cannot drift, and the sticky-`true`
   * rule now applies to the payout path as well rather than only to the new surface.
   *
   * The flags carry what a bare boolean cannot: **when** the claim was made, and by whom. A `false`
   * is only true as of its timestamp, and rung 2 of the target ladder is meaningless without a date
   * (§1.5, §2.7).
   */
  readonly bodyFootfallFlag = new Map<string, ObservedFlag>();
  readonly bodyMappedFlag = new Map<string, ObservedFlag>();

  /**
   * Record a footfall observation. The merge rules live in `observedFlag.ts`, not here — this is
   * the only place the app folds one in, which is what makes a journal re-scan idempotent.
   */
  observeFootfall(bk: string, value: boolean, source: ObservationSource, seenAt: string): void {
    const merged = mergeObservation(this.bodyFootfallFlag.get(bk) ?? UNOBSERVED, { value, source, seenAt });
    this.bodyFootfallFlag.set(bk, merged);
    if (merged.value !== null) this.bodyDetailedFootfallState.set(bk, merged.value);
  }

  /** Record a mapping observation. Same rules, same reason. */
  observeMapped(bk: string, value: boolean, source: ObservationSource, seenAt: string): void {
    this.bodyMappedFlag.set(
      bk,
      mergeObservation(this.bodyMappedFlag.get(bk) ?? UNOBSERVED, { value, source, seenAt }),
    );
  }
  /** Bodies where this commander gets first-footfall organic payout (1× + 4× bonus = 5× list in valuation). */
  readonly firstFootfallBodies = new Set<string>();

  /**
   * Species this commander has a codex page for, by `codexSpeciesKey` (B4).
   *
   * Collected from every `CodexEntry` in the merged journals, colour variant stripped: the variant is
   * a fact about the host star, and the same species is amethyst in one system and emerald in the
   * next. What the app does with it is the opposite of a warning — a species *missing* from here is
   * the one a codex hunter wants to fly to.
   */
  readonly codexLoggedSpecies = new Set<string>();

  /**
   * How long this commander's own trips actually take, in minutes (B5).
   *
   * The triage screen ships with medians measured from one commander's 244 journals — 1.2 minutes to
   * land, 2.5 to sample a genus — and those are *this* commander's habits, not a constant of the
   * game. Somebody who flies an Anaconda and takes their time is not somebody in a Mandalay who does
   * not. B5 asked for knobs; the app can measure instead, from the journals it already reads, and a
   * measured number beats one the user has to guess at.
   *
   * Collected on replay: `SupercruiseExit` to `Touchdown` on the same body, and the first
   * `ScanOrganic` sample of a species to its `Analyse`.
   */
  readonly landingMinutesSamples: number[] = [];
  readonly samplingMinutesSamples: number[] = [];
  /** Open legs, cleared as they complete. Not persisted: a half-finished trip is not a measurement. */
  private scExitAt: { at: number; body: string } | null = null;
  private organicRunStartedAt = new Map<string, number>();
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
   * Whether each system's **main star** had been discovered before this commander scanned it.
   *
   * Populated from `Scan`, which is the only event that carries `WasDiscovered`. It used to be fed
   * from `FSDJump` / `CarrierJump`, which never carry it — measured across this commander's 244
   * journals, the field appears on 0 of 6,549 of those events — so the map was permanently empty and
   * the "FIRST" badge that reads it had never once rendered.
   *
   * Keyed on the main star rather than on any body because that is what the badge claims. A body can
   * be undiscovered inside a system somebody else found: of the 1,159 systems where this commander
   * was first to scan *something*, 672 had a primary that was already known. Counting those as a
   * system discovery would inflate the badge nearly threefold.
   *
   * Absent means "no main-star scan yet", which is not the same as `true` — 1,417 of 2,847 visited
   * systems have no `BodyID 0` scan at all, and the badge must stay silent for those rather than
   * claim the system was already found.
   */
  readonly mainStarWasDiscoveredBySystem = new Map<number, boolean>();
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
   * Look the destination system up on EDSM as soon as the commander jumps into it (§50).
   *
   * **Default off, and it stays off until the commander stores their own EDSM key**, because turning
   * it on sends the name of every system they enter to a third party. That is not a preference like
   * a temperature unit; it is a standing consent to outbound traffic, so it is opt-in twice over.
   */
  edsmAutoFetchEnabled = false;

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

  setEdsmAutoFetchEnabled(value: boolean): void {
    this.edsmAutoFetchEnabled = value;
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

  /**
   * The scan row to read a body's *physics* from — live if we still hold it, else the sold archive.
   *
   * Value, eligibility and map state must keep reading {@link explorationScans} directly: a sold
   * system has no payout left and no first-discovery bonus, and nothing here changes that. This is
   * for the matcher and the habitat scorer, which want to know what the body is.
   */
  physicsExplorationScan(key: string): ExplorationScanRecord | null {
    return this.explorationScans.get(key) ?? this.soldExplorationScans.get(key) ?? null;
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
    this.codexLoggedSpecies.clear();
    this.landingMinutesSamples.length = 0;
    this.samplingMinutesSamples.length = 0;
    this.scExitAt = null;
    this.organicRunStartedAt.clear();
    this.bodyDetailedFootfallState.clear();
    this.bodyFootfallFlag.clear();
    this.bodyMappedFlag.clear();
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
    this.soldExplorationScans.clear();
    this.explorationScansRevision += 1;
    this.edsmExplorationByKey.clear();
    this.commanderName = null;
    this.currentSystem = null;
    this.currentSystemAddress = null;
    this.commanderPos = null;
    this.viewingSystemAddress = null;
    this.visitedSystems.clear();
    this.lastEventIso = null;
    this.organicAnalyseByKey.clear();
    this.bodyDetailedFootfallState.clear();
    this.bodyFootfallFlag.clear();
    this.bodyMappedFlag.clear();
    this.firstFootfallBodies.clear();
    this.codexLoggedSpecies.clear();
    this.landingMinutesSamples.length = 0;
    this.samplingMinutesSamples.length = 0;
    this.scExitAt = null;
    this.organicRunStartedAt.clear();
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
    this.mainStarWasDiscoveredBySystem.clear();
    this.systemPositions.clear();
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

  /**
   * The commander's own position in light years, from `FSDJump` / `CarrierJump` / `Location`.
   *
   * The app has always known *which* system the commander is in; it never kept **where that is**,
   * because nothing needed a coordinate until the sector map (§10.3). `StarPos` rides on all three
   * of those events, so this is a capture rather than a lookup — no EDSM call, no join.
   *
   * Null until the first such event. A journal replay fills it from the last one in the logs, which
   * is the right answer for a commander who has just started the app.
   */
  commanderPos: { x: number; y: number; z: number } | null = null;

  /**
   * Where each system the commander has been is, in light years.
   *
   * `commanderPos` above answers "where am I"; this answers "where was that". Nothing needed the
   * second question until the galaxy map had to plot the backlog: a list of systems worth flying to
   * is useless on a map that cannot place them. The coordinate rides on the same events, so this is
   * still a capture rather than a lookup — no EDSM call, no join.
   *
   * Only systems actually visited appear. A system known only from a Spansh export or an EDSM
   * hydration has no `StarPos` in this commander's journals and is simply absent, which the map
   * draws as "not placeable" rather than as the origin.
   */
  readonly systemPositions = new Map<number, { x: number; y: number; z: number }>();

  /** Read `StarPos` off a journal line, when it carries one. */
  private setPositionFromLine(line: JournalLine): void {
    const p = (line as Record<string, unknown>).StarPos;
    if (!Array.isArray(p) || p.length < 3) return;
    const [x, y, z] = p as unknown[];
    if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    this.commanderPos = { x, y, z };
    const addr = (line as Record<string, unknown>).SystemAddress;
    if (typeof addr === "number" && Number.isFinite(addr)) {
      this.systemPositions.set(addr, { x, y, z });
    }
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
   * Journal `ScanBaryCentre`: the orbit of the `{ Null: BodyID }` node in `Scan.Parents`.
   *
   * **These elements describe the barycentre's own orbit around *its* parent — not the mutual orbit
   * of its children**, which is what this comment used to claim. Measured on Swoilz KI-E b4-9:
   * `ScanBaryCentre` for barycentre 7 reports a semi-major axis of 56.6 ls, and its two children,
   * planets 3 and 4, sit at 56.6 ls from the star. Their orbits *around each other* are 0.097 and
   * 0.144 ls. The number is the distance to the star, unambiguously.
   *
   * The distinction is load-bearing: `starDistanceLs` reads this field to answer how far a body is
   * from its host star when a barycentre stands between them, and EDSM and Spansh both drop the
   * event, so the journal is the only place it exists.
   *
   * Stored at `bodyId = barycentreSyntheticBodyId(journalNullId)` so rows never collide with real
   * body scans.
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
    /*
     * The main star's flag answers a question about the whole system, so it is lifted out here.
     *
     * `BodyID 0` is the main star. Its `WasDiscovered` is what the game uses to decide whether the
     * system counts as this commander's discovery — the name on the system, and the bonus on the
     * cartographic sale. Every other body's flag is about that body alone.
     *
     * Written once and not overwritten by a later re-scan of the same star: the first observation is
     * the one made before anyone could have been beaten to it, and a subsequent visit would report
     * the system as discovered — by this commander.
     */
    if (bodyId === 0) {
      const wd = (line as Record<string, unknown>).WasDiscovered;
      if (typeof wd === "boolean" && !this.mainStarWasDiscoveredBySystem.has(systemAddress)) {
        this.mainStarWasDiscoveredBySystem.set(systemAddress, wd);
      }
    }
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
    // Scanned again after the sale: the live row is the better copy of the same physics.
    this.soldExplorationScans.delete(k);

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
          // No `WasDiscovered` read here: jump events do not carry it. See
          // `mainStarWasDiscoveredBySystem`, which is filled from `Scan` instead.
          this.viewingSystemAddress = null;
          this.setPositionFromLine(line);
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
        if (sys && typeof addr === "number") {
          this.setPositionFromLine(line);
          this.setLocation(sys, addr);
        }
        return;
      }

      if (event === "SupercruiseExit") {
        const body = typeof line.Body === "string" ? line.Body.trim() : "";
        const at = Date.parse(ts);
        if (body && Number.isFinite(at)) this.scExitAt = { at, body };
        return;
      }

      if (event === "CodexEntry") {
        const species = codexSpeciesFromLine(line as Parameters<typeof codexSpeciesFromLine>[0]);
        if (species) this.codexLoggedSpecies.add(species);
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
        // Our own DSS: the body is mapped from this moment on, whoever got there first.
        this.observeMapped(bk, true, "journal", (line.timestamp as string) ?? new Date().toISOString());
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
        // How long the last approach took, when this is the body we dropped at.
        const tdBody = typeof line.Body === "string" ? line.Body.trim() : "";
        const tdAt = Date.parse(ts);
        if (this.scExitAt && tdBody && tdBody === this.scExitAt.body && Number.isFinite(tdAt)) {
          const minutes = (tdAt - this.scExitAt.at) / 60_000;
          // Over half an hour is a commander who went to make tea, not an approach.
          if (minutes > 0 && minutes < 30) this.landingMinutesSamples.push(minutes);
        }
        this.scExitAt = null;

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

        /*
         * `WasFootfalled` and `WasMapped` are read from **every** scan that carries them, not only
         * the detailed one — and that placement is the whole bug this block exists to prevent.
         *
         * Aucoks OG-E b18-3 A 1, 2026-09-09, is the case that found it. The game wrote two scans:
         *
         *   11:55:05  AutoScan   WasMapped true   WasFootfalled true
         *   11:56:10  Detailed   WasMapped false  WasFootfalled false
         *
         * The second arrives immediately after the commander's own `SAAScanComplete` and contradicts
         * the first. With these reads sitting below a `ScanType !== "Detailed"` return, the honest
         * `true` was thrown away unseen and only the `false` was ever recorded — so a body somebody
         * else had already walked was offered as an unclaimed 5x. Footfall does not un-happen; the
         * sticky-`true` merge in observedFlag.ts is what settles the contradiction, but it can only
         * do that if it is shown both claims.
         *
         * The physics below has its own admission test, on what the line contains rather than on its
         * label — an auto scan from flying to a body carries the whole record.
         */
        if (
          typeof systemAddress === "number" &&
          typeof bodyId === "number" &&
          typeof bodyName === "string" &&
          bodyName.trim()
        ) {
          const anyScanTs = (line.timestamp as string) ?? new Date().toISOString();
          const wf = line.WasFootfalled;
          if (typeof wf === "boolean") {
            this.observeFootfall(bodyKey(systemAddress, bodyId), wf, "journal", anyScanTs);
          }
          // `Scan.WasMapped` is "had anyone mapped this at the moment of the scan". Our own DSS makes
          // later scans report true, which is why the *first-mapper* question is frozen separately at
          // SAAScanComplete — but for "has anyone mapped it", a later true is simply correct.
          const wm = (line as Record<string, unknown>).WasMapped;
          if (typeof wm === "boolean") {
            this.observeMapped(bodyKey(systemAddress, bodyId), wm, "journal", anyScanTs);
          }
        }

        /*
         * Accept any scan that actually describes the body, whatever it is labelled.
         *
         * This used to require `ScanType === "Detailed"`, on the assumption that nothing else
         * carries the physics. It is not true. Flying to a body — rather than reaching it through
         * the FSS — writes an `AutoScan` with the whole record: planet class, atmosphere, volcanism,
         * gravity, temperature, pressure, materials, composition. Reported from the field on
         * Aucoks AN-Q d6-59 BC 2, where the commander flew out, got a complete scan, and the app
         * offered no candidate species at all because of the label on it.
         *
         * Across this commander's 245 journals that gate discarded **1,223 landable bodies** whose
         * `AutoScan` carried full physics, and 142 more from `NavBeaconDetail`. So the test is what
         * the line contains, not what it is called: a planet class plus the two numbers every gate
         * needs. `Basic` scans have none of that and still fall out here, as they should.
         */
        const hasPhysics =
          typeof line.PlanetClass === "string" &&
          line.PlanetClass.trim() !== "" &&
          typeof line.SurfaceGravity === "number" &&
          typeof line.SurfaceTemperature === "number";
        if (!hasPhysics) return;

        if (
          typeof systemAddress !== "number" ||
          typeof bodyId !== "number" ||
          typeof bodyName !== "string" ||
          !bodyName.trim()
        )
          return;

        const starSystem = line.StarSystem as string;

        const scanTs = (line.timestamp as string) ?? new Date().toISOString();
        const wfRaw = line.WasFootfalled;

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

        /**
         * The sampling run: first sample of a species on a body to the analyse that completes it.
         *
         * Keyed per species per body, because a commander taking two genera on one landing runs two
         * of these and they interleave.
         */
        const runScanType = typeof line.ScanType === "string" ? line.ScanType : "";
        const organicAt = Date.parse(ts);
        if (Number.isFinite(organicAt)) {
          if (runScanType === "Log" || runScanType === "Sample") {
            if (!this.organicRunStartedAt.has(fullKey)) this.organicRunStartedAt.set(fullKey, organicAt);
          } else if (runScanType === "Analyse") {
            const startedAt = this.organicRunStartedAt.get(fullKey);
            if (startedAt != null) {
              const minutes = (organicAt - startedAt) / 60_000;
              if (minutes > 0 && minutes < 90) this.samplingMinutesSamples.push(minutes);
            }
            this.organicRunStartedAt.delete(fullKey);
          }
        }

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
        /*
         * `Log` counts, and used to be dropped.
         *
         * All three ScanOrganic types name the species — every one of this commander's 1,166 lines
         * carries `Species_Localised` — so all three are first-hand proof the species was on that
         * body. Only `Analyse` and `Sample` were recorded, which silently lost every species that
         * was logged and then left alone: 85 of 352 observations, because skipping a low-value plant
         * after logging it is a normal way to play, not an incomplete action.
         */
        const isOrganicConfirmation =
          scanType === "Analyse" || scanType === "Sample" || scanType === "Log";
        if (isOrganicConfirmation && (genusLoc || genusSym)) {
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
                confirmationSource: scanType === "Analyse" ? "analyse" : scanType === "Sample" ? "sample" : "log",
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
          /**
           * Kept for a field the journal does not currently write.
           *
           * Audited 2026-09-08 against 244 journals: `Disembark` carries `Body`, `BodyID`, `ID`,
           * `MarketID`, `Multicrew`, `OnPlanet`, `OnStation`, `SRV`, `StarSystem`, `StationName`,
           * `StationType`, `SystemAddress`, `Taxi`, `event` and `timestamp` — and nothing resembling
           * a first-footfall flag, in any casing, across 1,029 events. This half has never fired.
           *
           * Left in place rather than deleted because it costs nothing and would start working if
           * Frontier ever adds the field. Documented because two other reads of never-written fields
           * turned out to be real bugs — `WasDiscovered` on `FSDJump` and the missing `Log` scan type
           * — and the next reader needs to know this one is *known* dead rather than assumed live.
           *
           * The line above carries the feature on its own, and correctly: of 253 planet bodies this
           * commander has disembarked on, 87 had a scan saying not-footfalled, which is exactly the
           * 87 in `firstFootfallBodies`. Of the remainder, 158 were landed on before `WasFootfalled`
           * existed in the journal at all (first seen 2025-09-29), so they are unknowable rather than
           * missed.
           */
          const journalFirstFootfall = line.firstfootfall === true || line.FirstFootfall === true;
          if (detailedSaidUnfootfalled || journalFirstFootfall) {
            this.firstFootfallBodies.add(bk);
          }
          // Read the eligibility above *before* recording this: standing on the body makes it
          // footfalled from now on, and folding that in first would erase the `false` this
          // commander's own ×5 bonus depends on.
          this.observeFootfall(bk, true, "journal", (line.timestamp as string) ?? new Date().toISOString());
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
    for (const [k, rec] of [...this.explorationScans.entries()]) {
      if (k.startsWith(prefix)) {
        // The value is sold; the physics is not. See soldExplorationScans.
        this.soldExplorationScans.set(k, rec);
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
      soldExplorationScans: [...this.soldExplorationScans.entries()],
      fssBodySignalsBodyKeys: [...this.fssBodySignalsBodyKeys],
      dssMappedBodyKeys: [...this.dssMappedBodyKeys],
      dssFirstMapperEligibleByBodyKey: [...this.dssFirstMapperEligibleByBodyKey.entries()],
      dssMappingEfficientByBodyKey: [...this.dssMappingEfficientByBodyKey.entries()],
      orbitParentPlanetByBody: [...this.orbitParentPlanetByBody.entries()],
      lastEventIso: this.lastEventIso,
      footJournalContextBuffer: this.footJournalContextBuffer.slice(),
      organicAnalyseByKey: [...this.organicAnalyseByKey.entries()],
      bodyDetailedFootfallState: [...this.bodyDetailedFootfallState.entries()],
      commanderPos: this.commanderPos,
      bodyFootfallFlag: [...this.bodyFootfallFlag.entries()],
      bodyMappedFlag: [...this.bodyMappedFlag.entries()],
      firstFootfallBodies: [...this.firstFootfallBodies],
      codexLoggedSpecies: [...this.codexLoggedSpecies],
      landingMinutesSamples: [...this.landingMinutesSamples],
      samplingMinutesSamples: [...this.samplingMinutesSamples],
      pendingOrganicSales: this.pendingOrganicSales.map((p) => ({ ...p })),
      fssAllBodiesCompleteSystems: [...this.fssAllBodiesCompleteSystems],
      fssDiscoveryScanBySystem: [...this.fssDiscoveryScanBySystem.entries()],
      fssAllBodiesFoundCountBySystem: [...this.fssAllBodiesFoundCountBySystem.entries()],
      mainStarWasDiscoveredBySystem: [...this.mainStarWasDiscoveredBySystem.entries()],
      systemPositions: [...this.systemPositions.entries()],
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
  hydrateJournalMergePayload(data: JournalMergeCachePayload): boolean {
    /**
     * **Returns whether it restored anything**, and the return value is not decoration.
     *
     * This used to return `void` and bail silently on a payload it did not recognise, leaving the
     * store exactly as empty as it started. The caller could not tell that apart from a cache that
     * legitimately held nothing, so it went on to apply the new journal lines and *save* — writing an
     * empty history, with a complete file manifest, over a good cache. That is how the owner's
     * 7.8 MB cache became 538 bytes at 11:18 on 2026-09-07, taking the whole system view and the
     * accuracy probe's ground truth with it.
     *
     * A false here means "treat this as a cache miss and replay the logs".
     */
    // Exactly the current format, nothing else. This was an explicit allowlist (`!== 1 && !== 2`),
    // a third place the version had to be remembered: bumping the constant without editing it here
    // turns every cache into a permanent miss and replays 245 logs on every launch.
    if (data.format !== JOURNAL_MERGE_CACHE_FORMAT) return false;
    if (
      !Array.isArray(data.bodies) ||
      !Array.isArray(data.explorationScans) ||
      !Array.isArray(data.visitedSystems)
    ) {
      return false;
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
    for (const [k, v] of data.soldExplorationScans ?? []) this.soldExplorationScans.set(k, v);
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
    this.commanderPos = data.commanderPos ?? null;
    for (const [k, v] of data.bodyFootfallFlag ?? []) this.bodyFootfallFlag.set(k, v);
    for (const [k, v] of data.bodyMappedFlag ?? []) this.bodyMappedFlag.set(k, v);
    for (const k of data.firstFootfallBodies) this.firstFootfallBodies.add(k);
    for (const k of data.codexLoggedSpecies ?? []) this.codexLoggedSpecies.add(k);
    this.landingMinutesSamples.push(...(data.landingMinutesSamples ?? []));
    this.samplingMinutesSamples.push(...(data.samplingMinutesSamples ?? []));
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
    // No version branch here on purpose: the loader admits a payload only when its `format` equals
    // JOURNAL_MERGE_CACHE_FORMAT exactly, so anything reaching this point is current. A `>= n` test
    // reads as though older caches still flow through and quietly excuses a missing field — which is
    // how `mainStarWasDiscoveredBySystem` shipped restoring nothing. Trust the per-value type checks.
    this.systemPositions.clear();
    for (const [a, p] of data.systemPositions ?? []) {
      if (typeof a === "number" && p && typeof p.x === "number") this.systemPositions.set(a, p);
    }
    this.mainStarWasDiscoveredBySystem.clear();
    for (const [a, w] of data.mainStarWasDiscoveredBySystem ?? []) {
      if (typeof a === "number" && typeof w === "boolean") this.mainStarWasDiscoveredBySystem.set(a, w);
    }
    const rj = data.remainingJumpsInRoute;
    this.remainingJumpsInRoute =
      typeof rj === "number" && Number.isFinite(rj) ? Math.max(0, Math.floor(rj)) : null;
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
    return true;
  }
}
