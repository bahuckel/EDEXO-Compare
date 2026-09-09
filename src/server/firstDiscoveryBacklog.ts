/**
 * What is still worth flying to: biology found and never collected, with the 5x unclaimed.
 *
 * The prize is **first footfall**, which multiplies organic payouts by five and belongs to whoever
 * steps on the body first. A row here means the game says there is biology on this landable body,
 * the commander never scanned or walked it, and nothing in the journal says anyone else did.
 *
 * This began as first-discovery systems only, on the reasoning that a system nobody had scanned on
 * arrival had bodies nobody had walked. True, but far too narrow: footfall is claimed per *body*,
 * and 538 of this commander's 831 qualifying bodies sit in systems already carrying someone else's
 * name. Gating on the system hid two thirds of the backlog.
 *
 * So both facts ride on every row instead of deciding membership:
 *
 *   - `firstDiscovery` — this commander scanned the main star before anyone. 293 bodies.
 *   - `footfallObserved` — the journal has actually reported this body unwalked, rather than simply
 *     never mentioning it. 608 of 831. The remaining 223 are unknowable rather than unclaimed, since
 *     `WasFootfalled` did not exist before 2025-09-29.
 *
 * The distinction matters because the panel cannot afford to promise a 5x it has no evidence for:
 * the commander finds out after flying there.
 *
 * `scripts/first-discovery-probe.ts` derives the first-discovery subset straight from the merge
 * cache and is the reference this module is checked against.
 *
 * **Why this is not part of the snapshot.** Matching one body costs ~53 ms, so the set costs ~45 s.
 * `buildSnapshot` runs on every journal line; putting this inside it would stall the app on each
 * one. It is computed on demand behind an endpoint and memoised until the store changes.
 */
import type {
  BodyExoState,
  ExplorationScanRecord,
  BacklogMapDTO,
  BacklogSystemDTO,
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

/**
 * Has anything ever actually reported that this body was unwalked?
 *
 * `WasFootfalled` did not exist in the journal until 2025-09-29, so for anything scanned before then
 * the field is not false, it is absent — and absent is not evidence. 203 of the 538 bodies outside
 * this commander's own discoveries are in exactly that state: plausibly untouched, but nothing has
 * ever said so.
 *
 * Both kinds are worth showing, because a body nobody has reported on is still probably unclaimed
 * out in the black. They must not look the same, though: a row that promises a 5x on no evidence
 * is the one failure this panel cannot afford, since the commander only finds out after the trip.
 */
function footfallObserved(store: GameStateStore, key: string): boolean {
  return store.bodyFootfallFlag.get(key)?.value === false || store.bodyDetailedFootfallState.get(key) === false;
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
 * Every body that still has unclaimed biology and an unclaimed first footfall.
 *
 * First discovery is **not** a gate here, though it was at first. The 5x belongs to whoever steps on
 * a *body* first, and that is decided body by body: 538 qualifying bodies sit in systems somebody
 * else's name is on, and excluding them hid two thirds of the commander's own backlog. It is carried
 * as a label instead, because it is still the strongest evidence available — see `firstDiscovery`
 * and `footfallObserved` on the row.
 *
 * Sold systems stay in. A cartographic sale moves the physics to `soldExplorationScans` and never
 * touches `bodies`, so the signal count and the genus list survive it. Selling the *data* is not
 * the same as having collected the plants, and a system cashed in at a station is still full of
 * biology nobody has sampled. See tests/sellKeepsBiology.test.ts.
 */
function candidates(store: GameStateStore): BodyExoState[] {
  const out: BodyExoState[] = [];
  for (const b of store.bodies.values()) {
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
      firstDiscovery: store.mainStarWasDiscoveredBySystem.get(b.systemAddress) === false,
      footfallObserved: footfallObserved(store, b.key),
    });
  }

  // Floor first: the guaranteed number is the one a route should be planned on, and sorting by the
  // ceiling would put a body with one wild outlier candidate above a body that always pays well.
  rows.sort((a, b) => b.minCr - a.minCr || b.maxCr - a.maxCr || a.bodyKey.localeCompare(b.bodyKey));

  return {
    rows,
    systemCount: new Set(rows.map((r) => r.systemAddress)).size,
    firstDiscoveryCount: rows.filter((r) => r.firstDiscovery).length,
    footfallObservedCount: rows.filter((r) => r.footfallObserved).length,
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

/**
 * The same backlog, rolled up to systems and placed in the galaxy.
 *
 * The map plots places, so a system holding four unfinished bodies is one dot carrying their summed
 * floor — that sum is what the minimum-value filter tests, because "is this system worth a detour"
 * is the question a route is planned on, not "is this body".
 *
 * A system with no `StarPos` in the journals cannot be placed and is counted rather than dropped
 * silently. Placing it at the origin would put a false marker on Sol; omitting it without saying so
 * would quietly shrink the backlog every time the map is consulted.
 */
export function backlogMap(store: GameStateStore): BacklogMapDTO {
  const rows = firstDiscoveryBacklog(store).rows;
  const bySystem = new Map<number, BacklogSystemDTO>();
  // A set, not a counter: an unplaceable system never reaches `bySystem`, so testing that map to
  // dedupe counted every *body* instead of every system and reported three where one was meant.
  const unplaceable = new Set<number>();

  for (const r of rows) {
    const pos = store.systemPositions.get(r.systemAddress);
    if (!pos) {
      unplaceable.add(r.systemAddress);
      continue;
    }
    const cur = bySystem.get(r.systemAddress);
    if (cur) {
      cur.bodies += 1;
      cur.floorCr += r.minCr;
      cur.ceilingCr += r.maxCr;
      cur.allVerified &&= r.footfallObserved;
    } else {
      bySystem.set(r.systemAddress, {
        systemAddress: r.systemAddress,
        starSystem: r.starSystem,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        bodies: 1,
        floorCr: r.minCr,
        ceilingCr: r.maxCr,
        firstDiscovery: r.firstDiscovery,
        allVerified: r.footfallObserved,
      });
    }
  }

  return {
    systems: [...bySystem.values()].sort((a, b) => b.floorCr - a.floorCr),
    unplaceable: unplaceable.size,
  };
}
