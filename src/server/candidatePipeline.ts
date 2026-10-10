/**
 * One body's candidates, the same way on every surface (code review 2026-10-10, B1/B3/B18).
 *
 * The body tab ran the full chain: the context built from the whole system, the matcher, then the
 * ranking, the genus split, the 1 % floors, the genus prior, the veto and the measured odds. The other
 * surfaces each kept a shorter copy: the first-discovery backlog built its own context with four
 * fields (no position, so the position rules could not fire; no companion bodies, so Crystalline
 * Shards were dropped from every row) and stopped after the veto, and the system map stopped there
 * too, so it listed rows the tab hid below the floors. A body now gets one answer wherever it is shown.
 *
 * The stages are separate because the body tab decorates the matcher's rows (photos, prices, the foot
 * catalog's additions) before ranking them; everything else runs them back to back.
 */
import type {
  BodyExoState,
  ExplorationScanRecord,
  JournalHostStarObservation,
  PlanetScan,
  SpeciesDatabase,
  SpeciesMatch,
  SpeciesMatchContext,
} from "../shared/types.js";
import type { GameStateStore } from "./gameState.js";
import { bodyKey } from "../shared/bodyKey.js";
import { mergeScanForExomastery } from "./footScannedCatalog.js";
import { buildSpeciesMatchContext } from "./speciesMatchContext.js";
import { journalHostObservationFromSpeciesContext } from "./journalHostObservation.js";
import { matchDatabaseToScan, type MatchDatabaseRun } from "./matchSpecies.js";
import { loadSpatialCatalogue } from "./spatialCatalogue.js";
import type { SpatialCatalogue } from "../shared/spatialGates.js";
import { attachPresenceProbability, demoteBelowPresenceFloor, markSampledDespiteUnlikely } from "./presenceFloors.js";
import { applyGenusBodySplit } from "./genusBodySplit.js";
import { applyGenusPrior, vetoUnseenGenera } from "./genusPrior.js";
import { applyMeasuredOdds } from "./measuredOdds.js";
import { orderConchaPair } from "./conchaOrder.js";
import { collectResolvedOrganicLockSpeciesIds } from "./organicLocks.js";

/** What the matcher and the passes after it read about the body. */
export interface CandidateInputs {
  /** The journal scan with the exploration record's physics filled in; null when neither names a class. */
  scan: PlanetScan | null;
  /** The physics record (sold or not), the ranking's second source. */
  rec: ExplorationScanRecord | null;
  ctx: SpeciesMatchContext;
  journalHost: JournalHostStarObservation | null;
}

export function candidateInputs(b: BodyExoState, store: GameStateStore): CandidateInputs {
  // Physics, not value: a sold system keeps its gravity, materials, composition and host star.
  const rec = store.physicsExplorationScan(bodyKey(b.systemAddress, b.bodyId));
  const ctx = buildSpeciesMatchContext(b, store);
  return {
    scan: mergeScanForExomastery(b.scan, rec),
    rec,
    ctx,
    journalHost: journalHostObservationFromSpeciesContext(ctx),
  };
}

export interface CandidateOptions {
  includeBacterium: boolean;
  /** The position rules' catalogue; loaded from the project when not given. */
  spatialCatalogue?: SpatialCatalogue | null;
}

/** The matcher with every option the body tab gives it. Needs `inputs.scan`. */
export function matchCandidates(
  b: BodyExoState,
  inputs: CandidateInputs & { scan: PlanetScan },
  db: SpeciesDatabase,
  root: string,
  opts: CandidateOptions,
): MatchDatabaseRun {
  return matchDatabaseToScan(db, inputs.scan, b.genusHints, b.organicGenusLocks, {
    includeBacterium: opts.includeBacterium,
    matchContext: inputs.ctx,
    spatialCatalogue: opts.spatialCatalogue === undefined ? loadSpatialCatalogue(root) : opts.spatialCatalogue,
    biologicalSignals: b.biologicalSignals,
    signalCountAssumed: b.autoScanOnly === true,
  });
}

/**
 * Everything after the matcher that decides which rows are shown and at what chance, in order.
 * Mutates `matches` (flags and percentages) as each pass always has.
 */
export function rankCandidates(
  matches: SpeciesMatch[],
  b: BodyExoState,
  inputs: CandidateInputs,
  store: GameStateStore,
  db: SpeciesDatabase,
  root: string,
): void {
  const { scan, rec, ctx, journalHost } = inputs;
  const locked = () => new Set(collectResolvedOrganicLockSpeciesIds(b.organicGenusLocks, db));
  attachPresenceProbability(matches, b, scan, rec, journalHost, root, store);
  // Which species of a genus, where the ranking model cannot tell them apart (Phase A.6).
  applyGenusBodySplit(matches, scan, ctx.regionName ?? null, root, locked());
  // After the ranking, because the floor is a rule about the ranking's own output.
  demoteBelowPresenceFloor(matches, b, db);
  /*
    Before a DSS (Phase A.8, owner 2026-10-02): the dump's genus frequencies on bodies like this one
    re-weight the chances of what the floor left, and hide only a genus such bodies almost never carry.
  */
  applyGenusPrior(matches, b, scan, ctx, root);
  vetoUnseenGenera(matches, b, scan, ctx, root, locked());
  /*
    The measured odds once more, over the genus prior (code review 2026-10-10, B8): the prior blends a
    genus's mass with the dump's cell share, which re-diluted Recepta's measured rate. The first pass,
    inside attachPresenceProbability, is what the 1 % floors judged; this one is what is shown.
  */
  if (scan) applyMeasuredOdds(matches.filter((m) => !m.unlikely), scan);
  // Order only, after every floor: Concha labiata or renibus leads by gravity (conchaOrder.ts).
  orderConchaPair(matches, scan);
  markSampledDespiteUnlikely(matches, b, db);
}

export interface CandidateRun {
  inputs: CandidateInputs & { scan: PlanetScan };
  run: MatchDatabaseRun;
  /** `run.matches`, ranked and floored. */
  matches: SpeciesMatch[];
}

/**
 * The whole chain for a surface that shows names, chances and prices but no photos: the backlog and
 * the system map. Null when the body has no planet class to match on.
 */
export function runCandidatePipeline(
  b: BodyExoState,
  store: GameStateStore,
  db: SpeciesDatabase,
  root: string,
  opts: CandidateOptions,
): CandidateRun | null {
  const inputs = candidateInputs(b, store);
  if (!inputs.scan?.PlanetClass?.trim()) return null;
  const withScan = inputs as CandidateInputs & { scan: PlanetScan };
  const run = matchCandidates(b, withScan, db, root, opts);
  // The matcher's rows before the tab's decoration; no pass below reads a photo or a price.
  const matches = run.matches as SpeciesMatch[];
  rankCandidates(matches, b, withScan, store, db, root);
  return { inputs: withScan, run, matches };
}
