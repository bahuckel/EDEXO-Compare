import { codexFirstCheck, codexFirstDataDate } from "./codexFirst.js";
import { geologyForBody } from "./geology.js";
import { eddnLedgerStatus } from "./eddnLedger.js";
import { unknownPlantSlots } from "../shared/unknownPlants.js";
import { edastroBioRegionIds } from "./edastroNsp.js";
import { speciesProvenance } from "./speciesProvenance.js";
import {
  commanderIdHash,
  loadSharedExomastery,
  ownCodexBackupKeys,
  setOwnCommander,
  sharedExomasteryDir,
  sharedFindsWithOwnership,
  sharedGateAlerts,
  sharedSignature,
} from "./sharedExomastery.js";
import type { AppStatusDTO, SessionLogDTO, SharedExomasteryDTO } from "../shared/types.js";
import { existsSync, statSync } from "node:fs";
import { loadSpatialCatalogue } from "./spatialCatalogue.js";
import { UNOBSERVED } from "../shared/observedFlag.js";
import type {
  AppSnapshot,
  BodyComputed,
  GenusCertaintyDTO,
  BodyExoState,
  EncyclopediaSpeciesRowDTO,
  ExplorationScanRecord,
  JournalBootProgressDTO,
  OrganicPendingLineItem,
  PlanetScan,
  SpeciesDatabase,
  SpeciesEntry,
  SpeciesMatch,
  SpeciesMatchContext,
  TrackedAchievementDTO,
} from "../shared/types.js";
import { getProjectRoot } from "./paths.js";
import { perfTime } from "./perf.js";
import { buildShipProximity } from "./shipProximity.js";
import { regionForSystem, regionIndexForSystem } from "./regionMapData.js";
import type { GameStateStore } from "./gameState.js";
import { matchDatabaseToScan, shownSpeciesMatches, speciesMatchesCriteria } from "./matchSpecies.js";
import { buildSpeciesMatchContext } from "./speciesMatchContext.js";
import { bumpMatchCacheEpoch } from "./matchCacheEpoch.js";
import { achievementAdvanceFor, trackedAchievementSummary, trackedSet } from "./achievements.js";
import { clearStarlightRangesCache, starlightRangeFor } from "./starlightRanges.js";
import { journalHostObservationFromSpeciesContext } from "./journalHostObservation.js";
import { resolveSpeciesPhoto } from "./speciesPhotos.js";
import { loadSpeciesDatabaseFromTree } from "./speciesTreeLoader.js";
import { loadPriceList, lookupPrice, type PriceIndex } from "./priceList.js";
import { speciesEntryMatchesOrganicLabel } from "./organicTracking.js";
import {
  explorationDataValueBreakdown,
} from "./explorationDataEstimate.js";
import {
  buildPrimaryStarsHeader,
  buildSystemMapSnapshot,
  explorationRecordsForSystem,
  bodyHasExoMarkers,
  exoMarkerBasis,
  loadStarRolesConfig,
} from "./systemMap.js";
import { computeExoPayoutRangeFromMatches, resolveOrganicSlotCount } from "./exoPayoutRange.js";
import { countEdsmPlanetRows } from "./exomasteryEdsmEncyclopedia.js";
import {
  augmentMatchesWithFootCatalog,
  clearFootCatalogSpeciesDb,
  footScannedCatalogSignature,
  ownFootEntriesWithBackups,
  resolveEntryForCatalogRow,
  mergeScanForExomastery,
  needsFootCatalogAugment,
} from "./footScannedCatalog.js";
import {
  applyExomasteryGenusCompetitivePercent,
  markExomasteryZeroHabitatMatches,
} from "./exomasteryGenusFinalize.js";
import {
  buildBodyScanExomasteryDetail,
  buildExomasteryDetail,
  buildExomasteryVarietyHints,
  buildOtherMatchDetailCards,
  exomasteryHabitatQualityPercent,
  exomasteryOtherMatchCardDeckScore,
  feederProfileBodyCount,
  hasExomasteryProfileFile,
  loadExomasteryProfile,
  maxExomasteryProfileSampleCount,
  resolveExomasteryExportBasename,
} from "./exomasteryProfile.js";
import {
  clearExoOrganicGenusMinDistCache,
  setExoOrganicSpeciesDb,
  buildExoMinimapDto,
  buildExoOrganicOverlayDto,
} from "./exoOrganicTracker.js";
import { shortBodyLabel } from "../shared/systemMapLabels.js";
import { collectOwnOrganicLockSpeciesIds, collectResolvedOrganicLockSpeciesIds } from "./organicLocks.js";
import { loadGenusCooccurrenceTable } from "./genusCooccurrenceTable.js";
import { timingFromSamples } from "../shared/systemTriage.js";
import {
  codexHasSpecies,
  codexNewColoursInRegion,
  codexSpeciesKey,
  gameOrderSpeciesName,
} from "../shared/codexLog.js";
import { candidateMorphColorLabelByLight } from "../shared/candidateSpawnHints.js";
import { genusLikelihoods, type GenusLikelihood } from "../shared/genusCooccurrence.js";
import { computeExoDataAlertsForBody } from "./exoDataConsistencyAlerts.js";
import { exoOutlierTally, recordColourOutliersForBody, recordExoOutliersForBody } from "./exoOutlierLog.js";
import { recordPredictionForBody } from "./predictionAuditLog.js";
import { collectionFocusCached } from "./collectionFocus.js";
import { edsmUploadLedgerSummary } from "./edsmUploadLedger.js";
import { edsmCredentialsStatus } from "./edsmCredentials.js";
import {
  clearSpeciesRarityCache,
  regionalRarity,
  speciesRarity,
  syncRaritySightings,
} from "./speciesRarityData.js";
import {
  attachPresenceProbability,
  demoteBelowPresenceFloor,
  markSampledDespiteUnlikely,
} from "./presenceFloors.js";
import { applyGenusBodySplit } from "./genusBodySplit.js";
import { orderConchaPair } from "./conchaOrder.js";
import { applyGenusPrior, vetoUnseenGenera } from "./genusPrior.js";
import { autoScanOnlyBodies } from "./autoScanOnly.js";
import {
  firstFootfallLookupFor,
  buildJournalSystems,
  resolveViewingSystemName,
  buildRemoteView,
  buildDScanBodiesSnapshot,
  buildLiveShipFuelRangeDTO,
  buildNotableBodiesForFocusedSystem,
} from "./snapshotSystemInfo.js";
import { bodyIdOfBodyKey, bodyKey } from "../shared/bodyKey.js";
export { PRESENCE_FLOOR_PCT, demoteBelowPresenceFloor, GENUS_SHARE_FLOOR_PCT } from "./presenceFloors.js";

/**
 * Attach the first-footfall verdict to the next-jump card.
 *
 * Skipped once `arrived` is true: the commander is there, the journal's own `WasDiscovered` on the
 * arrival star is the better source, and a guess from EDSM would overwrite a fact with an opinion.
 */
function withFirstFootfall(
  jt: NonNullable<AppSnapshot["jumpTarget"]> | null,
  store: { hasVisitedSystemNamed: (name: string) => boolean },
): NonNullable<AppSnapshot["jumpTarget"]> | null {
  if (!jt || jt.arrived || !jt.starSystem) return jt;
  const lookup = firstFootfallLookupFor(store);
  lookup.request([jt.starSystem]);
  return { ...jt, likelyFirstFootfall: lookup.verdict(jt.starSystem) };
}

let cachedStarRoles: ReturnType<typeof loadStarRolesConfig> | null = null;

/**
 * Bumped whenever the species database or price list is reloaded, so per-body caches keyed on it
 * drop automatically. See {@link computeBody}.
 */
let speciesDataGeneration = 0;

let cachedDb: SpeciesDatabase = { species: [] };
let cachedPrices: PriceIndex = new Map();

function attachOtherMatchCardScores(
  matches: SpeciesMatch[],
  scanForExo: PlanetScan | null,
  explorationRec: ExplorationScanRecord | null | undefined,
  root: string,
  journalHost: ReturnType<typeof journalHostObservationFromSpeciesContext>,
): void {
  if (!scanForExo) {
    for (const m of matches) {
      m.exomasteryOtherMatchCardScore = null;
    }
    return;
  }
  for (const m of matches) {
    if (!m.exomasteryProfilePresent) {
      m.exomasteryOtherMatchCardScore = null;
      continue;
    }
    const prof = loadExomasteryProfile(root, m.entry);
    if (!prof) {
      m.exomasteryOtherMatchCardScore = null;
      continue;
    }
    const previewCards = buildOtherMatchDetailCards(
      prof,
      scanForExo,
      explorationRec ?? undefined,
      null,
      journalHost,
    );
    m.exomasteryOtherMatchCardScore = exomasteryOtherMatchCardDeckScore(previewCards);
  }
}

