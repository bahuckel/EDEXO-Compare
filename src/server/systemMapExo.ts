/**
 * The system map's exobiology: which bodies carry exo markers, one memoised matcher run per bio body, and the value tier and payout range read from it. Split out of systemMap.ts (code review D, 2026-09-27).
 */
import type { SpatialCatalogue } from "../shared/spatialGates.js";
import type {
  BodyExoState,
  ExoPayoutRangeDTO,
  ExplorationScanRecord,
  PlanetScan,
  SpeciesDatabase,
  SpeciesMatch,
} from "../shared/types.js";
import { computeExoPayoutRangeFromMatches, resolveOrganicSlotCount } from "./exoPayoutRange.js";
import type { GameStateStore } from "./gameState.js";
import { matchCacheEpoch } from "./matchCacheEpoch.js";
import { shownSpeciesMatches } from "./matchSpecies.js";
import { runCandidatePipeline } from "./candidatePipeline.js";
import { getProjectRoot } from "./paths.js";
import { PriceIndex, lookupPriceStrict } from "./priceList.js";
import { bodyKey } from "../shared/bodyKey.js";

/**
 * Is there anything to say about biology on this body?
 *
 * Four of these are evidence that life *is* there. The fifth is different and was missing: a
 * landable body whose conditions are known at all. Flying to a body writes a complete `AutoScan`
 * and no signal count — the count only arrives from an FSS or a DSS — so a commander who flew out
 * saw nothing at all, reported on Blu Thua VH-G b38-1 1 where the journal has no `FSSBodySignals`
 * anywhere and the first count came at DSS two minutes later.
 *
 * Predicting from conditions alone is a weaker claim than a signal count and must be shown as one:
 * "these species could live here", not "these species are here". But it is the claim the app exists
 * to make, and withholding it until the commander has already probed the body answers the question
 * after it stopped mattering.
 */
/**
 * *Why* this body is showing candidates — which is not the same as whether it should.
 *
 * `conditions` is the weak case and the one that needs saying out loud. An auto scan describes the
 * body completely and reports no organics at all: the game shows a signal count on screen, the
 * journal never writes one, and only an FSS or a DSS puts it in a file. So the app can say what the
 * conditions suit and cannot say whether anything is there, and a commander reading a candidate list
 * has no way to tell those apart unless it is on the page.
 */
export type ExoMarkerBasis = "scanned" | "genus" | "signals" | "conditions" | "none";

export function exoMarkerBasis(b: BodyExoState): ExoMarkerBasis {
  if (b.organicGenusLocks.length > 0 || b.confirmedVariants.length > 0) return "scanned";
  if (b.genusHints && b.genusHints.length) return "genus";
  if (b.biologicalSignals !== null && b.biologicalSignals > 0) return "signals";
  if (b.scan?.Landable === true && typeof b.scan.PlanetClass === "string" && b.scan.PlanetClass.trim()) {
    return "conditions";
  }
  return "none";
}

/**
 * Does the **journal** say there is life here — as opposed to "could there be".
 *
 * The map's bio filter, its bio-body count and the glow on a node all answer the first question, and
 * they went wrong the moment {@link bodyHasExoMarkers} learned to include auto-scanned bodies: on
 * Blu Thua ML-P b47-2 every landable rock in the system came back `hasExobiology`, so the mark that
 * used to pick out the nine bodies carrying signals picked out nineteen and meant nothing. Candidate
 * lists still want the wide test — saying what the conditions suit is the whole point of it — but a
 * map legend that reads "biological signals" must only ever mark bodies that have them.
 */
export function bodyHasJournalExoEvidence(b: BodyExoState): boolean {
  return exoMarkerBasis(b) !== "conditions" && exoMarkerBasis(b) !== "none";
}

export function bodyHasExoMarkers(b: BodyExoState): boolean {
  const hasBioCount = b.biologicalSignals !== null && b.biologicalSignals > 0;
  const hasHints = !!(b.genusHints && b.genusHints.length);
  const confirmed = b.confirmedVariants.length > 0;
  const organicLocks = b.organicGenusLocks.length > 0;
  // Landable and described: enough to say what could grow, never enough to say what does.
  const predictable =
    b.scan?.Landable === true && typeof b.scan.PlanetClass === "string" && b.scan.PlanetClass.trim() !== "";
  return hasBioCount || hasHints || confirmed || organicLocks || predictable;
}

