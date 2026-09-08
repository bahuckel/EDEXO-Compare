/**
 * What is still worth flying to, in systems this commander found first.
 *
 * A first discovery pays a cartographic bonus and nothing else; the prize this list is about is
 * **first footfall**, which multiplies organic payouts by five and belongs to whoever steps on the
 * body first. The two coincide usefully: a system whose main star nobody had scanned when the
 * commander arrived is a system whose landable bodies were, at that moment, unwalked.
 *
 * So a row here means: you found this system, the game says there is biology on this body, you
 * never scanned or walked it, and nothing in the journal has since said anyone else did.
 *
 * Measured over the owner's 245 journals: 293 bodies across 143 systems, a 4.6 bn CR floor at 5x.
 * `scripts/first-discovery-probe.ts` prints the same numbers straight from the merge cache and is
 * the reference this module is checked against.
 *
 * **Why this is not part of the snapshot.** Matching one body costs ~53 ms, so the set costs ~15 s.
 * `buildSnapshot` runs on every journal line; putting this inside it would stall the app on each
 * one. It is computed on demand behind an endpoint and memoised until the store changes.
 */
import type {
  BodyExoState,
  ExplorationScanRecord,
  FirstDiscoveryBacklogDTO,
  FirstDiscoveryBacklogRowDTO,
  SpeciesMatchContext,
} from "../shared/types.js";
import type { GameStateStore } from "./gameState.js";
import { matchDatabaseToScan, shownSpeciesMatches } from "./matchSpecies.js";
import { computeExoPayoutRangeFromMatches, resolveOrganicSlotCount } from "./exoPayoutRange.js";
import { getCachedPriceIndex, getCachedSpeciesDatabase } from "./snapshot.js";
import { resolveHostStarBodyId } from "./orbitUtils.js";
import { perfTime } from "./perf.js";

/**
 * Is the 5x still there, as far as anything has ever told us?
 *
 * `bodyFootfallFlag` is an ObservedFlag, so it has three states and only one of them disqualifies a
 * body. `true` means someone has walked it and the bonus is gone. `false` means nobody had, *as of*
 * whenever that was seen. `null` means nothing has ever reported either way — the normal case for a
 * body seen only through an FSS honk, and emphatically not the same as "walked".
 *
 * Treating null as disqualifying would empty the list; treating true as unknown would send the
 * commander across the galaxy for a bonus somebody already took. Only `true` excludes.
 */
function footfallLost(store: GameStateStore, key: string): boolean {
  if (store.bodyFootfallFlag.get(key)?.value === true) return true;
  return store.bodyDetailedFootfallState.get(key) === true;
}

function matchContextFor(
  b: BodyExoState,
  scansBySystem: Map<number, Map<number, ExplorationScanRecord>>,
): SpeciesMatchContext | undefined {
  const byId = scansBySystem.get(b.systemAddress);
  const rec = byId?.get(b.bodyId);
  if (!byId || !rec) return undefined;
  const ctx: SpeciesMatchContext = {};
  const starId = resolveHostStarBodyId(rec, byId);
  const star = starId == null ? null : byId.get(starId);
  if (star?.starType?.trim()) {
    ctx.parentStarType = star.starType;
    if (typeof star.subclass === "number" && Number.isFinite(star.subclass))
      ctx.parentStarSubclass = star.subclass;
    if (star.luminosity?.trim()) ctx.parentStarLuminosity = star.luminosity;
  }
  return Object.keys(ctx).length ? ctx : undefined;
}

/**
 * Every body whose system this commander discovered, that still has unclaimed biology.
 *
 * Sold systems stay in. A cartographic sale moves the physics to `soldExplorationScans` and never
 * touches `bodies`, so the signal count and the genus list survive it. Selling the *data* is not
 * the same as having collected the plants, and a system cashed in at a station is still full of
 * biology nobody has sampled. See tests/sellKeepsBiology.test.ts.
 */