function attachOtherMatchDetailCardsToMatches(
  matches: SpeciesMatch[],
  scanForExo: PlanetScan | null,
  explorationRec: ExplorationScanRecord | null | undefined,
  root: string,
  journalHost: ReturnType<typeof journalHostObservationFromSpeciesContext>,
): SpeciesMatch[] {
  if (!scanForExo) {
    return matches.map((m) => ({ ...m, otherMatchDetailCards: null }));
  }
  return matches.map((m) => {
    if (!m.exomasteryProfilePresent) return { ...m, otherMatchDetailCards: null };
    const prof = loadExomasteryProfile(root, m.entry);
    if (!prof) return { ...m, otherMatchDetailCards: null };
    return {
      ...m,
      otherMatchDetailCards: buildOtherMatchDetailCards(
        prof,
        scanForExo,
        explorationRec ?? undefined,
        m.exomasterySimilarityPercent ?? null,
        journalHost,
      ),
    };
  });
}

/** Tag every species with its rarity tier (EDSM codex + extras + own new sightings) — the DNA badge reads it. */
function tagRarity(db: SpeciesDatabase, root: string): void {
  for (const e of db.species) {
    const r = speciesRarity(root, e.id);
    if (r) e.rarity = r;
    else delete e.rarity;
  }
}

/** A fresh database starts from the files again (Refresh exomastery re-reads them). */
function withRarity(db: SpeciesDatabase, root: string): SpeciesDatabase {
  clearSpeciesRarityCache();
  tagRarity(db, root);
  // The starlight ranges ride along for the Encyclopedia card; the gate reads them server-side.
  clearStarlightRangesCache();
  for (const e of db.species) {
    const s = starlightRangeFor(e.id);
    if (s) e.starlight = { gate: s.gate, lo: s.lo, hi: s.hi, n: s.n };
  }
  return db;
}

/**
 * Rarity is dynamic (owner, 2026-09-27): the commander's codex entries newer than the EDSM dump add to
 * the counts, so tiers and region verdicts can move. Only when they did are the tags redone and the
 * cached matches dropped.
 */
function syncRarity(store: GameStateStore, db: SpeciesDatabase): void {
  const root = getProjectRoot();
  if (!syncRaritySightings(root, store.codexSightings, db.species)) return;
  tagRarity(db, root);
  computeBodyCache.clear();
  bumpMatchCacheEpoch();
}

export function loadSpeciesDatabase(): SpeciesDatabase {
  const root = getProjectRoot();
  clearExoOrganicGenusMinDistCache();
  cachedDb = withRarity(loadSpeciesDatabaseFromTree(root), root);
  setExoOrganicSpeciesDb(cachedDb);
  // The foot catalog keeps its own copy of the tree; a reload has to reach it too.
  clearFootCatalogSpeciesDb();
  speciesDataGeneration += 1;
  computeBodyCache.clear();
  bumpMatchCacheEpoch();
  cachedPrices = loadPriceList(root);
  if (!cachedDb.species.length) {
    console.warn("ED Exo Compare — no species loaded; add data/species/<genus>/… (*_new.json or *.json)");
  }
  return cachedDb;
}

export function getCachedPrices(): PriceIndex {
  return cachedPrices;
}

export function getCachedSpeciesDatabase(): SpeciesDatabase {
  return cachedDb;
}

export function getCachedPriceIndex(): PriceIndex {
  return cachedPrices;
}

/*
  The Encyclopedia's rows, built once per species database (UI review P5, 2026-09-29). Building them
  re-read and re-parsed every species' sample files (`countEdsmPlanetRows`, ~220 ms) on every open of
  the Encyclopedia; the files only change when the feeder or a photo refresh reloads the species
  caches, which clears this one too (edexoBootstrap `reloadSpeciesDerivedCaches`).
*/
let encyclopediaCache: { db: SpeciesDatabase; rows: EncyclopediaSpeciesRowDTO[] } | null = null;

export function clearEncyclopediaPayloadCache(): void {
  encyclopediaCache = null;
}

export function buildEncyclopediaPayload(): EncyclopediaSpeciesRowDTO[] {
  const root = getProjectRoot();
  if (!cachedDb.species.length) {
    cachedDb = withRarity(loadSpeciesDatabaseFromTree(root), root);
    setExoOrganicSpeciesDb(cachedDb);
  }
  if (encyclopediaCache?.db === cachedDb) return encyclopediaCache.rows;
  const rows = buildEncyclopediaRows(root);
  encyclopediaCache = { db: cachedDb, rows };
  return rows;
}

function buildEncyclopediaRows(root: string): EncyclopediaSpeciesRowDTO[] {
  return cachedDb.species.map((entry) => {
    const { photoUrl, photoNote, photoUrls, photoVariants, photoCreditByUrl } = resolveSpeciesPhoto(
      entry,
      root,
    );
    const exomasteryEdsmSampleCount = countEdsmPlanetRows(root, entry);
    const exomasteryProfile = loadExomasteryProfile(root, entry);
    const exomasteryProfileFilePresent = exomasteryProfile != null;
    const profileMaxN = exomasteryProfile ? maxExomasteryProfileSampleCount(exomasteryProfile) : 0;
    const exomasteryEncyclopediaAvailable = exomasteryProfileFilePresent || exomasteryEdsmSampleCount >= 1;
    const exomasteryDataInsufficient =
      exomasteryEncyclopediaAvailable &&
      ((exomasteryProfileFilePresent && profileMaxN === 1) ||
        (!exomasteryProfileFilePresent && exomasteryEdsmSampleCount === 1) ||
        (exomasteryProfileFilePresent && profileMaxN === 0 && exomasteryEdsmSampleCount === 1));
    const exomasteryFeederBodyCount = exomasteryProfile
      ? feederProfileBodyCount(exomasteryProfile)
      : exomasteryEdsmSampleCount;
    return {
      entry,
      priceCredits: lookupPrice(cachedPrices, entry.displayName, entry.id),
      photoUrl,
      photoNote,
      photoUrls,
      ...(photoVariants.length ? { photoVariants } : {}),
      ...(photoCreditByUrl ? { photoCreditByUrl } : {}),
      exomasteryEdsmSampleCount,
      exomasteryFeederBodyCount,
      exomasteryProfileFilePresent,
      exomasteryEncyclopediaAvailable,
      exomasteryDataInsufficient,
    };
  });
}

/** Resolve a species row for Encyclopedia HTTP APIs (validated genus folder name). */
export function findSpeciesEntryForEncyclopedia(
  genusDataDir: string,
  speciesEntryId: string,
): SpeciesEntry | null {
  if (!genusDataDir || genusDataDir.includes("..") || /[/\\]/.test(genusDataDir)) return null;
  if (!speciesEntryId) return null;
  if (!cachedDb.species.length) {
    cachedDb = loadSpeciesDatabaseFromTree(getProjectRoot());
    setExoOrganicSpeciesDb(cachedDb);
  }
  return cachedDb.species.find((e) => e.genusDataDir === genusDataDir && e.id === speciesEntryId) ?? null;
}

function resolveStarForBodyTab(b: BodyExoState, store: GameStateStore): string {
  const fromBody = b.starSystem?.trim();
  if (fromBody) return fromBody;
  const fromVisit = store.visitedSystems.get(b.systemAddress)?.trim();
  if (fromVisit) return fromVisit;
  return (store.currentSystem ?? "").trim();
}

function bodyTabLabel(b: BodyExoState, store: GameStateStore): string {
  const sk = bodyKey(b.systemAddress, b.bodyId);
  const rec = store.explorationScans.get(sk);
  const star = resolveStarForBodyTab(b, store);
  const fromRec = rec?.bodyName?.trim();
  const fromState = b.bodyName?.trim();
  const isGeneric = (s: string) => /^body\s+\d+$/i.test(s);

  let full = "";
  if (fromRec && !isGeneric(fromRec)) full = fromRec;
  else if (fromState && !isGeneric(fromState)) full = fromState;
  else if (fromRec) full = fromRec;
  else if (fromState) full = fromState;

  if (!full) return `Body ${b.bodyId}`;
  if (isGeneric(full)) return full;
  return shortBodyLabel(full, star);
}