/**
 * Everything the map needs to know about what could grow on one body, worked out once.
 *
 * The value tier, the payout range and the candidate list are three questions with one answer, and
 * they used to ask it separately: three `matchDatabaseToScan` calls per body over identical inputs,
 * each rebuilding the same match context and walking the same 108 species. On a 27-body system that
 * is 81 runs of the matcher to produce 27 results.
 *
 * Computed in the caller's loop and handed down. Null means the body has nothing to say — no exo
 * markers, or no scan that names a planet class — which all three consumers used to decide for
 * themselves, in the same words.
 */
interface ExoMatchRun {
  exo: BodyExoState;
  scan: PlanetScan;
  /**
   * The matcher's own rows, which are not yet `SpeciesMatch`.
   *
   * Photos, notes and prices are attached later by the snapshot path; the map wants names and ids
   * and never looks at those, so this takes the matcher's output as it comes rather than paying to
   * decorate 108 rows per body for three fields nobody here reads.
   */
  matches: MatcherRow[];
  /** `shownSpeciesMatches(matches)`, since all three consumers want the shown tier and not the rest. */
  shown: MatcherRow[];
  approximateMatchingUsed: boolean;
}

type MatcherRow = Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">;

/*
  The map is rebuilt on every snapshot — ten a second while scanning — and re-ran the whole matcher
  for every bio body each time: 46 % of a live refresh on the owner's history (code review §E,
  2026-09-27). Memoised on everything the run reads, so a hit returns exactly what a run would.
*/
// Per store, like every memo here: two stores (tests, lookups) are two histories.
const exoMatchMemos = new WeakMap<GameStateStore, Map<string, { sig: string; run: ExoMatchRun | null }>>();
const dbIds = new WeakMap<SpeciesDatabase, number>();
let nextDbId = 1;

function exoMatchSignature(
  store: GameStateStore,
  db: SpeciesDatabase,
  r: ExplorationScanRecord,
  exo: BodyExoState | undefined,
  spatialCatalogue: SpatialCatalogue | null,
): string {
  let dbId = dbIds.get(db);
  if (dbId === undefined) {
    dbId = nextDbId++;
    dbIds.set(db, dbId);
  }
  const addr = r.systemAddress;
  const current = addr === store.currentSystemAddress ? JSON.stringify(store.commanderPos ?? null) : "-";
  return [
    matchCacheEpoch(),
    dbId,
    spatialCatalogue ? 1 : 0,
    store.explorationScansRevision,
    store.remoteSystems.get(addr)?.fetchedAt ?? "",
    store.includeBacteriumInSearch ? 1 : 0,
    JSON.stringify(store.systemPositions.get(addr) ?? null),
    current,
    store.fssAllBodiesCompleteSystems.has(addr) ? 1 : 0,
    JSON.stringify(exo ?? null),
  ].join("|");
}

export function exoMatchRun(
  store: GameStateStore,
  db: SpeciesDatabase,
  r: ExplorationScanRecord,
  spatialCatalogue: SpatialCatalogue | null,
): ExoMatchRun | null {
  const key = bodyKey(r.systemAddress, r.bodyId);
  const exo = store.bioBodyState(key);
  const sig = exoMatchSignature(store, db, r, exo, spatialCatalogue);
  let memo = exoMatchMemos.get(store);
  if (!memo) exoMatchMemos.set(store, (memo = new Map()));
  const hit = memo.get(key);
  if (hit && hit.sig === sig) return hit.run;
  const run = exoMatchRunUncached(store, db, r, exo, spatialCatalogue);
  if (memo.size > 2_000) memo.clear();
  memo.set(key, { sig, run });
  return run;
}

