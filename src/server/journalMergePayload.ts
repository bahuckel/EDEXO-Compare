/**
 * The journal merge cache's shape and format history: what GameStateStore serialises and restores. Split out of gameState.ts (code review D, 2026-09-27).
 */
import type { ObservedFlag } from "../shared/observedFlag.js";
import type { BodyExoState, ExplorationScanRecord, JournalLine, SystemLife } from "../shared/types.js";
import type { SurfaceMark } from "./surfaceMarksFile.js";

export type PendingOrganicSample = {
  fullKey: string;
  bodyKey: string;
  speciesKey: string;
  label: string;
};

export type OrganicAnalyseProgress = { count: number; label: string };

/** Credits a system has actually paid out, and how many things were sold to get them. */
export type SoldTally = { credits: number; items: number; sales: number; lastAt: string };

/**
 * Increment when journal-derived snapshot shape changes — invalidates on-disk merge cache.
 *
 * "Shape" includes *adding* a field, not only changing one. Every field here is optional on decode,
 * so a stale cache does not fail: it restores the old shape, the new field comes back empty, and the
 * feature that reads it stays dark with nothing logged anywhere.
 *
 * 13 — `systemLife`: bodies in a system with signs of life (population, security or government, a
 *     controlling faction) or on the developer-populated list count as footfalled (no ×5), unless
 *     this commander discovered the system. An old cache has the scans' `WasFootfalled: false` for
 *     them and would keep promising the bonus.
 * 12 — organic locks carry `at`, the time of the latest scan of that species on that body, for the
 *     glance bar's "last three scanned". An 11 cache has none, and would order every body by DSS.
 * 11 — `organicGenusLocks` holds one lock per species per body (a foot scan updates it rather than
 *     pushing a copy per `ScanOrganic`, and replaces a comp-scan or sibling lock for the same
 *     species), with `samples` / `analysed` for the genus progress card and `fromSibling` on locks
 *     copied from a neighbouring moon. An old cache holds four copies per sampled species and no
 *     progress at all.
 * 10 — `organicGenusLocks` now also carries locks built from `CodexEntry`, so a species the
 *     composition scanner named on a body counts as confirmed there (`source: "codex"`). A cache
 *     written by the old code holds foot scans only, and no replay would add the rest.
 * 9 — no new field. `mainStarWasDiscoveredBySystem` is now derived from the **arrival star**
 *     (`DistanceFromArrivalLS === 0`) rather than from `BodyID 0`, which does not exist in every
 *     system: `Pru Aihm BL-U b33-2` starts at body 2 and the owner's own discovery was missing from
 *     the first-discovery filter because of it. The map's shape is unchanged and its contents are
 *     not, which is exactly the case note 5 below is about.
 * 6 — `soldExplorationBySystem` and `soldOrganicBySystem`, so "my discoveries" can rank a system by
 *     what it actually paid instead of by an estimate of what it might.
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
/*
  Bumped to 6 for `surfaceShipMark` / `overlayTouchdownBodyKey`, and to 7 when that mark grew a
  `bodyNameNorm` — the field the radar matches against. Worth noting how *that* one got through:
  the format had already moved, and the guard test snapshots the payload's **keys**, not the shape
  of what is inside them. A cache written minutes earlier was still admitted and restored a ship
  with no body name, which silently stopped matching the surface it was parked on.

  So: a change to a field's *contents* needs the bump as much as a new field does.

  A cache is a replay's *result*, not the journal, so a field added to the store is simply absent
  from every cache already on disk — and the next start restores a store with a hole in it rather
  than replaying the lines that would fill it. That is how the minimap came up with no ship on a
  body the commander was standing on: the Touchdown was inside the cached span.

  Anything derived from the journal that the UI reads has to be either in this payload or
  deliberately transient. Bump the format when you add one.

  15: bio bodies kept a "Body 2" placeholder name from ScanOrganic/CodexEntry over the Scan's real
  name; caches written before the fix carry those names.
  16: `codexRegionLogged` — the [CODEX] tag's per-region, per-colour codex record.
  17: `commanderFid` — tells the commander's own shared-exomastery backups from other people's.
  18: sibling moons no longer inherit logged variants (their colours were read as their own).
  19: star `absoluteMagnitude` (the colour rule's luminosity for catalogue stars).
  20: `codexMapLogged` — every codex entry, any category, per region (the Codex map).
  21: `codexSightings` — biological codex entries with system and time (dynamic species rarity).
  22: `achievementDone` — plants that count for achievements, per region.
  23: scan `rings` + `ageMy`, `greenCodexBodies`, `k10Systems` — green gas giants and the body features.
  24: `nspSeen` — notable stellar phenomena met per system (FSS signal, codex name).
*/
export const JOURNAL_MERGE_CACHE_FORMAT = 24;