/**
 * Compare candidate genera with the biological signal count the game already told us.
 *
 * One genus per signal, no genus twice, so an equal count means every candidate genus is present —
 * a decision the commander can act on without flying there, which is the whole point of the app.
 * Fewer candidates than signals cannot happen in the game and is therefore proof that one of our
 * gates is wrong; measured across the journal cache that fires on 15 of 1,096 bodies.
 *
 * Species marked `predictionUnsupported` are excluded from the count: they were never predicted, so
 * letting them satisfy the signal count would manufacture a certainty nobody earned. Candidates in
 * the unlikely tier are excluded for the same reason — a verdict has to be about the list the
 * commander is actually shown, or "certain" means nothing.
 */
export function genusCertaintyForBodyForTests(
  b: BodyExoState,
  matches: SpeciesMatch[],
): GenusCertaintyDTO | null {
  return genusCertaintyForBody(b, matches);
}

function genusCertaintyForBody(b: BodyExoState, matches: SpeciesMatch[]): GenusCertaintyDTO | null {
  const signalCount = b.biologicalSignals;
  if (signalCount == null || !Number.isFinite(signalCount) || signalCount <= 0) return null;

  const byDir = new Map<string, string>();
  /** Genera with at least one row that earned its place, rather than being put back to fill the count. */
  const earned = new Set<string>();
  for (const m of matches) {
    if (m.entry.predictionUnsupported || m.unlikely) continue;
    const dir = m.entry.genusDataDir;
    if (!dir) continue;
    if (!m.restoredForSignalCount) earned.add(dir);
    if (byDir.has(dir)) continue;
    byDir.set(dir, m.entry.genus?.trim() || dir);
  }
  const genera = [...byDir.values()].sort((x, y) => x.localeCompare(y));
  const candidateGenera = genera.length;
  if (candidateGenera === 0) return null;

  /*
    A count met only by putting demoted rows back is not a certainty. Tegnae HT-Z d13-1 1 a (owner,
    2026-09-25): one signal, nothing passing the gates, so Anemone — never recorded under an F star —
    was put back and the line read "confirmed from the signal count alone". The plant was Bark Mounds,
    which the data did not have yet.
  */
  const restoredGenera = [...byDir.entries()]
    .filter(([dir]) => !earned.has(dir))
    .map(([, name]) => name)
    .sort((x, y) => x.localeCompare(y));
  const status =
    candidateGenera === signalCount
      ? restoredGenera.length
        ? "bestGuess"
        : "certain"
      : candidateGenera < signalCount
        ? "underCovered"
        : "ambiguous";
  return {
    status,
    signalCount,
    candidateGenera,
    genera,
    ...(status === "bestGuess" ? { restoredGenera } : {}),
  };
}

/**
 * Candidate genera in likelihood order, when there is a signal count to solve against.
 *
 * The list the matcher produces is unordered at genus level — alphabetical, which is to say
 * arbitrary. This orders it by how the corpus says the candidates are distributed, subject to the
 * constraint that exactly `signalCount` of them are present. Ordering only: the probabilities are
 * not calibrated and nothing renders them.
 *
 * Genera already confirmed on foot are passed in as known, so the solver conditions on them instead
 * of ranking them.
 */
function genusLikelihoodsForBody(
  b: BodyExoState,
  matches: SpeciesMatch[],
  db: SpeciesDatabase,
  root: string,
): GenusLikelihood[] | null {
  const signalCount = b.biologicalSignals;
  if (signalCount == null || !Number.isFinite(signalCount) || signalCount <= 0) return null;
  const table = loadGenusCooccurrenceTable(root);
  if (!table) return null;

  const candidates = [
    ...new Set(
      matches.filter((m) => !m.unlikely && !m.entry.predictionUnsupported).map((m) => m.entry.genusDataDir),
    ),
  ].filter(Boolean);
  if (candidates.length === 0) return null;

  const confirmedIds = new Set(collectOwnOrganicLockSpeciesIds(b.organicGenusLocks, db));
  const known = [
    ...new Set(db.species.filter((e) => confirmedIds.has(e.id)).map((e) => e.genusDataDir)),
  ].filter((g) => candidates.includes(g));

  return genusLikelihoods(table, candidates, signalCount, known)?.likelihoods ?? null;
}

/**
 * Mark the candidates this commander has never logged in the codex (B4).
 *
 * Silent until the journals have been merged by a build that collects `CodexEntry` — with an empty
 * set the honest answer is "we do not know", and badging every candidate as new would be the loudest
 * possible way to be wrong.
 */
function attachCodexNovelty(matches: SpeciesMatch[], store: GameStateStore): void {
  if (store.codexLoggedSpecies.size === 0) return;
  for (const m of matches) {
    m.notInCodex = !codexHasSpecies(store.codexLoggedSpecies, m.entry.displayName);
  }
}

/**
 * The colour each species was actually logged in on this body ("Stratum Tectonicas - Green" gives
 * "Green"), and the ones that are not what the app predicted: flagged on the row and returned for the
 * outliers file (owner, 2026-09-26).
 */
function attachConfirmedColours(
  matches: SpeciesMatch[],
  b: BodyExoState,
  ctx: SpeciesMatchContext | null,
  scan: PlanetScan | null,
): { speciesId: string; speciesName: string; predicted: string; logged: string }[] {
  const misses: { speciesId: string; speciesName: string; predicted: string; logged: string }[] = [];
  if (!b.confirmedVariants?.length) return misses;
  const byKey = new Map<string, string>();
  for (const v of b.confirmedVariants) {
    const dash = v.indexOf(" - ");
    if (dash > 0) byKey.set(codexSpeciesKey(v.slice(0, dash)), v.slice(dash + 3).trim());
  }
  for (const m of matches) {
    const c = byKey.get(codexSpeciesKey(gameOrderSpeciesName(m.entry.displayName)));
    if (!c) continue;
    m.confirmedColour = c;
    const predicted = colourPredictionMissed(m.entry, c, ctx, scan);
    if (!predicted) continue;
    m.colourMismatchPredicted = predicted;
    misses.push({ speciesId: m.entry.id, speciesName: m.entry.displayName, predicted, logged: c });
  }
  return misses;
}

/**
 * What the app predicted for this species here, when that was not the colour logged; null when the
 * prediction was right or there was none. "(unknown)" is no prediction; "Cyan or Orange" is right
 * when either is logged.
 */
function colourPredictionMissed(
  entry: SpeciesEntry,
  logged: string,
  ctx: SpeciesMatchContext | null,
  scan: PlanetScan | null,
): string | null {
  const predicted = predictedColourFor(entry, ctx, scan);
  if (!predicted || predicted.startsWith("(")) return null;
  const options = predicted.split(" or ").map((x) => x.trim().toLowerCase());
  return options.includes(logged.trim().toLowerCase()) ? null : predicted;
}

/**
 * Every logged colour in the journals, checked against the prediction (owner, 2026-09-26: "run
 * through my journals and add colours to outliers … needed for the codex").
 *
 * The snapshot only computes the bodies of the system in view, so a colour logged anywhere else
 * never reached the outliers file. This walks every body with a logged variant, once: a body is
 * checked again only when it gains a variant. Bodies go system by system, because the per-system
 * scan index is rebuilt whenever the system changes. The file's own once-per-(body, species) key
 * keeps a re-run from writing anything twice.
 */
const colourSweepSeen = new Map<string, number>();

/** The store revision each store was last swept at: no new confirmed colour, no pass over every body. */
const colourSweptAt = new WeakMap<GameStateStore, number>();

export function sweepColourOutliers(store: GameStateStore, db: SpeciesDatabase): number {
  // ~2 ms a snapshot on his journals for a pass that almost never finds anything (2026-10-01).
  if (colourSweptAt.get(store) === store.confirmedVariantsRevision) return 0;
  colourSweptAt.set(store, store.confirmedVariantsRevision);
  const pending = [...store.bodies.values()]
    .filter((b) => (b.confirmedVariants?.length ?? 0) > (colourSweepSeen.get(b.key) ?? 0))
    .sort((a, b) => a.systemAddress - b.systemAddress);
  if (!pending.length) return 0;
  const byName = new Map(db.species.map((e) => [codexSpeciesKey(gameOrderSpeciesName(e.displayName)), e]));
  let written = 0;
  for (const b of pending) {
    colourSweepSeen.set(b.key, b.confirmedVariants!.length);
    const scan = mergeScanForExomastery(
      b.scan,
      store.physicsExplorationScan(bodyKey(b.systemAddress, b.bodyId)),
    );
    if (!scan) continue;
    const ctx = buildSpeciesMatchContext(b, store);
    const misses: { speciesId: string; speciesName: string; predicted: string; logged: string }[] = [];
    for (const v of b.confirmedVariants!) {
      const dash = v.indexOf(" - ");
      if (dash <= 0) continue;
      const entry = byName.get(codexSpeciesKey(v.slice(0, dash)));
      const logged = v.slice(dash + 3).trim();
      if (!entry || !logged) continue;
      const predicted = colourPredictionMissed(entry, logged, ctx, scan);
      if (predicted) misses.push({ speciesId: entry.id, speciesName: entry.displayName, predicted, logged });
    }
    if (misses.length) {
      written += recordColourOutliersForBody({
        body: b,
        misses,
        colourStarType: ctx.colourStarType ?? ctx.parentStarType ?? null,
        candidates: misses.map((m) => m.speciesId),
      });
    }
  }
  return written;
}