function exoMatchRunUncached(
  store: GameStateStore,
  db: SpeciesDatabase,
  r: ExplorationScanRecord,
  exo: BodyExoState | undefined,
  spatialCatalogue: SpatialCatalogue | null,
): ExoMatchRun | null {
  if (!exo || !bodyHasExoMarkers(exo)) return null;
  /*
    The body tab's chain (code review 2026-10-10, B18; owner, 2026-10-07: "same step everywhere"): the
    map ran the matcher and the genus veto only, with no ranking and no 1 % floors, so it listed rows
    the tab hid and coloured bodies by candidates the tab did not offer.
  */
  const pipe = runCandidatePipeline(exo, store, db, getProjectRoot(), {
    includeBacterium: store.includeBacteriumInSearch,
    spatialCatalogue,
  });
  if (!pipe) return null;
  return {
    exo,
    scan: pipe.inputs.scan,
    matches: pipe.matches,
    shown: shownSpeciesMatches(pipe.matches),
    approximateMatchingUsed: pipe.run.approximateMatchingUsed,
  };
}

/**
 * `displayMax`: best single-species payout heuristic for map tiers (list × 5 only when this commander has
 * first-footfall on the body, else × 1 — same rule as pending organic valuation).
 * `tierValue`: conservative basis for `+` / `++` when matching is approximate-only (minimum among tied ×vals).
 */
export function maxExoHeuristicPair(
  store: GameStateStore,
  prices: PriceIndex,
  r: ExplorationScanRecord,
  run: ExoMatchRun | null,
): { displayMax: number; tierValue: number } {
  if (!run) return { displayMax: 0, tierValue: 0 };
  const bk = bodyKey(r.systemAddress, r.bodyId);
  const mult: 1 | 5 = store.firstFootfallBodies.has(bk) ? 5 : 1;
  const vals: number[] = [];
  // Value tiers colour the map. A demoted candidate must not make a body look rich.
  for (const m of run.shown) {
    const p = lookupPriceStrict(prices, m.entry.displayName, m.entry.id);
    if (p != null) vals.push(p * mult);
  }
  if (vals.length === 0) return { displayMax: 0, tierValue: 0 };
  const displayMax = Math.max(...vals);
  const tierValue = run.approximateMatchingUsed ? Math.min(...vals) : displayMax;
  return { displayMax, tierValue };
}

export function buildExoPayoutRangeForRecord(
  store: GameStateStore,
  prices: PriceIndex,
  r: ExplorationScanRecord,
  run: ExoMatchRun | null,
): ExoPayoutRangeDTO | null {
  if (!run) return null;
  const bk = bodyKey(r.systemAddress, r.bodyId);
  const { count: slots, source: slotSource } = resolveOrganicSlotCount(run.exo);
  if (slots <= 0 || slotSource === "none") return null;
  const mult: 1 | 5 = store.firstFootfallBodies.has(bk) ? 5 : 1;
  const wf = store.bodyDetailedFootfallState.get(bk);
  const journalWasFootfalled = wf === undefined ? null : wf === true;
  const range = computeExoPayoutRangeFromMatches(
    run.shown,
    prices,
    slots,
    slotSource,
    mult,
    journalWasFootfalled,
    mult === 5,
  );
  const kind = store.noFirstFootfallInSystem(r.systemAddress) ? store.systemKind(r.systemAddress) : null;
  if (range && kind && kind !== "empty") range.noFootfallSystemKind = kind;
  return range;
}

export function scanForMatch(
  store: GameStateStore,
  r: ExplorationScanRecord,
  exo: BodyExoState | undefined,
): PlanetScan | null {
  if (exo?.scan) return exo.scan;
  if (!r.planetClass && !r.atmosphereType && !r.atmosphere) return null;
  return {
    BodyName: r.bodyName,
    BodyID: r.bodyId,
    StarSystem: r.starSystem,
    SystemAddress: r.systemAddress,
    PlanetClass: r.planetClass,
    Atmosphere: r.atmosphere,
    AtmosphereType: r.atmosphereType,
    SurfaceGravity: r.surfaceGravity,
    SurfaceTemperature: r.surfaceTemperature,
    SurfacePressure: r.surfacePressure,
    SemiMajorAxis: r.semiMajorAxis,
    TidalLock: r.tidalLock,
    Volcanism: r.volcanism,
    Landable: r.landable,
    TerraformState: r.terraformState,
  };
}

export function exoMatchSummaries(run: ExoMatchRun | null): { displayName: string; id: string }[] {
  if (!run) return [];
  return run.shown.slice(0, 48).map((m) => ({ displayName: m.entry.displayName, id: m.entry.id }));
}