/** Serializable journal-derived slice of {@link GameStateStore} (not user prefs). */
export type JournalMergeCachePayload = {
  format: number;
  commanderName: string | null;
  /** Frontier's commander id — tells your own shared-exomastery backups from other commanders'. */
  commanderFid?: string | null;
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
  /** Bodies whose data has been sold — see {@link GameStateStore.soldBodyKeys}. */
  soldBodyKeys?: string[];
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
  /** [CODEX] keys, see {@link GameStateStore.codexRegionLogged}. */
  codexRegionLogged?: string[];
  /** Codex map keys, see {@link GameStateStore.codexMapLogged}. */
  codexMapLogged?: string[];
  /** Codex sightings, see {@link GameStateStore.codexSightings}. */
  codexSightings?: [string, string][];
  /** Achievement completions, see {@link GameStateStore.achievementDone}. */
  achievementDone?: [string, string][];
  /** Green codex bodies, see {@link GameStateStore.greenCodexBodies}. */
  greenCodexBodies?: [string, string][];
  /** K10 anomaly systems, see {@link GameStateStore.k10Systems}. */
  k10Systems?: number[];
  /** Phenomena met, see {@link GameStateStore.nspSeen}. */
  nspSeen?: [number, string[]][];
  /** Minutes per approach-and-landing and per sampling run, for the triage screen's own timing (B5). */
  landingMinutesSamples?: number[];
  samplingMinutesSamples?: number[];
  pendingOrganicSales: PendingOrganicSample[];
  /** Present when {@link format} >= 6 — where the ship is parked, and on which body. */
  surfaceShipMark?: SurfaceMark | null;
  /** Present when {@link format} >= 6 — the body the ship last touched down on. */
  overlayTouchdownBodyKey?: string | null;
  /** The body the ship is at — see {@link GameStateStore.currentBodyKey}. */
  currentBodyKey?: string | null;
  fssAllBodiesCompleteSystems: number[];
  /** Present when {@link format} >= 13 — signs of life per system, from the arrival line. */
  systemLife?: [number, SystemLife][];
  fssDiscoveryScanBySystem: [number, { systemName: string; bodyCount: number; progress: number }][];
  /** Optional — `FSSAllBodiesFound.Count` per system. */
  fssAllBodiesFoundCountBySystem?: [number, number][];
  /** What selling actually paid, per system. See the maps of the same names. */
  soldExplorationBySystem?: [number, SoldTally][];
  soldOrganicBySystem?: [number, SoldTally][];
  /** Present when {@link format} >= 2. */
  mainStarWasDiscoveredBySystem?: [number, boolean][];
  /**
   * The evidence rank behind each entry above (0 arrival star, 1 BodyID 0). Without it a restored
   * cache forgot which answers were already taken, and a return visit's arrival Scan — which reports
   * the system as discovered, by him — overwrote his first discovery (code review A3, 2026-09-27).
   * Optional: a cache written before it restores every entry at rank 0, i.e. "first answer taken".
   */
  mainStarSourceRankBySystem?: [number, number][];
  systemPositions?: [number, { x: number; y: number; z: number }][];
  remainingJumpsInRoute?: number | null;
  loadoutMaxJumpRangeLy?: number | null;
  loadoutFuelMainCapacityT?: number | null;
  loadoutFuelReserveCapacityT?: number | null;
  lastFsdJumpFuelUsedT?: number | null;
  lastFsdJumpDistLy?: number | null;
};