/** Test seam. */
export function resetColourSweepForTests(store?: GameStateStore): void {
  colourSweepSeen.clear();
  if (store) colourSweptAt.delete(store);
}

/**
 * [CODEX]: the colour this body would grow is not yet in the commander's codex for this region
 * (owner, 2026-09-26 — per colour, as the game's CODEX tab keeps it). The colour is the same label the
 * species row shows, so the mark and the row never disagree. Silent until the journals have been
 * merged by a build that collects the per-region record, and when the region is unknown.
 */
function attachCodexRegionNovelty(
  matches: SpeciesMatch[],
  store: GameStateStore,
  ctx: SpeciesMatchContext | null,
  scan: PlanetScan | null,
): void {
  const edastroBio = edastroBioRegionIds();
  // Your own codex backup (shared-exomastery, same FID) counts as logged: journals lost, codex not.
  const backup = ownCodexBackupKeys();
  const logged = backup.size ? new Set([...store.codexRegionLogged, ...backup]) : store.codexRegionLogged;
  if (logged.size === 0) return;
  const region = ctx?.regionName?.trim();
  if (!region) return;
  for (const m of matches) {
    const label =
      m.confirmedColour ??
      m.predictedColour ?? predictedColourFor(m.entry, ctx, scan);
    const fresh = codexNewColoursInRegion(logged, region, m.entry.displayName, label);
    if (fresh) {
      m.codexNew = true;
      m.codexNewColours = fresh;
      m.codexRegion = region;
      // Nobody else has it here either (EDSM's dump, and EDAstro's when downloaded): the commander
      // would be the first (owner, 2026-09-30 / 2026-10-01).
      const first = codexFirstCheck(getProjectRoot(), region, m.entry.displayName, label, edastroBio);
      if (first) {
        m.codexFirst = true;
        m.codexFirstColours = first.colours;
        const asOf = codexFirstDataDate(getProjectRoot());
        if (asOf) m.codexFirstAsOf = asOf;
        if (first.edastro && edastroBio) {
          // The local date, like the EDSM dump's (codex_region_extract.py: date.today()).
          const d = new Date(edastroBio.fetchedAtMs);
          m.codexFirstEdastroAsOf = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          if (first.edastroSpeciesOnly) m.codexFirstEdastroSpeciesOnly = true;
        }
        const ledger = eddnLedgerStatus();
        if (ledger.found && ledger.checkedAt) m.codexFirstEddnAsOf = ledger.checkedAt.slice(0, 10);
      }
    }
  }
}

/**
 * The colour predicted for a species on this body: its own table or materials first, then the stars by
 * their light on the body, brightest first — a star whose class has no colour row hands over to the
 * next, and with none left it is "(unknown)", never a guessed class (owner, 2026-09-28).
 */
function predictedColourFor(entry: SpeciesEntry, ctx: SpeciesMatchContext | null, scan: PlanetScan | null): string {
  const stars = ctx?.colourStarTypes?.length ? ctx.colourStarTypes : [ctx?.colourStarType ?? ctx?.parentStarType];
  return candidateMorphColorLabelByLight(entry, stars, scan?.materials);
}

/**
 * The tracked achievement (owner, 2026-09-27): mark the rows whose plant, here, would advance it —
 * the colour the row shows, in the body's region, not yet done. Same colour label as [CODEX].
 */
function attachAchievementAdvance(
  matches: SpeciesMatch[],
  store: GameStateStore,
  ctx: SpeciesMatchContext | null,
  scan: PlanetScan | null,
): void {
  if (!store.trackedAchievementId) return;
  const root = getProjectRoot();
  const tracked = trackedSet(root, store, cachedDb.species);
  if (!tracked) return;
  for (const m of matches) {
    if (m.unlikely) continue;
    const label =
      m.confirmedColour ??
      m.predictedColour ?? predictedColourFor(m.entry, ctx, scan);
    const adv = achievementAdvanceFor(root, store, cachedDb.species, tracked, m.entry.id, ctx?.regionName, label);
    if (adv) m.achievementAdvance = adv;
  }
}

/** The tracked achievement for the app bar and the HUD, with what in the system in view advances it. */
function trackedAchievementForSnapshot(
  store: GameStateStore,
  bodies: readonly BodyComputed[],
): TrackedAchievementDTO | null {
  const summary = trackedAchievementSummary(getProjectRoot(), store, cachedDb.species);
  if (!summary) return null;
  const here: TrackedAchievementDTO["here"] = [];
  for (const b of bodies) {
    for (const m of b.matches) {
      const a = m.achievementAdvance;
      if (!a || m.unlikely) continue;
      here.push({
        bodyKey: b.state.key,
        body: b.tabLabel || b.state.bodyName,
        species: m.entry.displayName,
        colours: a.variants.map((v) => v.split(" - ")[1] ?? v),
      });
    }
  }
  return { ...summary, here };
}

let sharedSummaryMemo: { key: string; value: SharedExomasteryDTO } | null = null;

/** The launcher's line about the shared folder (GET /api/exomastery/shared). */
export function sharedExomasterySummary(): SharedExomasteryDTO {
  return buildSharedExomasterySummary(cachedDb);
}

/**
 * What the launcher and the mail icon show about the shared-exomastery folder. The gate check walks
 * every shared find, so it runs once per change of the folder (or of the species data), not per push.
 */
function buildSharedExomasterySummary(db: SpeciesDatabase): SharedExomasteryDTO {
  const key = `${sharedSignature()}#${speciesDataGeneration}`;
  if (sharedSummaryMemo?.key === key) return sharedSummaryMemo.value;
  const s = loadSharedExomastery();
  const withOwner = sharedFindsWithOwnership(s);
  const commanders = new Set<string>();
  for (const { others } of withOwner) for (const c of others) commanders.add(c.fid ?? c.name ?? "?");
  const value: SharedExomasteryDTO = {
    folder: sharedExomasteryDir(),
    files: s.files,
    finds: withOwner.filter((x) => x.others.length > 0).length,
    ownBackupFinds: withOwner.filter((x) => x.own).length,
    commanders: commanders.size,
    alerts: sharedGateAlerts(db, resolveEntryForCatalogRow, (entry, scan, band, range) =>
      speciesMatchesCriteria(entry, scan, band, range, null),
    ),
  };
  sharedSummaryMemo = { key, value };
  return value;
}

function ambiguityForBody(b: BodyExoState): string | null {
  const sig = b.biologicalSignals;
  const genusN = b.genusHints?.length ?? 0;
  const lines: string[] = [];

  /* Empty DSS genus hint is shown in the planetary DSS Genus pill; keep ambiguity for other cases only. */

  if (b.genusHints && sig !== null && genusN > sig) {
    lines.push(
      `DSS lists ${genusN} distinct genera while only ${sig} biological signal(s) are present — the extra genera may be misleading or share overlapping sites.`,
    );
  }

  if (lines.length === 0) return null;
  return lines.join(" ");
}

/**
 * Per-body results, keyed on everything {@link computeBodyUncached} reads.
 *
 * Matching and the exomastery card work dominate the snapshot build — 81 ms of an 83 ms build for
 * a two-body system — and it was redone from scratch on every push even when the body had not
 * changed. Only the entry for a body whose inputs actually moved is recomputed.
 */
const computeBodyCache = new Map<string, { signature: string; value: BodyComputed }>();

/** Bounded so bodies from systems left behind cannot accumulate for a whole session. */
const COMPUTE_BODY_CACHE_MAX = 256;

/** Organic sample/analyse progress for this body only — feeds `isOrganicAnalysisCompleteForEntry`. */
function organicProgressSignature(store: GameStateStore, bodyKey: string): string {
  const prefix = `${bodyKey}::`;
  const parts: string[] = [];
  for (const [k, v] of store.organicAnalyseByKey) {
    if (k.startsWith(prefix)) parts.push(`${k}=${v.count}:${v.label}`);
  }
  return parts.sort().join(",");
}

