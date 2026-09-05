import { existsSync, statSync } from "node:fs";
import type {
  AppSnapshot,
  BodyComputed,
  GenusCertaintyDTO,
  BodyExoState,
  DScanBodiesDTO,
  EncyclopediaSpeciesRowDTO,
  ExplorationScanRecord,
  JournalBootProgressDTO,
  JournalSystemInfo,
  LiveShipFuelRangeDTO,
  NotableBodyInfo,
  OrganicPendingLineItem,
  PlanetScan,
  SpeciesDatabase,
  SpeciesEntry,
  SpeciesMatch,
  SystemMapSnapshot,
} from "../shared/types.js";
import { getProjectRoot } from "./paths.js";
import { perfTime } from "./perf.js";
import type { GameStateStore } from "./gameState.js";
import { matchDatabaseToScan, shownSpeciesMatches } from "./matchSpecies.js";
import { buildSpeciesMatchContext } from "./speciesMatchContext.js";
import { journalHostObservationFromSpeciesContext } from "./journalHostObservation.js";
import { resolveSpeciesPhoto } from "./speciesPhotos.js";
import { loadSpeciesDatabaseFromTree } from "./speciesTreeLoader.js";
import { loadPriceList, lookupPrice, type PriceIndex } from "./priceList.js";
import { speciesEntryMatchesOrganicLabel } from "./organicTracking.js";
import {
  estimateExplorationJournalDataCredits,
  explorationDataValueBreakdown,
} from "./explorationDataEstimate.js";
import {
  buildPrimaryStarsHeader,
  buildSystemMapSnapshot,
  bodyHasExoMarkers,
  countPhysicalBodiesInSystemMapTree,
  loadStarRolesConfig,
  type StarRolesConfig,
} from "./systemMap.js";
import { computeExoPayoutRangeFromMatches, resolveOrganicSlotCount } from "./exoPayoutRange.js";
import { countEdsmPlanetRows } from "./exomasteryEdsmEncyclopedia.js";
import {
  augmentMatchesWithFootCatalog,
  footScannedCatalogSignature,
  loadFootScannedCatalog,
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
import { clearExoOrganicGenusMinDistCache, buildExoOrganicOverlayDto } from "./exoOrganicTracker.js";
import { shortBodyLabel } from "../shared/systemMapLabels.js";
import {
  explorationRecordIsBeltClusterLike,
  explorationRecordIsClearlyWorld,
  explorationRecordIsStellar,
} from "./explorationStellar.js";
import { isBarycentreSyntheticBodyId } from "./orbitUtils.js";
import { collectResolvedOrganicLockSpeciesIds } from "./organicLocks.js";
import { loadGenusCooccurrenceTable } from "./genusCooccurrenceTable.js";
import { rankSpeciesOnBody } from "./speciesLikelihood.js";
import { genusShares, timingFromSamples } from "../shared/systemTriage.js";
import { codexHasSpecies } from "../shared/codexLog.js";
import type { JournalHostStarObservation } from "../shared/types.js";
import { genusLikelihoods, type GenusLikelihood } from "../shared/genusCooccurrence.js";
import { analyzeNavRouteFuel } from "./navRouteFuel.js";
import { computeExoDataAlertsForBody } from "./exoDataConsistencyAlerts.js";
import { exoOutlierTally, recordExoOutliersForBody } from "./exoOutlierLog.js";

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

function buildJournalSystems(store: GameStateStore): JournalSystemInfo[] {
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

function resolveViewingSystemName(store: GameStateStore, viewingAddr: number | null): string | null {
  if (viewingAddr == null) return null;
  const fromVisit = store.visitedSystems.get(viewingAddr);
  if (fromVisit?.trim()) return fromVisit.trim();
  for (const b of store.bodies.values()) {
    if (b.systemAddress === viewingAddr && b.starSystem?.trim()) return b.starSystem.trim();
  }
  return null;
}

function scanBodyKey(systemAddress: number, bodyId: number): string {
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

function buildDScanBodiesSnapshot(
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
  if (complete) {
    return { systemName, found: total, total, complete: true };
  }
  const fromProgress = disc ? fssHonkProgressBodyCount(disc.progress, total) : 0;
  const fallbackFound = Math.min(total, Math.max(0, fromProgress, fromJournal));
  const found = Math.min(total, fromMapForFound != null ? fromMapForFound : fallbackFound);
  return { systemName, found, total, complete: false };
}

function buildLiveShipFuelRangeDTO(
  store: GameStateStore,
  starRoles: StarRolesConfig,
): LiveShipFuelRangeDTO | null {
  const main = store.liveStatusFuelMainT;
  const res = store.liveStatusFuelReserveT;
  const hasLiveStatusFuel = (main != null && Number.isFinite(main)) || (res != null && Number.isFinite(res));
  const fuelMain = main != null && Number.isFinite(main) ? Math.max(0, main) : 0;
  const fuelRes = res != null && Number.isFinite(res) ? Math.max(0, res) : 0;
  const fuelTotalTForNav = hasLiveStatusFuel ? fuelMain + fuelRes : null;

  const navRoute = analyzeNavRouteFuel({
    route: store.liveNavRoute,
    currentSystemAddress: store.currentSystemAddress,
    currentSystemName: store.currentSystem,
    fuelTotalT: fuelTotalTForNav,
    lastFsdFuelT: store.lastFsdJumpFuelUsedT,
    lastFsdDistLy: store.lastFsdJumpDistLy,
    loadoutMaxJumpLy: store.loadoutMaxJumpRangeLy,
    starRoles,
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
  for (const [k, rec] of store.explorationScans) {
    if (!k.startsWith(prefix)) continue;
    consider(rec);
  }
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
  return (rec.terraformState ?? "").trim().toLowerCase().includes("terraformable");
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

  if (!tf) return null;

  const abbr = abbreviateNotablePlanetClass(pc);
  return abbr ? `${abbr} - Terraformable` : "Terraformable";
}

function buildNotableBodiesForFocusedSystem(
  store: GameStateStore,
  focusedSystemName: string | null,
): NotableBodyInfo[] {
  const focusAddr = store.viewingSystemAddress ?? store.currentSystemAddress;
  if (focusAddr == null) return [];

  const byBodyId = new Map<number, ExplorationScanRecord>();
  for (const [k, rec] of store.explorationScans.entries()) {
    if (!k.startsWith(`${focusAddr}:`)) continue;
    if (!isPlanetLikeExplorationRecord(rec)) continue;
    byBodyId.set(rec.bodyId, rec);
  }

  const out: NotableBodyInfo[] = [];
  for (const rec of byBodyId.values()) {
    const tag = notableTagForRecord(rec);
    if (!tag) continue;
    const bk = scanBodyKey(rec.systemAddress, rec.bodyId);
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
      dssMapped: store.dssMappedBodyKeys.has(bk),
    });
  }
  out.sort((a, b) => a.bodyId - b.bodyId);
  return out;
}

export function loadSpeciesDatabase(): SpeciesDatabase {
  const root = getProjectRoot();
  clearExoOrganicGenusMinDistCache();
  cachedDb = loadSpeciesDatabaseFromTree(root);
  speciesDataGeneration += 1;
  computeBodyCache.clear();
  cachedPrices = loadPriceList(root);
  if (!cachedDb.species.length) {
    console.warn("ED Exo Compare — no species loaded; add data/species/<genus>/… (*_new.json or *.json)");
  }
  return cachedDb;
}

export function getCachedSpeciesDatabase(): SpeciesDatabase {
  return cachedDb;
}

export function getCachedPriceIndex(): PriceIndex {
  return cachedPrices;
}

export function buildEncyclopediaPayload(): EncyclopediaSpeciesRowDTO[] {
  const root = getProjectRoot();
  if (!cachedDb.species.length) {
    cachedDb = loadSpeciesDatabaseFromTree(root);
  }
  return cachedDb.species.map((entry) => {
    const { photoUrl, photoNote } = resolveSpeciesPhoto(entry, root);
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
      photoUrl,
      photoNote,
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
  const sk = scanBodyKey(b.systemAddress, b.bodyId);
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
  for (const m of matches) {
    if (m.entry.predictionUnsupported || m.unlikely) continue;
    const dir = m.entry.genusDataDir;
    if (!dir || byDir.has(dir)) continue;
    byDir.set(dir, m.entry.genus?.trim() || dir);
  }
  const genera = [...byDir.values()].sort((x, y) => x.localeCompare(y));
  const candidateGenera = genera.length;
  if (candidateGenera === 0) return null;

  const status =
    candidateGenera === signalCount
      ? "certain"
      : candidateGenera < signalCount
        ? "underCovered"
        : "ambiguous";
  return { status, signalCount, candidateGenera, genera };
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

  const confirmedIds = new Set(collectResolvedOrganicLockSpeciesIds(b.organicGenusLocks, db));
  const known = [
    ...new Set(db.species.filter((e) => confirmedIds.has(e.id)).map((e) => e.genusDataDir)),
  ].filter((g) => candidates.includes(g));

  return genusLikelihoods(table, candidates, signalCount, known)?.likelihoods ?? null;
}

/**
 * The ranking model's answer, written onto the matches.
 *
 * `rankSpeciesOnBody` normalises across the candidates, which answers "which one species is this".
 * The game places one genus per biological signal, so a candidate's chance of being *present* is
 * that share times the count — the same constraint step 7 applies at genus level, and the reason the
 * number calibrates. Without a signal count the share is left as it is, which under-reads on a
 * multi-signal body and is the honest thing to do when the game has not said how many are down there.
 *
 * Only the shown tier is ranked. A demoted row disagreed with a gate, and normalising it alongside
 * the others would hand it a share of a probability the panel does not offer it.
 */
function attachPresenceProbability(
  matches: SpeciesMatch[],
  b: BodyExoState,
  scan: PlanetScan | null,
  rec: ExplorationScanRecord | null,
  journalHost: JournalHostStarObservation | null,
  root: string,
): void {
  if (!scan) return;
  const shown = matches.filter((m) => !m.unlikely);
  if (shown.length === 0) return;
  const { ranked } = rankSpeciesOnBody(shown, scan, rec, journalHost, { root });
  if (ranked.length === 0) return;

  const signals = b.biologicalSignals;
  const scale = signals != null && Number.isFinite(signals) && signals > 0 ? signals : 1;
  for (const r of ranked) {
    const p = Math.max(0, Math.min(1, r.probability * scale));
    r.match.presenceProbabilityPercent = Math.round(p * 1000) / 10;
  }

  /**
   * The same posterior, normalised inside each genus instead of across the body (B3).
   *
   * After a DSS the game has named the genera, so "is Bacterium here" is settled and the only open
   * question is which Bacterium. That is this number, and it is worth computing before the DSS too —
   * it is what the answer becomes the moment the genus is confirmed.
   */
  const rows = ranked.map((r) => ({ genus: r.match.entry.genusDataDir, probability: r.probability, r }));
  const shares = genusShares(rows);
  for (const row of rows) {
    const share = shares.get(row);
    row.r.match.genusSharePercent = share == null ? null : Math.round(share * 1000) / 10;
  }
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
    organic: organicProgressSignature(store, b.key),
    species: speciesDataGeneration,
    footCatalog: footScannedCatalogSignature(root),
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
  const explorationRec = store.physicsExplorationScan(scanBodyKey(b.systemAddress, b.bodyId));
  const signature = computeBodyCacheSignature(b, store, explorationRec, root);
  const cached = computeBodyCache.get(b.key);
  if (cached && cached.signature === signature) return cached.value;

  const value = computeBodyUncached(b, db, prices, store);
  if (computeBodyCache.size >= COMPUTE_BODY_CACHE_MAX) computeBodyCache.clear();
  computeBodyCache.set(b.key, { signature, value });
  return value;
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
  const explorationRec = store.physicsExplorationScan(scanBodyKey(b.systemAddress, b.bodyId));
  const mergedScan = mergeScanForExomastery(b.scan, explorationRec);

  if (!mergedScan?.PlanetClass?.trim()) {
    const speciesMatchCtx = buildSpeciesMatchContext(b, store);
    const { alerts: exoDataAlerts, dssGenusOrphanHints } = computeExoDataAlertsForBody({
      body: b,
      mergedScan,
      matches: [],
      speciesMatchCtx,
      db,
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
    biologicalSignals: b.biologicalSignals,
  });
  const scanForExo = mergedScan;
  const bodyScanDetail = buildBodyScanExomasteryDetail(mergedScan, explorationRec);
  let matches: SpeciesMatch[] = raw.map((m) => {
    const { photoUrl, photoNote } = resolveSpeciesPhoto(m.entry, root);
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
      priceCredits,
      organicAnalysisComplete: store.isOrganicAnalysisCompleteForEntry(b.key, m.entry),
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
    );
    matches = markExomasteryZeroHabitatMatches(matches);
  }
  attachPresenceProbability(matches, b, scanForExo, explorationRec, journalHost, root);
  attachCodexNovelty(matches, store);
  attachOtherMatchCardScores(matches, scanForExo, explorationRec, root, journalHost);
  applyExomasteryGenusCompetitivePercent(matches);
  if (matches.length > 0 && scanForExo) {
    matches = attachOtherMatchDetailCardsToMatches(matches, scanForExo, explorationRec, root, journalHost);
  }
  let note = ambiguityForBody(b);
  if (approximateMatchingUsed && matches.length > 0) {
    // The only remaining source of approximate rows is an on-foot ScanOrganic naming a species the
    // gates rejected — evidence from the commander's own boots, not a distance guess.
    const extra =
      "Includes at least one species confirmed by an on-foot scan that the codex gates would have excluded.";
    note = note ? `${note} ${extra}` : extra;
  }

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
        )
      : null;

  // Evidence for the next gate fix: a species the commander confirmed here that we never offered.
  // Writes once per (body, species) and never throws.
  recordExoOutliersForBody({ body: b, matches, db });

  const { alerts: exoDataAlerts, dssGenusOrphanHints } = computeExoDataAlertsForBody({
    body: b,
    mergedScan,
    matches,
    speciesMatchCtx,
    db,
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
    exoPayoutRange,
    exoDataAlerts,
    dssGenusOrphanHints,
  };
}

/** Unsold exobiology (3× Analyse in journal): list ×5 on first-footfall bodies (else ×1) — same multiplier as map tier/heuristic when footfall applies. */
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
  return { credits, pendingSamples: store.pendingOrganicSales.length };
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
    const parts = p.bodyKey.split(":");
    const bodyIdPart = parts.length >= 2 ? parts[1]! : "";
    const bodyName = body?.bodyName ?? (bodyIdPart ? `Body ${bodyIdPart}` : p.bodyKey);
    const starSystem = body?.starSystem ?? store.currentSystem ?? "—";
    const base = lookupPrice(prices, p.label, p.label);
    const firstFootfall = store.firstFootfallBodies.has(p.bodyKey);
    const mult: 1 | 5 = firstFootfall ? 5 : 1;
    const valueCredits = base != null ? base * mult : 0;
    const entry = db.species.find((e) => speciesEntryMatchesOrganicLabel(e, p.label));
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

export function buildSnapshot(
  store: GameStateStore,
  journalPath: string | null,
  journalDir: string,
  bindHost: string,
  port: number,
  lanUrls: string[],
  journalFileCount: number,
  journalBoot: JournalBootProgressDTO | null = null,
): AppSnapshot {
  const bootLoading = journalBoot != null;
  const db = cachedDb;
  const { credits: organicDataValueCredits, pendingSamples: organicPendingSampleCount } =
    organicDataValuation(store, cachedPrices);
  const explorationScanDataValueCredits = estimateExplorationJournalDataCredits(store);
  const exploreBreakdown = explorationDataValueBreakdown(store);
  const organicPendingLines = bootLoading ? [] : buildOrganicPendingLines(store, db, cachedPrices);
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
          buildSystemMapSnapshot(store, focusAddr, db, cachedStarRoles!, cachedPrices),
        );
  const dScanBodies = bootLoading
    ? null
    : buildDScanBodiesSnapshot(store, focusAddr, dScanNameFallback, systemMap);

  const recsForPrimary =
    !bootLoading && focusAddr != null
      ? (() => {
          const fromJournal = [...store.explorationScans.entries()]
            .filter(([key]) => key.startsWith(`${focusAddr}:`))
            .map(([, v]) => v);
          if (fromJournal.length > 0) return fromJournal;
          return [...store.edsmExplorationByKey.entries()]
            .filter(([key]) => key.startsWith(`${focusAddr}:`))
            .map(([, v]) => v);
        })()
      : [];
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
        [...loadFootScannedCatalog(projectRoot).entries].sort((a, b) =>
          b.recordedAt.localeCompare(a.recordedAt),
        ),
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
    viewingSystemAddress: store.viewingSystemAddress,
    viewingSystemName,
    journalSystems,
    bodies,
    speciesCount: db.species.length,
    lastJournalEventIso: store.lastEventIso,
    organicDataValueCredits,
    organicPendingSampleCount,
    organicPendingLines,
    fssAllBodiesFoundNoBio,
    includeBacteriumInSearch: store.includeBacteriumInSearch,
    includeExplorationScanDataInDataValue: store.includeExplorationScanDataInDataValue,
    explorationScanDataValueCredits,
    explorationFssScanCount: exploreBreakdown.fssScanCount,
    onSiteTiming: timingFromSamples(store.landingMinutesSamples, store.samplingMinutesSamples),
    exoOutliers: exoOutlierTally(),
    explorationFssValueCredits: exploreBreakdown.fssValueCredits,
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
    focusedSystemUndiscoveredFromLastFsdJump:
      !bootLoading && focusAddr != null && store.fsdJumpWasDiscoveredBySystem.get(focusAddr) === false,
    remainingJumpsInRoute: bootLoading ? null : store.remainingJumpsInRoute,
    liveShipFuelRange: bootLoading ? null : buildLiveShipFuelRangeDTO(store, cachedStarRoles!),
    footTravelOdometerEnabled: store.footTravelOdometerEnabled,
    footTravelOdometerTracking: bootLoading ? false : store.footTravelOdometerTracking,
    footTravelDistanceMeters: bootLoading ? 0 : store.footTravelDistanceMeters,
    exoOrganicOverlay: bootLoading ? null : buildExoOrganicOverlayDto(store, cachedPrices),
  };
}

loadSpeciesDatabase();