function candidates(store: GameStateStore): BodyExoState[] {
  const out: BodyExoState[] = [];
  for (const b of store.bodies.values()) {
    if (store.mainStarWasDiscoveredBySystem.get(b.systemAddress) !== false) continue;
    if (!b.biologicalSignals || b.biologicalSignals <= 0) continue;
    // An organic lock means a ScanOrganic named something here — the body has been worked. Locks
    // survive SellOrganicData on purpose, so cashing in does not re-offer a stripped body.
    if (b.organicGenusLocks.length > 0) continue;
    if (footfallLost(store, b.key)) continue;
    // `Landable`, capitalised: PlanetScan mirrors the journal's field names and carries an index
    // signature, so a lower-case guess type-checks and silently reads undefined.
    if (b.scan?.Landable !== true) continue;
    out.push(b);
  }
  return out;
}

export function computeFirstDiscoveryBacklog(store: GameStateStore): FirstDiscoveryBacklogDTO {
  const db = getCachedSpeciesDatabase();
  const prices = getCachedPriceIndex();

  const scansBySystem = new Map<number, Map<number, ExplorationScanRecord>>();
  for (const [, r] of [...store.soldExplorationScans, ...store.explorationScans]) {
    const byId = scansBySystem.get(r.systemAddress) ?? new Map<number, ExplorationScanRecord>();
    byId.set(r.bodyId, r);
    scansBySystem.set(r.systemAddress, byId);
  }

  const rows: FirstDiscoveryBacklogRowDTO[] = [];
  for (const b of candidates(store)) {
    if (!b.scan) continue;
    const run = matchDatabaseToScan(db, b.scan, b.genusHints, b.organicGenusLocks, {
      includeBacterium: true,
      matchContext: matchContextFor(b, scansBySystem) ?? null,
      biologicalSignals: b.biologicalSignals,
    });
    const { count: slots, source } = resolveOrganicSlotCount(b);
    if (slots <= 0 || source === "none") continue;

    const seen = store.bodyDetailedFootfallState.get(b.key);
    const range = computeExoPayoutRangeFromMatches(
      shownSpeciesMatches(run.matches),
      prices,
      slots,
      source,
      5,
      seen ?? null,
      true,
      store.bodyFootfallFlag.get(b.key),
      store.bodyMappedFlag.get(b.key),
    );
    if (!range) continue;

    rows.push({
      bodyKey: b.key,
      systemAddress: b.systemAddress,
      starSystem: b.starSystem,
      bodyName: b.bodyName,
      biologicalSignals: b.biologicalSignals ?? 0,
      minCr: range.minCr,
      maxCr: range.maxCr,
      candidateCount: range.pricedCandidateCount,
      genusKnown: (b.genusHints?.length ?? 0) > 0,
      dssComplete: b.dssComplete,
    });
  }

  // Floor first: the guaranteed number is the one a route should be planned on, and sorting by the
  // ceiling would put a body with one wild outlier candidate above a body that always pays well.
  rows.sort((a, b) => b.minCr - a.minCr || b.maxCr - a.maxCr || a.bodyKey.localeCompare(b.bodyKey));

  return {
    rows,
    systemCount: new Set(rows.map((r) => r.systemAddress)).size,
    totalMinCr: rows.reduce((a, r) => a + r.minCr, 0),
    totalMaxCr: rows.reduce((a, r) => a + r.maxCr, 0),
    computedAt: new Date().toISOString(),
  };
}

/**
 * Memoised across requests, because 15 s is far too long to spend on a panel the commander may
 * simply be re-opening.
 *
 * The key is the store's own change counters rather than a timer: the exploration revision moves
 * when a scan or a sale lands, and the body count moves when a new one is seen. A journal line that
 * changes none of them cannot change this list, so the cached answer is still correct.
 */
let cache: { key: string; value: FirstDiscoveryBacklogDTO } | null = null;

export function firstDiscoveryBacklog(store: GameStateStore): FirstDiscoveryBacklogDTO {
  const key = [
    store.bodies.size,
    store.explorationScansRevision,
    store.mainStarWasDiscoveredBySystem.size,
    store.firstFootfallBodies.size,
    store.lastEventIso ?? "",
  ].join("|");
  if (cache && cache.key === key) return cache.value;
  const value = perfTime("backlog.firstDiscovery", () => computeFirstDiscoveryBacklog(store));
  cache = { key, value };
  return value;
}

/** Test seam — the module-level memo would otherwise leak between cases. */
export function clearFirstDiscoveryBacklogCache(): void {
  cache = null;
}