function computeBodyCacheSignature(
  b: BodyExoState,
  store: GameStateStore,
  explorationRec: ExplorationScanRecord | null,
  root: string,
): string {
  return JSON.stringify({
    body: b,
    rec: explorationRec,
    ctx: buildSpeciesMatchContext(b, store),
    tab: bodyTabLabel(b, store),
    bacterium: store.includeBacteriumInSearch,
    firstFootfall: store.firstFootfallBodies.has(b.key),
    wasFootfalled: store.bodyDetailedFootfallState.get(b.key) ?? null,
    // The age is part of what is drawn, so the signature has to move when the observation does —
    // otherwise a body keeps showing a stale rung from cache.
    footfallSeenAt: store.bodyFootfallFlag.get(b.key)?.seenAt ?? null,
    mappedFlag: (() => {
      const m = store.bodyMappedFlag.get(b.key);
      return m ? `${String(m.value)}:${m.seenAt ?? ""}` : null;
    })(),
    organic: organicProgressSignature(store, b.key),
    species: speciesDataGeneration,
    footCatalog: footScannedCatalogSignature(root),
    // A new CodexEntry changes the "new to you" and [CODEX] marks without touching the body.
    codex: `${store.codexLoggedSpecies.size}/${store.codexRegionLogged.size}`,
    // [CODEX FIRST] also reads EDAstro's plants: a download mid-session re-marks the bodies.
    edastroBio: edastroBioRegionIds()?.fetchedAtMs ?? 0,
    // …and the EDDN collector's ledger, when one answers (eddnLedger.ts).
    eddnLedger: (() => {
      const l = eddnLedgerStatus();
      return l.found ? `${l.plantRows}/${l.checkedAt?.slice(0, 10) ?? ""}` : 0;
    })(),
    // The tracked achievement's marks move with what is tracked and with every completion.
    achievement: `${store.trackedAchievementId ?? ""}/${store.achievementDone.size}`,
    shared: sharedSignature(),
  });
}

function computeBody(
  b: BodyExoState,
  db: SpeciesDatabase,
  prices: PriceIndex,
  store: GameStateStore,
): BodyComputed {
  const root = getProjectRoot();
  // Physics, not value: a sold system keeps its gravity, materials, composition and host star.
  const explorationRec = store.physicsExplorationScan(bodyKey(b.systemAddress, b.bodyId));
  const signature = computeBodyCacheSignature(b, store, explorationRec, root);
  const cached = computeBodyCache.get(b.key);
  if (cached && cached.signature === signature) return cached.value;

  const value = computeBodyUncached(b, db, prices, store);
  if (computeBodyCache.size >= COMPUTE_BODY_CACHE_MAX) computeBodyCache.clear();
  computeBodyCache.set(b.key, { signature, value });
  return value;
}

/**
 * A body the ship only AutoScanned (autoScanOnly.ts): its stats and nothing else (owner, 2026-10-05,
 * replacing the 2026-10-02 "fake one bio signal" rule — it listed Sinuous Tubers on a body nobody knew
 * had life, and hid A 1 and A 2 of Weqaei PS-T b3-3 beside the A 3 it kept). Every landable one gets
 * its tab; no candidates, no price, no unknown-plant slots until the FSS says how many signals there
 * are. The candidate panel says so instead.
 */
export function computeAutoScanOnlyBody(
  b: BodyExoState,
  store: GameStateStore,
  db: SpeciesDatabase = cachedDb,
  prices: PriceIndex = cachedPrices,
): BodyComputed | null {
  const computed = computeBody({ ...b, key: `${b.key}#autoscan` }, db, prices, store);
  return {
    ...computed,
    state: b,
    matches: [],
    genusCertainty: null,
    genusLikelihoods: null,
    ambiguityNote: null,
    exoPayoutRange: null,
    exoDataAlerts: [],
    dssGenusOrphanHints: [],
    unknownPlants: [],
  };
}

function computeBodyUncached(
  b: BodyExoState,
  db: SpeciesDatabase,
  prices: PriceIndex,
  store: GameStateStore,
): BodyComputed {
  const genusFilterActive = !!(b.genusHints && b.genusHints.length > 0);
  const root = getProjectRoot();
  // Physics, not value: a sold system keeps its gravity, materials, composition and host star.
  const explorationRec = store.physicsExplorationScan(bodyKey(b.systemAddress, b.bodyId));
  const mergedScan = mergeScanForExomastery(b.scan, explorationRec);

  if (!mergedScan?.PlanetClass?.trim()) {
    const speciesMatchCtx = buildSpeciesMatchContext(b, store);
    const { alerts: exoDataAlerts, dssGenusOrphanHints } = computeExoDataAlertsForBody({
      body: b,
      mergedScan,
      matches: [],
      speciesMatchCtx,
      db,
      includeBacterium: store.includeBacteriumInSearch,
    });
    return {
      state: b,
      mergedScan,
      bodyScanDetail: null,
      tabLabel: bodyTabLabel(b, store),
      matches: [],
      genusFilterActive,
      genusCertainty: null,
      genusLikelihoods: null,
      ambiguityNote:
        b.biologicalSignals || genusFilterActive
          ? "Awaiting a detailed surface scan in the journal for this body — landable planet stats are required for matching."
          : null,
      estimatedSurfaceTempK: null,
      speciesMatchContext: speciesMatchCtx,
      approximateMatchingUsed: false,
      geology: geologyForBody({
        body: b,
        scan: mergedScan,
        region: speciesMatchCtx?.regionName,
        codexLogged: store.codexMapLogged,
      }),
      exoPayoutRange: null,
      exoDataAlerts,
      dssGenusOrphanHints,
    };
  }

  const speciesMatchCtx = buildSpeciesMatchContext(b, store);
  const journalHost = journalHostObservationFromSpeciesContext(speciesMatchCtx);

  const {
    matches: raw,
    genusFilterActive: gfa,
    estimatedSurfaceTempK,
    approximateMatchingUsed,
  } = matchDatabaseToScan(db, mergedScan, b.genusHints, b.organicGenusLocks, {
    includeBacterium: store.includeBacteriumInSearch,
    matchContext: speciesMatchCtx,
    spatialCatalogue: loadSpatialCatalogue(root),
    biologicalSignals: b.biologicalSignals,
    signalCountAssumed: b.autoScanOnly === true,
  });
  const scanForExo = mergedScan;
  const bodyScanDetail = buildBodyScanExomasteryDetail(mergedScan, explorationRec);

  /*
    Which species on this body are known only from a composition scan.
    A foot scan says strictly more — it also proves the commander could reach it — so a species with
    both is simply confirmed, and the badge is for the ones the ship named from orbit.
  */
  const compScanOnly = new Set(
    collectResolvedOrganicLockSpeciesIds(
      (b.organicGenusLocks ?? []).filter((l) => !l.fromSibling && l.source === "codex"),
      db,
    ),
  );
  for (const id of collectResolvedOrganicLockSpeciesIds(
    (b.organicGenusLocks ?? []).filter((l) => !l.fromSibling && l.source !== "codex" && l.source !== "spansh"),
    db,
  )) {
    compScanOnly.delete(id);
  }
  /*
    Who logged each species here (owner, 2026-09-25): this commander's journal — a foot scan or the
    composition scanner — or other commanders, via Spansh, for a system looked up remotely.
  */
  const loggedByYou = new Set(
    collectResolvedOrganicLockSpeciesIds(
      (b.organicGenusLocks ?? []).filter((l) => !l.fromSibling && l.source !== "spansh"),
      db,
    ),
  );
  const loggedByOthers = new Set(
    collectResolvedOrganicLockSpeciesIds(
      (b.organicGenusLocks ?? []).filter((l) => !l.fromSibling && l.source === "spansh"),
      db,
    ),
  );
  let matches: SpeciesMatch[] = raw.map((m) => {
    const { photoUrl, photoNote, photoUrls, photoVariants, photoCreditByUrl } = resolveSpeciesPhoto(
      m.entry,
      root,
    );
    const priceCredits = lookupPrice(prices, m.entry.displayName, m.entry.id);
    const hasFile = hasExomasteryProfileFile(root, m.entry);
    const profile = loadExomasteryProfile(root, m.entry);
    const hq =
      profile && scanForExo
        ? exomasteryHabitatQualityPercent(profile, scanForExo, explorationRec ?? undefined, journalHost)
        : null;
    return {
      ...m,
      photoUrl,
      photoNote,
      photoUrls,
      ...(photoVariants.length ? { photoVariants } : {}),
      ...(photoCreditByUrl ? { photoCreditByUrl } : {}),
      priceCredits,
      organicAnalysisComplete: store.isOrganicAnalysisCompleteForEntry(b.key, m.entry),
      ...(compScanOnly.has(m.entry.id) ? { confirmedByCompositionScan: true } : {}),
      ...(loggedByYou.has(m.entry.id)
        ? { loggedBy: "you" as const }
        : loggedByOthers.has(m.entry.id)
          ? { loggedBy: "others" as const }
          : {}),
      ...(hasFile
        ? {
            exomasteryProfilePresent: true,
            exomasteryHabitatQuality: hq ?? null,
            exomasteryProfileSampleCount: profile ? feederProfileBodyCount(profile) : null,
            exomasterySimilarityPercent: null,
            exomasteryVarietyHints: profile ? buildExomasteryVarietyHints(profile) : null,
            exomasteryExportBasename: resolveExomasteryExportBasename(root, m.entry),
            exomasteryDetail:
              profile && scanForExo
                ? buildExomasteryDetail(profile, scanForExo, explorationRec, journalHost)
                : null,
          }
        : {}),
    };
  });
  matches = markExomasteryZeroHabitatMatches(matches);
  if (needsFootCatalogAugment(b, matches)) {
    matches = augmentMatchesWithFootCatalog(
      matches,
      b,
      db,
      prices,
      root,
      (entry) => store.isOrganicAnalysisCompleteForEntry(b.key, entry),
      explorationRec,
      journalHost,
      speciesMatchCtx,
      { includeBacterium: store.includeBacteriumInSearch },
    );
    matches = markExomasteryZeroHabitatMatches(matches);
  }
  attachPresenceProbability(matches, b, scanForExo, explorationRec, journalHost, root, store);
  // Which species of a genus, where the ranking model cannot tell them apart (Phase A.6).
  applyGenusBodySplit(
    matches,
    scanForExo,
    speciesMatchCtx?.regionName ?? null,
    root,
    new Set(collectResolvedOrganicLockSpeciesIds(b.organicGenusLocks, db)),
  );
  // After the ranking, because the floor is a rule about the ranking's own output.
  demoteBelowPresenceFloor(matches, b, db);
  /*
    Before a DSS (Phase A.8, owner 2026-10-02): the dump's genus frequencies on bodies like this one
    re-weight the chances of what the floor left, and hide only a genus such bodies almost never carry.
  */
  applyGenusPrior(matches, b, scanForExo, speciesMatchCtx, root);
  vetoUnseenGenera(matches, b, scanForExo, speciesMatchCtx, root, new Set(collectResolvedOrganicLockSpeciesIds(b.organicGenusLocks, db)));
  // Order only, after every floor: Concha labiata or renibus leads by gravity (conchaOrder.ts).
  orderConchaPair(matches, scanForExo);
  markSampledDespiteUnlikely(matches, b, db);
  /*
    The collection marker: species where both the corpus and this commander are short of bodies.

    **After the demotion, and only on rows the panel still offers.** A demoted candidate is one the
    app has decided will not grow here, so marking it "worth sampling" would send the commander to
    fetch something that is not there — the marker is advice about where to spend a landing, not a
    note about the species in the abstract. Read rather than computed, so a body being scrolled past
    costs one map lookup. See `collectionFocus.ts` for why none of it is ever shipped.
  */
  {
    const focus = collectionFocusCached(store.bodies.values(), db, root);
    if (focus.size > 0) {
      for (const m of matches) {
        if (m.unlikely) continue;
        const r = focus.get(m.entry.id);
        if (!r) continue;
        m.collectionFocus = true;
        m.collectionFocusNote = {
          ownScans: r.ownScans,
          corpusBodies: r.corpusBodies,
          remaining: r.remaining,
        };
      }
    }
  }
  /*
   * Who says this species is here, unioned from the two stores at the moment of rendering.
   *
   * Deliberately after the matcher has finished. Provenance describes the *evidence* for a row, not
   * whether the row belongs — feeding it back into scoring would let the commander's own scan
   * quietly re-weight a prediction, which is the circularity the whole gate ladder avoids.
   */
  for (const m of matches) {
    m.provenance = speciesProvenance(root, b.systemAddress, b.bodyId, m.entry);
    // Another commander's shared file has it on this very body (§S).
    if (m.provenance.sharedBy?.length && !m.loggedBy) m.loggedBy = "others";
  }
  const colourMisses = attachConfirmedColours(matches, b, speciesMatchCtx, scanForExo);
  if (colourMisses.length) {
    recordColourOutliersForBody({
      body: b,
      misses: colourMisses,
      colourStarType: speciesMatchCtx?.colourStarType ?? speciesMatchCtx?.parentStarType ?? null,
      candidates: matches.filter((m) => !m.unlikely).map((m) => m.entry.id),
    });
  }
  for (const m of matches) m.predictedColour = predictedColourFor(m.entry, speciesMatchCtx, scanForExo);
  attachCodexNovelty(matches, store);
  attachCodexRegionNovelty(matches, store, speciesMatchCtx, scanForExo);
  attachAchievementAdvance(matches, store, speciesMatchCtx, scanForExo);
  // Rarity where the body is (owner, 2026-09-27): a species can be common here and rare elsewhere.
  if (speciesMatchCtx?.regionName) {
    for (const m of matches) {
      const r = regionalRarity(getProjectRoot(), speciesMatchCtx.regionName, m.entry.id);
      if (r) m.regionRarity = r;
    }
  }
  attachOtherMatchCardScores(matches, scanForExo, explorationRec, root, journalHost);
  applyExomasteryGenusCompetitivePercent(matches);
  if (matches.length > 0 && scanForExo) {
    matches = attachOtherMatchDetailCardsToMatches(matches, scanForExo, explorationRec, root, journalHost);
  }
  // `approximateMatchingUsed` (an on-foot scan named a species the gates rejected) is no longer
  // appended here: the owner moved that sentence behind the candidate list's [?] (2026-09-25).
  const note = ambiguityForBody(b);

  const { count: slots, source: slotSource } = resolveOrganicSlotCount(b);
  const wf = store.bodyDetailedFootfallState.get(b.key);
  const journalWasFootfalled = wf === undefined ? null : wf === true;
  const mult: 1 | 5 = store.firstFootfallBodies.has(b.key) ? 5 : 1;
  const exoPayoutRange =
    slots > 0 && bodyHasExoMarkers(b) && slotSource !== "none"
      ? computeExoPayoutRangeFromMatches(
          // Payout is about what is likely here, not about everything listed.
          shownSpeciesMatches(matches),
          prices,
          slots,
          slotSource,
          mult,
          journalWasFootfalled,
          mult === 5,
          store.bodyFootfallFlag.get(b.key) ?? UNOBSERVED,
          store.bodyMappedFlag.get(b.key) ?? UNOBSERVED,
        )
      : null;
  if (exoPayoutRange && store.noFirstFootfallInSystem(b.systemAddress)) {
    const kind = store.systemKind(b.systemAddress);
    if (kind && kind !== "empty") exoPayoutRange.noFootfallSystemKind = kind;
  }

  // Evidence for the next gate fix: a species the commander confirmed here that we never offered.
  // Writes once per (body, species) and never throws.
  recordExoOutliersForBody({ body: b, matches, db });

  // And the other half of the same question: what was offered *before* the answer arrived, so a
  // suggestion that turned out wrong can be argued with rather than only counted.
  recordPredictionForBody({ body: b, matches, db });

  const { alerts: exoDataAlerts, dssGenusOrphanHints } = computeExoDataAlertsForBody({
    body: b,
    mergedScan,
    matches,
    speciesMatchCtx,
    db,
    includeBacterium: store.includeBacteriumInSearch,
  });

  return {
    state: b,
    mergedScan,
    bodyScanDetail,
    tabLabel: bodyTabLabel(b, store),
    matches,
    genusFilterActive: gfa,
    ambiguityNote: note,
    genusCertainty: genusCertaintyForBody(b, matches),
    genusLikelihoods: genusLikelihoodsForBody(b, matches, db, root),
    estimatedSurfaceTempK,
    speciesMatchContext: speciesMatchCtx,
    approximateMatchingUsed,
    exoMarkerBasis: exoMarkerBasis(b),
    geology: geologyForBody({
      body: b,
      scan: mergedScan,
      region: speciesMatchCtx?.regionName,
      codexLogged: store.codexMapLogged,
    }),
    exoPayoutRange,
    exoDataAlerts,
    dssGenusOrphanHints,
    unknownPlants: unknownPlantSlots({
      signals: b.biologicalSignals,
      matches,
      genusHints: b.genusHints,
      orphanHints: dssGenusOrphanHints,
      includeBacterium: store.includeBacteriumInSearch,
    }),
  };
}

/** Unsold exobiology (3× Analyse in journal): list ×5 on first-footfall bodies (else ×1) — same multiplier as map tier/heuristic when footfall applies. */
/** Pranav Antal's +30 % on exobiology sales (Powerplay 2.0), as the Data value toggle applies it. */
export const PRANAV_ANTAL_BONUS = 1.3;
/**
 * A fleet carrier's Universal Cartographics pays 75 % (the owner's carrier sales, 2026-10-03). Only
 * Cartographics and codex data; Vista Genomics pays in full (owner, 2026-10-04).
 */
export const FLEET_CARRIER_SALE_FACTOR = 0.75;
/** At his own carrier 10 of those 25 % land in its bank, his to take back: 85 % (owner, 2026-10-04). */
export const OWN_FLEET_CARRIER_SALE_FACTOR = 0.85;

function organicDataValuation(
  store: GameStateStore,
  prices: PriceIndex,
): {
  credits: number;
  pendingSamples: number;
} {
  let credits = 0;
  for (const p of store.pendingOrganicSales) {
    const base = lookupPrice(prices, p.label, p.label);
    if (base == null) continue;
    const mult = store.firstFootfallBodies.has(p.bodyKey) ? 5 : 1;
    credits += base * mult;
  }
  // The Pranav Antal sale bonus on the whole exobiology sale, when the commander says he sells there.
  if (store.pranavAntalBonus) credits = Math.round(credits * PRANAV_ANTAL_BONUS);
  return { credits, pendingSamples: store.pendingOrganicSales.length };
}

/*
  Label → species, per database. The pending list is re-read on every snapshot and each line searched
  all 109 species with the organic-label matcher: 17 % of a live refresh (code review §E, 2026-09-27).
*/
const pendingLabelEntries = new WeakMap<SpeciesDatabase, Map<string, SpeciesEntry | null>>();

function speciesForPendingLabel(db: SpeciesDatabase, label: string): SpeciesEntry | null {
  let byLabel = pendingLabelEntries.get(db);
  if (!byLabel) pendingLabelEntries.set(db, (byLabel = new Map()));
  let hit = byLabel.get(label);
  if (hit === undefined) {
    hit = db.species.find((e) => speciesEntryMatchesOrganicLabel(e, label)) ?? null;
    byLabel.set(label, hit);
  }
  return hit;
}

function buildOrganicPendingLines(
  store: GameStateStore,
  db: SpeciesDatabase,
  prices: PriceIndex,
): OrganicPendingLineItem[] {
  const root = getProjectRoot();
  const out: OrganicPendingLineItem[] = [];
  for (const p of store.pendingOrganicSales) {
    const body = store.bodies.get(p.bodyKey);
    const bid = bodyIdOfBodyKey(p.bodyKey);
    const bodyName = body?.bodyName ?? (Number.isFinite(bid) ? `Body ${bid}` : p.bodyKey);
    const starSystem = body?.starSystem ?? store.currentSystem ?? "—";
    const base = lookupPrice(prices, p.label, p.label);
    const firstFootfall = store.firstFootfallBodies.has(p.bodyKey);
    const mult: 1 | 5 = firstFootfall ? 5 : 1;
    const valueCredits = base != null ? base * mult : 0;
    const entry = speciesForPendingLabel(db, p.label);
    const photoUrl = entry ? resolveSpeciesPhoto(entry, root).photoUrl : "/photos/__builtin_placeholder.svg";
    out.push({
      bodyKey: p.bodyKey,
      bodyName,
      starSystem,
      speciesLabel: p.label,
      baseCredits: base,
      valueCredits,
      firstFootfall,
      multiplier: mult,
      photoUrl,
    });
  }
  return out;
}

/**
 * The region under the system being looked at.
 *
 * Cheap: one `Map` lookup for the coordinates and one run-length walk across a 2 048-entry row. It
 * runs once per snapshot, not once per body, which is the difference between free and the kind of
 * cost that ends up in a CPU profile.
 */
function regionForFocusedSystem(
  store: GameStateStore,
  focusAddr: number | null,
  projectRoot: string,
): { name: string; index: number } | null {
  if (focusAddr == null) return null;
  const pos = store.systemPositions.get(focusAddr);
  if (!pos) return null;
  const index = regionIndexForSystem(projectRoot, pos.x, pos.z);
  if (index == null || index <= 0) return null;
  const name = regionForSystem(projectRoot, pos.x, pos.y, pos.z);
  return name ? { name, index } : null;
}

/**
 * The launcher's live strip: cheap store reads, no snapshot build. Where the commander is, what is
 * unsold, and the last jump target — enough to make the launcher a glance-able dashboard while the
 * game runs, without the ~180 ms a full snapshot costs.
 */
export function organicLiveSummary(store: GameStateStore): NonNullable<AppStatusDTO["live"]> {
  const { credits, pendingSamples } = organicDataValuation(store, cachedPrices);
  const bodyKey =
    store.exoOrganicTracker?.bodyKey ?? store.overlayTouchdownBodyKey ?? store.uiSelectedBodyKey;
  const body = bodyKey ? store.bodies.get(bodyKey) : undefined;
  const jt = store.nextJumpTarget();
  return {
    systemName: store.currentSystem ?? null,
    bodyName: body?.bodyName ?? null,
    bioSignals: body?.biologicalSignals ?? null,
    organicDataValueCredits: credits,
    organicPendingSampleCount: pendingSamples,
    jumpTarget: jt
      ? { starSystem: jt.starSystem, starClass: jt.starClass, arrived: jt.arrived, source: jt.source }
      : null,
  };
}

export function buildSnapshot(
  store: GameStateStore,
  journalPath: string | null,
  journalDir: string,
  bindHost: string,
  port: number,
  lanUrls: string[],
  journalFileCount: number,
  journalBoot: JournalBootProgressDTO | null = null,
  sessionLog: SessionLogDTO | null = null,
): AppSnapshot {
  const bootLoading = journalBoot != null;
  const db = cachedDb;
  // Whose shared-exomastery files are this commander's own backups (§S), before any body is computed.
  setOwnCommander({ name: store.commanderName, fid: commanderIdHash(store.commanderFid) });
  if (!bootLoading) syncRarity(store, db);
  /*
    Not while the history replays (plan 2.3, Opus 20): every progress push walked every scan and every
    sample of a store that changes between pushes, so the memo never held — for totals the boot screen
    covers. Zero until the replay is done.
  */
  const { credits: organicDataValueCredits, pendingSamples: organicPendingSampleCount } = bootLoading
    ? { credits: 0, pendingSamples: 0 }
    : organicDataValuation(store, cachedPrices);
  // One walk of every scan, not two: the total is the breakdown's own total (code review §E).
  const exploreRaw = bootLoading
    ? { totalCredits: 0, fssScanCount: 0, fssValueCredits: 0, dssScanCount: 0, dssValueCredits: 0 }
    : explorationDataValueBreakdown(store);
  // Sold at a fleet carrier, the carrier keeps 25 % (the Data value toggle; owner, 2026-10-03).
  const carrier = !store.sellAtFleetCarrier
    ? 1
    : store.fleetCarrierIsOwn
      ? OWN_FLEET_CARRIER_SALE_FACTOR
      : FLEET_CARRIER_SALE_FACTOR;
  const exploreBreakdown = {
    ...exploreRaw,
    fssValueCredits: Math.round(exploreRaw.fssValueCredits * carrier),
    dssValueCredits: Math.round(exploreRaw.dssValueCredits * carrier),
    totalCredits: Math.round(exploreRaw.fssValueCredits * carrier) + Math.round(exploreRaw.dssValueCredits * carrier),
  };
  const explorationScanDataValueCredits = exploreBreakdown.totalCredits;
  const organicPendingLines = bootLoading ? [] : buildOrganicPendingLines(store, db, cachedPrices);
  // Logged colours anywhere in the journals, not only in the system in view (see the function).
  if (!bootLoading) perfTime("snap.colourSweep", () => sweepColourOutliers(store, db));
  const bodies: BodyComputed[] = bootLoading
    ? []
    : perfTime("snap.bodies", () =>
        store
          .listBioBodies()
          .sort((a, b) => a.bodyId - b.bodyId)
          .map((b) => computeBody(b, db, cachedPrices, store)),
      );

  const focusAddr = store.viewingSystemAddress ?? store.currentSystemAddress;
  const fssAllBodiesFoundNoBio = bootLoading
    ? false
    : focusAddr != null && store.fssAllBodiesCompleteSystems.has(focusAddr) && bodies.length === 0;
  // Landable bodies the ship only AutoScanned: their biology is unknown until the FSS (autoScanOnly.ts).
  if (!bootLoading && focusAddr != null && !store.isShowingRemoteSystem(focusAddr)) {
    for (const b of autoScanOnlyBodies(store, focusAddr)) {
      const c = computeAutoScanOnlyBody(b, store, db, cachedPrices);
      if (c) bodies.push(c);
    }
  }

  const journalSystems = bootLoading ? [] : perfTime("snap.journalSystems", () => buildJournalSystems(store));
  const viewingSystemName = bootLoading ? null : resolveViewingSystemName(store, store.viewingSystemAddress);
  const dScanNameFallback =
    bootLoading || focusAddr == null ? null : resolveViewingSystemName(store, focusAddr);

  const projectRoot = getProjectRoot();
  if (!cachedStarRoles) {
    try {
      cachedStarRoles = loadStarRolesConfig(projectRoot);
    } catch {
      cachedStarRoles = {
        fuelPrefixes: ["O", "B", "A", "F", "G", "K", "M"],
        neutronExact: ["N"],
        blackHoleExact: ["H"],
        whiteDwarfPrefix: "D",
      };
    }
  }

  const systemMap =
    bootLoading || focusAddr == null
      ? null
      : perfTime("snap.systemMap", () =>
          buildSystemMapSnapshot(
            store,
            focusAddr,
            db,
            cachedStarRoles!,
            cachedPrices,
            loadSpatialCatalogue(projectRoot),
          ),
        );
  const dScanBodies = bootLoading
    ? null
    : buildDScanBodiesSnapshot(store, focusAddr, dScanNameFallback, systemMap);

  // Sold rows count here too — see `explorationRecordsForSystem`. The star header is what the system
  // map button hangs off, so losing it to a sale takes the map with it.
  const recsForPrimary =
    !bootLoading && focusAddr != null ? explorationRecordsForSystem(store, focusAddr) : [];
  const primaryStarsHeader =
    !bootLoading && recsForPrimary.length > 0
      ? buildPrimaryStarsHeader(recsForPrimary, cachedStarRoles)
      : null;

  const edsmMapSupplementForViewingSystem =
    !bootLoading &&
    focusAddr != null &&
    store.hasEdsmExplorationForSystem(focusAddr) &&
    !store.hasJournalExplorationScansForSystem(focusAddr);

  const footScannedEntries = bootLoading
    ? []
    : perfTime("snap.footCatalog", () =>
        ownFootEntriesWithBackups(projectRoot).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
      );

  const notableBodies = bootLoading
    ? []
    : perfTime("snap.notable", () => buildNotableBodiesForFocusedSystem(store, dScanNameFallback));
  const uiAutoSelectBodyKey = bootLoading ? null : store.peekPendingUiAutoSelectBodyKey();
  const exoOverlayFocusBodyKey =
    bootLoading || focusAddr == null ? null : store.resolveExoOverlayFocusBodyKey();
  let exoOverlayFocusBody: BodyComputed | null = null;
  if (!bootLoading && exoOverlayFocusBodyKey && focusAddr != null) {
    const raw = store.bodies.get(exoOverlayFocusBodyKey);
    if (
      raw &&
      raw.systemAddress === focusAddr &&
      !bodies.some((b) => b.state.key === exoOverlayFocusBodyKey)
    ) {
      exoOverlayFocusBody = computeBody(raw, db, cachedPrices, store);
    }
  }

  let journalDirConfiguredOk = false;
  try {
    journalDirConfiguredOk = existsSync(journalDir) && statSync(journalDir).isDirectory();
  } catch {
    journalDirConfiguredOk = false;
  }

  return {
    journalPath,
    journalFileCount,
    journalDir,
    journalDirConfiguredOk,
    journalHistoryPreset: store.journalHistoryPreset,
    edsmMapSupplementForViewingSystem,
    journalBoot,
    mode: bindHost === "0.0.0.0" ? "server" : "client",
    bindHost,
    port,
    lanUrls,
    commanderName: store.commanderName,
    currentSystem: store.currentSystem,
    currentSystemAddress: store.currentSystemAddress,
    currentRegion: regionForFocusedSystem(store, focusAddr, projectRoot),
    currentSystemKind: focusAddr != null ? store.systemKind(focusAddr) : null,
    viewingSystemAddress: store.viewingSystemAddress,
    viewingSystemName,
    remoteView: bootLoading ? null : buildRemoteView(store),
    sharedExomastery: bootLoading ? null : buildSharedExomasterySummary(db),
    shipProximity: bootLoading
      ? null
      : buildShipProximity(store.currentBodyKey, focusAddr, recsForPrimary, bodies),
    journalSystems,
    bodies,
    speciesCount: db.species.length,
    lastJournalEventIso: store.lastEventIso,
    organicDataValueCredits,
    organicPendingSampleCount,
    organicPendingLines,
    fssAllBodiesFoundNoBio,
    includeBacteriumInSearch: store.includeBacteriumInSearch,
    hudPrefs: store.hudPrefs,
    trackedAchievement: bootLoading ? null : trackedAchievementForSnapshot(store, bodies),
    sessionLog,
    canonnUpload: {
      enabled: store.canonnUploadEnabled,
      sent: store.canonnUploadSent,
      failed: store.canonnUploadFailed,
    },
    eddnUpload: {
      enabled: store.eddnUploadEnabled,
      sent: store.eddnUploadSent,
      failed: store.eddnUploadFailed,
    },
    edsmAutoFetch: {
      enabled: store.edsmAutoFetchEnabled,
      ...edsmCredentialsStatus(),
    },
    edsmUpload: {
      enabled: store.edsmUploadEnabled,
      live: store.edsmLiveUploadEnabled,
      progress: store.edsmUploadProgress,
      ledger: edsmUploadLedgerSummary(),
    },
    includeExplorationScanDataInDataValue: store.includeExplorationScanDataInDataValue,
    pranavAntalBonus: store.pranavAntalBonus,
    sellAtFleetCarrier: store.sellAtFleetCarrier,
    fleetCarrierIsOwn: store.fleetCarrierIsOwn,
    explorationScanDataValueCredits,
    explorationFssScanCount: exploreBreakdown.fssScanCount,
    onSiteTiming: timingFromSamples(store.landingMinutesSamples, store.samplingMinutesSamples),
    exoOutliers: exoOutlierTally(),
    explorationFssValueCredits: exploreBreakdown.fssValueCredits,
    explorationHonkValueCredits: Math.round(("honkValueCredits" in exploreRaw ? exploreRaw.honkValueCredits : 0) * carrier),
    explorationDssScanCount: exploreBreakdown.dssScanCount,
    explorationDssValueCredits: exploreBreakdown.dssValueCredits,
    dssMappedPlanetaryBodyCount: exploreBreakdown.dssScanCount,
    notableBodies,
    exoMapTierPlusMinCr: store.exoMapTierPlusMinCr,
    exoMapTierPlusPlusMinCr: store.exoMapTierPlusPlusMinCr,
    dScanBodies,
    primaryStarsHeader,
    systemMap,
    footScannedEntries,
    uiAutoSelectBodyKey,
    uiSelectedBodyKey: bootLoading ? null : store.uiSelectedBodyKey,
    exoOverlayFocusBodyKey,
    exoOverlayFocusBody,
    statusDestination: bootLoading ? null : store.statusDestination,
    jumpTarget: bootLoading ? null : withFirstFootfall(store.nextJumpTarget(), store),
    boxelCopied: store.boxelCopied,
    focusedSystemUndiscovered:
      !bootLoading && focusAddr != null && store.commanderDiscoveredSystem(focusAddr) === true,
    remainingJumpsInRoute: bootLoading ? null : store.remainingJumpsInRoute,
    liveShipFuelRange: bootLoading ? null : buildLiveShipFuelRangeDTO(store, cachedStarRoles!),
    footTravelOdometerEnabled: store.footTravelOdometerEnabled,
    photoStamp: store.photoStamp,
    footTravelOdometerTracking: bootLoading ? false : store.footTravelOdometerTracking,
    footTravelDistanceMeters: bootLoading ? 0 : store.footTravelDistanceMeters,
    exoOrganicOverlay: bootLoading ? null : buildExoOrganicOverlayDto(store, cachedPrices),
    /*
      The radar rides on the snapshot separately from the sample session.

      It used to live only inside `exoOrganicOverlay`, which is null until a species is being
      tracked — so landing on a planet and looking at the overlay showed nothing, which is what the
      owner reported. Where the ship is parked and which plants are already taken is a question
      about the body underfoot, and it has an answer the moment the game reports a surface position.
    */
    exoMinimap: bootLoading
      ? null
      : buildExoMinimapDto(
          store,
          store.exoOrganicTracker?.bodyKey ?? store.overlayTouchdownBodyKey,
          store.exoOrganicTracker ? Math.max(0, Math.round(store.exoOrganicTracker.minSampleDistanceM)) : 0,
        ),
  };
}

loadSpeciesDatabase();
