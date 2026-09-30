import path from "node:path";
import {
  achievementDetail,
  achievementExists,
  achievementsList,
  clearAchievementsCache,
} from "./achievements.js";
import {
  buildCodexExport,
  buildExomasteryExport,
  clearSharedExomasteryCache,
  commanderIdHash,
  exportFileName,
  ownCodexBackupKeys,
} from "./sharedExomastery.js";
import { ownFootEntriesWithBackups } from "./footScannedCatalog.js";
import { existsSync, watchFile, unwatchFile, writeFileSync, readFileSync, promises as fsp, watch, statSync } from "node:fs";
import type { AppSnapshot, AppStatusDTO, ExoLiveDTO, ImportDumpStatusDTO, JournalBootProgressDTO, JournalLine } from "../shared/types.js";
import { journalHistoryCutoffUtcMs } from "../shared/journalHistoryPreset.js";
import { clampStatusPollMs, pollRatesDto } from "../shared/pollRates.js";
import { radarRadiusDto } from "../shared/radarRadius.js";
import { mergeCollectionFocus } from "../shared/collectionFocus.js";
import {
  clearCollectionFocusCache,
  loadCollectionFocusConfig,
  saveCollectionFocusConfig,
  type CollectionFocusConfig,
} from "./collectionFocus.js";
import { openUrlInBrowser, openLauncherShell, openLocalFile } from "./openUrl.js";
import { GameStateStore } from "./gameState.js";
import {
  startJournalWatcher,
  readJournalFull,
  readJournalFromOffset,
  listJournalFilesChronological,
  type JournalListFilterOpts,
  type JournalWatcherHandle,
} from "./journalWatcher.js";
import { scanJournalsForStatistics } from "./statisticsScan.js";
import { createHttpServer, getLanIPv4s } from "./httpServer.js";
import { describeUserDataMigration, migrateLegacyUserData } from "./userDataMigration.js";
import { applyPendingRestore } from "./backup.js";
import { createBackupService } from "./backupService.js";
import { APP_VERSION } from "./appVersion.js";
import {
  edsmCredentialsStatus,
  forgetEdsmCredentials,
  readEdsmCredentials,
  saveEdsmCredentials,
} from "./edsmCredentials.js";
import { EdsmAutoFetcher } from "./edsmAutoFetch.js";
import { CANONN_CLIENT_VERSION, CanonnUploader } from "./canonnUpload.js";
import { EddnUploader } from "./eddnUpload.js";
import { lanUrlWithKey, loadOrCreateLanKey } from "./lanAuth.js";
import { buildEncyclopediaExomasteryPlanetsPayload } from "./exomasteryEdsmEncyclopedia.js";
import {
  buildEncyclopediaPayload,
  clearEncyclopediaPayloadCache,
  buildSnapshot,
  organicLiveSummary,
  findSpeciesEntryForEncyclopedia,
  getCachedSpeciesDatabase,
  loadSpeciesDatabase,
  getCachedPrices,
} from "./snapshot.js";
import { writeExoDataAlertFixFiles } from "./exoDataAlertFix.js";
import { buildFeederStatus } from "./feederStatus.js";
import { openFeeder } from "../feeder/pipeline.js";
import { formatImportReport, importSpanshExport } from "../feeder/spanshImport.js";
import { feederDataDirExists } from "../feeder/paths.js";
import { clearExomasteryProfileCache } from "./exomasteryProfile.js";
import { regionalRarity } from "./speciesRarityData.js";
import { createGamePresence } from "./gamePresence.js";
import { buildFieldGuide, clearFieldGuideCache } from "./fieldGuide.js";
import { clearSpeciesPhotoCache } from "./speciesPhotos.js";
import { buildDiscoveries } from "./discoveries.js";
import {
  clearFootCatalogSpeciesDb,
  clearFootScannedCatalogCache,
  flushFootScannedCatalog,
} from "./footScannedCatalog.js";
import { clearHostStarObservationsCache } from "./speciesHostStarObservations.js";
import { clearPlanetClassObservationsCache } from "./speciesPlanetClassObservations.js";
import { clearStarlightRangesCache } from "./starlightRanges.js";
import { clearBodyTypePriorCache } from "./bodyTypePrior.js";
import { clearGenusPhotosFolderCache, getSpeciesDataWarnings } from "./speciesTreeLoader.js";
import {
  parseStatusJsonDestination,
  parseStatusJsonFootFix,
  parseStatusJsonFuel,
  readStatusJsonFootFixText,
} from "./footTravelStatus.js";
import { parseNavRouteJson } from "./navRouteFuel.js";
import { getProjectRoot, resolveLanKeyPath, resolveUserSettingsJsonPath, resolveExoOutlierLogPath, USER_SETTINGS_FILENAME, getSpeciesDataDir, reapplySpeciesDataDirDiscoveryFromDisk, resolveImportDumpLedgerPath } from "./paths.js";
import { persistJournalDirPreference, resolveInitialJournalDir } from "./journalDirPreference.js";
import {
  buildExoMinimapDto,
  buildExoOrganicOverlayDto,
  ingestExoOrganicJournalLine,
  restoreOrganicSessionFromJournal,
} from "./exoOrganicTracker.js";
import { clearEddsnColourVariantsCache } from "./eddsnColourVariants.js";
import { clearPhotoCreditsCache } from "./photoCredits.js";
import { clearRegionSpeciesCache } from "./regionSpeciesData.js";
import { perfTime, startPerfReporter } from "./perf.js";
import { loadOrganicSampleSessionFromDisk } from "./organicSampleSessionFile.js";
import {
  buildJournalFileManifest,
  removeJournalMergeCache,
  saveJournalMergeCache,
  tryPrepareJournalCacheLoad,
} from "./journalMergeCache.js";
import { fetchEdsmBodiesAsExplorationRecords, searchEdsmSystemsByName } from "./edsmSystemHydration.js";
import { fetchSpanshBodiesAsExplorationRecords, searchSpanshSystemsByName } from "./spanshSystemHydration.js";
import { SessionLog } from "./sessionLog.js";
import { backlogMap, firstDiscoveryBacklogWithDistance } from "./firstDiscoveryBacklog.js";
import { galaxySpeciesCatalogue, galaxyValueSearch } from "./galaxyValueSearch.js";
import { galaxyBodyScan, galaxyRegions } from "./galaxyBodyScan.js";
import { loadBioIndex } from "./bioIndex.js";
import { mySystemDetail, mySystemsDto, sessionRouteDto } from "./galaxyMine.js";
import { commanderSectorsDto } from "./galaxySectorTiers.js";
import { runEdsmCatchUp, type EdsmCatchUpScope } from "./edsmCatchUp.js";
import { createUpdateChecker } from "./updateCheck.js";
import { fetchRemoteSystem, readRemoteSystemsCache, writeRemoteSystemToCache } from "./remoteSystems.js";
import { parseHost, parsePort } from "./cliOptions.js";
import type { CliOptions } from "./cliOptions.js";
import { showEdexoNativeFixInfo, logFatal, assertResourceLayout } from "./startupChecks.js";
import { backfillCommanderPosition } from "./commanderPositionBackfill.js";
import { createNoticesService, type CodexFirstFind, type NoticesContext } from "./notices.js";
import { createBookmarksService } from "./bookmarks.js";
import { createSavedBoxels } from "./savedBoxels.js";
import { createGreenGiantMarks, greenGiantForRecord, type GreenGiantSources } from "./greenGiants.js";
import { setNotableOptionsProvider } from "./notableOptions.js";
import { BODY_FEATURES } from "../shared/bodyFeatures.js";
import type { NotifySettingsDTO } from "../shared/notices.js";
import { queryPoi, readPoiStatus } from "./edastroPoi.js";
import { queryCarriers, readCarrierStatus } from "./edastroCarriers.js";
import { edastroGreenFor, nearbyNsp, nspK10Systems } from "./edastroNsp.js";
import { nspOutlook } from "./nspOutlook.js";
import { regionForSystem } from "./regionMapData.js";
import { fetchGalacticRecords, galacticRecords, readGalacticRecordsStatus } from "./galacticRecords.js";
import {
  applyPersistedUserPrefs as applyUserPrefs,
  persistUserPreferences as writeUserPrefs,
  tryReadUserPrefs,
  type PersistedUserPrefs,
} from "./userPrefsFile.js";
export { backfillCommanderPosition } from "./commanderPositionBackfill.js";
export { logFatal, assertResourceLayout } from "./startupChecks.js";
export { parseHost, parsePort, parseCli } from "./cliOptions.js";
export type { CliOptions } from "./cliOptions.js";

export type EdexoRuntime = {
  ready: Promise<void>;
  shutdown: () => Promise<void>;
  /** A backup is being written: Electron asks before an exit throws it away (backupService.ts). */
  backupRunning: () => boolean;
  whenBackupDone: () => Promise<void>;
  /**
   * Whether Elite is running, for the HUD overlays (hidden while it is not; gamePresence.ts).
   * The callback runs on every change; returns an unsubscribe.
   */
  onGameRunning: (cb: (running: boolean) => void) => () => void;
  gameRunning: () => boolean | null;
  getLocalBaseUrl: () => string;
  openMainAppInBrowser: () => void;
};

/**
 * Everything read from the species tree and the exomastery profiles, forgotten in one place.
 *
 * Three reload paths (the species-tree watcher, "Refresh exomastery", and the Fix dialog's clear)
 * each kept their own list and the lists had drifted: after a refresh the host-star and planet-class
 * observations — built from the profiles — kept answering from the old ones until a restart, and the
 * watcher path dropped the foot catalog's unwritten rows (code review A8, 2026-09-27). The catalog is
 * written first now, so clearing its cache cannot lose a find.
 */
function reloadSpeciesDerivedCaches(): void {
  flushFootScannedCatalog();
  clearFootScannedCatalogCache();
  clearFootCatalogSpeciesDb();
  clearExomasteryProfileCache();
  clearEncyclopediaPayloadCache();
  clearFieldGuideCache();
  clearSpeciesPhotoCache();
  clearGenusPhotosFolderCache();
  clearEddsnColourVariantsCache();
  clearPhotoCreditsCache();
  clearRegionSpeciesCache();
  clearHostStarObservationsCache();
  clearPlanetClassObservationsCache();
  clearStarlightRangesCache();
  clearBodyTypePriorCache();
  clearAchievementsCache();
}

export async function startEdexo(cli: CliOptions): Promise<EdexoRuntime> {
  assertResourceLayout();
  startPerfReporter();

  // Before anything reads user data: fold in whatever the old Electron directory still holds (§47).
  for (const line of describeUserDataMigration(migrateLegacyUserData())) console.log(line);
  // A restore chosen in the launcher is staged, not applied, while the app runs: it lands here, at the
  // next start, before anything below reads the app data (backup.ts).
  try {
    for (const line of applyPendingRestore(path.dirname(resolveUserSettingsJsonPath()))) console.log(line);
  } catch (e) {
    console.error("restore: could not apply the staged restore:", e);
  }

  const projectRoot = getProjectRoot();
  const updateChecker = createUpdateChecker();

  let journalDir = resolveInitialJournalDir(projectRoot);
  let journalPath: string | null = null;
  let journalFilesMerged = 0;

  function readLiveNavRouteWaypoints() {
    try {
      return parseNavRouteJson(readFileSync(path.join(journalDir, "NavRoute.json"), "utf8"));
    } catch {
      return null;
    }
  }

  const store = new GameStateStore();
  /*
    The radar's memory, before any journal is read.

    The owner's ask: "overlay/radar should read Status.json + latest Journal logs on launch". The
    journal half happens anyway — the replay below picks up Touchdown and puts the ship back — and
    Status.json is polled from the first tick. This is the half neither of those can supply: where
    the plants were, which exists only because a previous run of this app recorded it.

    Loaded first so a journal replay can overwrite it with something newer rather than the other way
    round.
  */
  store.loadSurfaceMarksFromDisk();

  /** Re-read `NavRoute.json` + `Status.json` after a full journal replay (new log file / resync). */
  function refreshLiveHudFromJournalDir(): void {
    store.applyLiveNavRoute(readLiveNavRouteWaypoints());
    try {
      const raw = readFileSync(path.join(journalDir, "Status.json"), "utf8");
      const fuel = parseStatusJsonFuel(raw);
      store.applyLiveShipFuel(fuel != null ? fuel.fuelMain : null, fuel != null ? fuel.fuelReserve : null);
    } catch {
      store.applyLiveShipFuel(null, null);
    }
  }

  const userSettingsPath = resolveUserSettingsJsonPath();
  const legacyUserSettingsPath = path.join(projectRoot, USER_SETTINGS_FILENAME);

  // The settings file lives in userPrefsFile.ts; these keep the old names for the wiring below.
  const persistUserPreferences = (): void => writeUserPrefs(store, userSettingsPath);
  const applyPersistedUserPrefs = (j: PersistedUserPrefs): void => applyUserPrefs(store, j);

  {
    const primary = tryReadUserPrefs(userSettingsPath);
    if (primary) {
      applyPersistedUserPrefs(primary);
    } else {
      const legacy = tryReadUserPrefs(legacyUserSettingsPath);
      if (legacy) {
        applyPersistedUserPrefs(legacy);
        persistUserPreferences();
      }
    }
  }

  const { bindHost, port, shouldOpenMainUI, quietConsole, useShellLauncher } = cli;

  /**
   * `0.0.0.0` means every device on the network can reach the mutating endpoints, so a bind that
   * wide gets an access key. A loopback bind gets none — there is nothing there a local process
   * could not already do.
   */
  const lanExposed = bindHost === "0.0.0.0";
  const lanKey = lanExposed ? loadOrCreateLanKey(resolveLanKeyPath()) : null;
  const lanUrlsWithKey = (): string[] => getLanIPv4s(port).map((u) => lanUrlWithKey(u, lanKey));

  let journalBootProgress: JournalBootProgressDTO | null = {
    percent: 0,
    phase: "starting",
    filesDone: 0,
    filesTotal: 0,
    message: "Starting journal service…",
  };

  const sessionLog = new SessionLog();
  /* "Notify me" (guild tester report, 2026-09-30): the mail icon's notices and the record marks. */
  const notices = createNoticesService({
    filePath: path.join(path.dirname(resolveUserSettingsJsonPath()), "edexo-notices.json"),
  });
  const savedBoxels = createSavedBoxels({
    filePath: path.join(path.dirname(resolveUserSettingsJsonPath()), "edexo-boxels.json"),
  });
  const bookmarks = createBookmarksService({
    filePath: path.join(path.dirname(resolveUserSettingsJsonPath()), "edexo-bookmarks.json"),
  });
  /* Green gas giants (owner, 2026-09-30): the commander's own calls, and what the verdict reads. */
  const greenMarks = createGreenGiantMarks({
    filePath: path.join(path.dirname(resolveUserSettingsJsonPath()), "edexo-ggg-marks.json"),
  });
  const bodiesInSystem = function* (addr: number) {
    yield* store.liveScansInSystem(addr);
    yield* store.soldScansInSystem(addr);
  };
  const greenExtras = { k10FromEdastro: nspK10Systems, edastroGreenFor, bodiesInSystem, marks: greenMarks };
  const greenSources = (): GreenGiantSources => ({
    ...greenExtras,
    greenCodexBodies: store.greenCodexBodies,
    k10Systems: store.k10Systems,
  });
  const scanOf = (k: string) => store.explorationScans.get(k) ?? store.soldExplorationScans.get(k) ?? null;
  /** The arrival star's type (distance 0), else the lowest-numbered star scanned: the phenomena model's main star. */
  const mainStarTypeOf = (addr: number): string | null => {
    let best: { id: number; type: string; arrival: boolean } | null = null;
    for (const r of [...store.liveScansInSystem(addr), ...store.soldScansInSystem(addr)]) {
      if (!r.starType) continue;
      const arrival = r.distanceFromArrivalLs === 0;
      if (!best || (arrival && !best.arrival) || (arrival === best.arrival && r.bodyId < best.id)) {
        best = { id: r.bodyId, type: r.starType, arrival };
      }
    }
    return best?.type ?? null;
  };
  // The Notable card: green gas giants always (they are notable like an Earth-like), features as chosen.
  setNotableOptionsProvider(() => {
    const on = notices.prefs().features;
    return {
      green: greenExtras,
      features: new Set(BODY_FEATURES.filter((f) => on[f.key]).map((f) => f.key)),
    };
  });
  const noticesContext: NoticesContext = {
    isKnownBody: (k) => store.explorationScans.has(k) || store.soldExplorationScans.has(k),
    allScans: function* () {
      yield* store.explorationScans.values();
      yield* store.soldExplorationScans.values();
    },
    currentSystem: () => ({ name: store.currentSystem ?? "", address: store.currentSystemAddress ?? null }),
    loadoutJumpLy: () => store.loadoutMaxJumpRangeLy,
    // Both read the commander's own EDAstro downloads; with none fetched they find nothing.
    nearbyPois: (origin, radiusLy, groups) =>
      queryPoi({ origin, groups, limit: 50 })
        .filter((r) => r.distanceLy != null && r.distanceLy <= radiusLy)
        .map((r) => ({ key: r.key, name: r.name, system: r.system, typeLabel: r.typeLabel, distanceLy: r.distanceLy! })),
    nearbyCarriers: (origin, radiusLy) =>
      queryCarriers({ origin, limit: 100 })
        .filter((r) => r.distanceLy != null && r.distanceLy <= radiusLy)
        .map((r) => ({
          callsign: r.callsign,
          name: r.name,
          system: r.system,
          systemAddress: r.systemAddress,
          distanceLy: r.distanceLy!,
          lastSeenDays: r.lastSeenDays,
          services: r.services,
        })),
    nearbyNsps: (origin, radiusLy) => nearbyNsp(origin, radiusLy),
    galacticRecord: (key) => galacticRecords().get(key) ?? null,
    greenGiant: (rec) => greenGiantForRecord(rec, greenSources()),
    scanOf,
  };
  const notifySettings = (): NotifySettingsDTO => ({
    prefs: notices.prefs(),
    jumpLy: notices.jumpLy(noticesContext),
    poiDataReady: readPoiStatus().haveData,
    carrierDataReady: readCarrierStatus().haveData,
  });
  const getSnapshot = () =>
    perfTime("buildSnapshot", () => {
      const snap = buildSnapshot(
        store,
        journalPath,
        journalDir,
        bindHost,
        port,
        lanExposed ? lanUrlsWithKey() : [],
        journalFilesMerged,
        journalBootProgress,
        sessionLog.toDto(),
      );
      snap.notices = notices.snapshot(store.viewingSystemAddress ?? store.currentSystemAddress ?? null);
      {
        // The NSP card (2026-09-30): what he saw, what EDAstro has, else a guess from the neighbourhood.
        const addr = store.viewingSystemAddress ?? store.currentSystemAddress ?? null;
        snap.nspOutlook =
          addr == null
            ? null
            : perfTime("snap.nspOutlook", () =>
                nspOutlook({
                  systemAddress: addr,
                  position: store.systemPositions.get(addr) ?? null,
                  seen: store.nspSeen.get(addr) ?? [],
                  region: (() => {
                    const pos = store.systemPositions.get(addr);
                    return pos ? regionForSystem(getProjectRoot(), pos.x, pos.y, pos.z) : (snap.currentRegion?.name ?? null);
                  })(),
                  starType: mainStarTypeOf(addr),
                }),
              );
      }
      // [CODEX FIRST] candidates in the system he is in go to the bell, once each (owner, 2026-09-30).
      if (!snap.journalBoot && store.currentSystemAddress != null && notices.prefs().codexFirst) {
        const finds: CodexFirstFind[] = [];
        for (const b of snap.bodies ?? []) {
          if (b.state.systemAddress !== store.currentSystemAddress) continue;
          for (const m of b.matches ?? []) {
            if (!m.codexFirst || m.unlikely || !m.codexRegion) continue;
            finds.push({
              bodyKey: b.state.key,
              systemAddress: b.state.systemAddress,
              system: b.state.starSystem || store.currentSystem || "",
              body: b.tabLabel || b.state.bodyName,
              species: m.entry.displayName,
              speciesId: m.entry.id,
              colours: m.codexFirstColours ?? [],
              region: m.codexRegion,
            });
          }
        }
        if (finds.length && notices.announceCodexFirst(finds, new Date().toISOString())) {
          snap.notices = notices.snapshot(store.viewingSystemAddress ?? store.currentSystemAddress ?? null);
        }
      }
      snap.bookmarksHere = bookmarks.forSystem(
        store.viewingSystemAddress ?? store.currentSystemAddress ?? null,
        snap.viewingSystemName ?? store.currentSystem ?? null,
      );
      return snap;
    });

  /**
   * Launcher-sized status. Reads store fields directly — no snapshot build, no one-shot state.
   */
  /*
    "Import Spansh export" from the launcher. Same importer and gates as `feeder -- import-dump`;
    runs in the background because the file is gigabytes, and one at a time because the feeder
    store is a single in-memory database written back on persist.
  */
  let importDump: ImportDumpStatusDTO = {
    running: false,
    file: null,
    apply: false,
    startedAt: null,
    finishedAt: null,
    report: null,
    error: null,
    lastImport: readImportDumpLedger(),
  };
  function readImportDumpLedger(): ImportDumpStatusDTO["lastImport"] {
    try {
      const j = JSON.parse(readFileSync(resolveImportDumpLedgerPath(), "utf8")) as Record<string, unknown>;
      if (j && typeof j.file === "string" && typeof j.finishedAt === "string") {
        return {
          file: j.file,
          finishedAt: j.finishedAt,
          fileMtimeIso: typeof j.fileMtimeIso === "string" ? j.fileMtimeIso : null,
          apply: j.apply === true,
        };
      }
    } catch {
      /* no import yet */
    }
    return null;
  }
  function fileMtimeIso(file: string | null | undefined): string | null {
    if (!file) return null;
    try {
      return statSync(file).mtime.toISOString();
    } catch {
      return null;
    }
  }
  function importDumpStatusFor(file?: string | null): ImportDumpStatusDTO {
    const last = importDump.lastImport ?? null;
    const asked = file && file.trim() ? file.trim() : (last?.file ?? null);
    const mtime = fileMtimeIso(asked);
    const newerOnDisk =
      !!last && !!asked && !!mtime && !!last.fileMtimeIso && asked === last.file && mtime > last.fileMtimeIso;
    return { ...importDump, fileMtimeIso: mtime, newerOnDisk };
  }
  const startImportDump = (file: string, apply: boolean): { ok: boolean; error?: string } => {
    if (importDump.running) return { ok: false, error: "An import is already running." };
    if (!feederDataDirExists())
      return { ok: false, error: "No feeder corpus on this machine — this is a build-side tool." };
    if (!existsSync(file)) return { ok: false, error: `File not found: ${file}` };
    importDump = {
      running: true,
      file,
      apply,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      report: null,
      error: null,
    };
    void (async () => {
      try {
        const ctx = await openFeeder();
        const report = await importSpanshExport(ctx.store, file, { apply });
        const finishedAt = new Date().toISOString();
        const lastImport = { file, finishedAt, fileMtimeIso: fileMtimeIso(file), apply };
        try {
          writeFileSync(resolveImportDumpLedgerPath(), JSON.stringify(lastImport), "utf8");
        } catch {
          /* the status still says it; only the memory across runs is lost */
        }
        importDump = {
          ...importDump,
          running: false,
          finishedAt,
          report: formatImportReport(report, apply),
          failures: report.failures.length,
          matched: report.matched,
          changed: report.changed,
          lastImport,
        };
      } catch (e) {
        importDump = {
          ...importDump,
          running: false,
          finishedAt: new Date().toISOString(),
          error: e instanceof Error ? e.message : String(e),
        };
      }
    })();
    return { ok: true };
  };

  /**
   * Show a system the journals know nothing about, from Spansh (owner, 2026-09-25). The 30-day cache
   * answers first; a fetch is marked "loading" so the screen can say so, and a failure says why.
   * A system with any bio body or mappable scan of his own is never replaced by somebody else's data.
   */
  async function ensureRemoteSystem(systemAddress: number, starSystem: string): Promise<void> {
    if (store.hasMappableJournalExplorationForSystem(systemAddress)) return;
    if (store.remoteSystems.has(systemAddress)) return;
    if (store.remoteLookups.get(systemAddress)?.state === "loading") return;
    const cached = readRemoteSystemsCache().find((r) => r.systemAddress === systemAddress);
    if (cached) {
      store.remoteSystems.set(systemAddress, cached);
      push();
      return;
    }
    store.remoteLookups.set(systemAddress, { starSystem, state: "loading" });
    push();
    const r = await fetchRemoteSystem(systemAddress, starSystem);
    if (r.ok) {
      store.remoteSystems.set(systemAddress, r.system);
      store.remoteLookups.delete(systemAddress);
      writeRemoteSystemToCache(r.system);
    } else {
      store.remoteLookups.set(systemAddress, { starSystem, state: "error", error: r.error });
    }
    push();
  }

  /** The same two rules before either galaxy source fills a system's map. */
  function hydrateGate(systemAddress: number, source: string): { ok: false; error: string } | null {
    if (!store.isKnownJournalSystem(systemAddress)) {
      return { ok: false, error: "That system is not present in merged journal data." };
    }
    if (store.hasMappableJournalExplorationForSystem(systemAddress)) {
      return {
        ok: false,
        error: `Journal already has mappable scan data for this system — no ${source} supplement needed.`,
      };
    }
    return null;
  }

  const getStatus = (): AppStatusDTO => {
    let journalDirConfiguredOk = false;
    try {
      journalDirConfiguredOk = existsSync(journalDir) && statSync(journalDir).isDirectory();
    } catch {
      journalDirConfiguredOk = false;
    }
    return {
      mode: lanExposed ? "server" : "client",
      bindHost,
      port,
      lanUrls: lanExposed ? lanUrlsWithKey() : [],
      lanKeyRequired: lanKey != null,
      journalDir,
      journalDirConfiguredOk,
      journalPath,
      journalFileCount: journalFilesMerged,
      journalHistoryPreset: store.journalHistoryPreset,
      lastJournalEventIso: store.lastEventIso,
      commanderName: store.commanderName,
      journalBoot: journalBootProgress,
      speciesDataWarnings: getSpeciesDataWarnings(),
      pollRates: pollRatesDto(store.statusPollMs, store.journalPollMs),
      radarRadius: radarRadiusDto(store.minimapRadiusM),
      live: organicLiveSummary(store),
    };
  };

  let broadcast: (s: AppSnapshot) => void = () => {};

  /**
   * Broadcast, then consume the one-shot UI auto-select key.
   *
   * The consume used to live inside buildSnapshot, which /api/state and the launcher poll also
   * called — whichever poller arrived first swallowed the key, so "focus the body you just
   * scanned" silently failed and, with two clients, at most one ever saw it.
   */
  const broadcastSnapshot = () => {
    broadcast(getSnapshot());
    store.clearPendingUiAutoSelectBodyKey();
  };

  /**
   * Coalesce journal-driven pushes: fire at once when idle, then at most one per window while
   * events stream in. At 100 ms a single FSS sweep produced ten full snapshot builds per second.
   */
  const PUSH_WINDOW_MS = 250;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPushAt = 0;
  const pushFlush = () => {
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    lastPushAt = Date.now();
    broadcastSnapshot();
  };
  const push = () => {
    if (pushTimer) return;
    const sinceLast = Date.now() - lastPushAt;
    if (sinceLast >= PUSH_WINDOW_MS) {
      pushFlush();
      return;
    }
    pushTimer = setTimeout(() => {
      pushTimer = null;
      lastPushAt = Date.now();
      broadcastSnapshot();
    }, PUSH_WINDOW_MS - sinceLast);
  };

  let bootMergeLastFlush = 0;
  const pushMergeProgress = () => {
    const t = Date.now();
    if (t - bootMergeLastFlush < 110) return;
    bootMergeLastFlush = t;
    pushFlush();
  };

  let watcher: JournalWatcherHandle | null = null;
  let footStatusPollTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * The `Status.json` tick, kept as a value so the interval can be re-armed at a new rate without
   * rebuilding the closure it lives in (it owns the jump-key memo, which must survive a retime).
   */
  let footStatusTick: (() => void) | null = null;
  /** The interval the armed timer was created with; see {@link armFootStatusPoll}. */
  let footStatusArmedMs = 0;

  /**
   * The radar's frame, for {@link ExoLiveDTO}.
   *
   * Deliberately not `getSnapshot()`. These two builders read the store and the price index and
   * nothing else; the snapshot rebuilds every body, every match and every derived list to arrive at
   * the same two fields, which is why the radar was pinned to the 250 ms coalescing window.
   */
  const buildExoLive = (): ExoLiveDTO => ({
    exoOrganicOverlay: buildExoOrganicOverlayDto(store, getCachedPrices()),
    exoMinimap: buildExoMinimapDto(
      store,
      store.exoOrganicTracker?.bodyKey ?? store.overlayTouchdownBodyKey,
      store.exoOrganicTracker ? Math.max(0, Math.round(store.exoOrganicTracker.minSampleDistanceM)) : 0,
    ),
  });

  /**
   * `Status.json`, driven by the game's own writes instead of by the clock.
   *
   * A poll can only ever be a guess at when the game wrote: slower and the HUD lags, faster and it
   * re-reads bytes that have not changed. Watching the directory turns it round — the read happens
   * because the game wrote, and lands within milliseconds of it.
   *
   * It does not make the data fast, because the data is not fast. measured on 2026-09-18 while running, jumping and turning on foot: the file is rewritten about 0.7 times a second and its *contents* change about 0.33 times a second, median gap 3.0 s, fastest 2.0 s.
   * So this is about *latency*, not rate: it removes the delay we were adding, and nothing more.
   * Anything smoother than 0.33 Hz on screen has to be predicted, not polled for.
   *
   * The **directory** rather than the file: a watch on the file itself dies if the game ever
   * replaces it rather than rewriting in place, and comes back attached to an inode nobody writes
   * to again, which is a HUD that silently stops updating.
   *
   * The interval stays as a backstop. `fs.watch` is best-effort on Windows — it can miss events
   * under load, and it does not exist at all on some network paths — so the poll is what guarantees
   * the HUD keeps moving; the watch is what makes it prompt.
   */
  let footStatusFsWatcher: ReturnType<typeof watch> | null = null;
  /** Coalesces the duplicate events one write produces, and caps the work a busy file can cause. */
  let lastFootStatusRunAt = 0;
  const FOOT_STATUS_MIN_GAP_MS = 40;

  function runFootStatusTickFromWatch(): void {
    if (footStatusTick == null) return;
    const now = Date.now();
    if (now - lastFootStatusRunAt < FOOT_STATUS_MIN_GAP_MS) return;
    lastFootStatusRunAt = now;
    try {
      footStatusTick();
    } catch (e) {
      console.error("[edexo-compare] Status.json watch tick:", e);
    }
  }

  function startFootStatusWatch(): void {
    footStatusFsWatcher?.close();
    footStatusFsWatcher = null;
    try {
      footStatusFsWatcher = watch(journalDir, { persistent: false }, (_ev, name) => {
        if (name && String(name).toLowerCase() !== "status.json") return;
        runFootStatusTickFromWatch();
      });
    } catch {
      /* no watch on this path; the interval below is still doing the job */
    }
  }

  /** (Re-)arm the `Status.json` poll at `store.statusPollMs`. A no-op when nothing moved. */
  function armFootStatusPoll(force = false): void {
    if (footStatusTick == null) return;
    const next = clampStatusPollMs(store.statusPollMs);
    if (!force && footStatusPollTimer != null && next === footStatusArmedMs) return;
    if (footStatusPollTimer != null) {
      clearInterval(footStatusPollTimer);
      footStatusPollTimer = null;
    }
    footStatusArmedMs = next;
    const tick = footStatusTick;
    footStatusPollTimer = setInterval(() => tick(), next);
  }

  /**
   * Both live-file poll rates, applied to the running timers at once.
   *
   * The whole point of the setting is that it takes effect now: the commander changes the number in
   * the launcher and the next tick is at the new rate, with no relaunch and no journal-pipeline
   * restart. Persisted only when something actually changed.
   */
  function applyPollRates(
    statusRaw: unknown,
    journalRaw: unknown,
  ): { statusPollMs: number; journalPollMs: number } {
    const changed = store.setPollRates(statusRaw, journalRaw);
    if (changed) {
      armFootStatusPoll();
      watcher?.retimePoll();
      persistUserPreferences();
    }
    return { statusPollMs: store.statusPollMs, journalPollMs: store.journalPollMs };
  }

  function getJournalListFilterOpts(): JournalListFilterOpts {
    return { minFileStartUtcMs: journalHistoryCutoffUtcMs(store.journalHistoryPreset) };
  }

  /**
   * Auto-hydration on jump (§50). Enabled only when the toggle is on **and** the commander has
   * stored their own EDSM key — the key is the consent, the toggle is the switch.
   */
  const edsmAutoFetcher = new EdsmAutoFetcher({
    isEnabled: () => store.edsmAutoFetchEnabled && readEdsmCredentials() !== null,
    needsHydration: (systemAddress, arrived) =>
      /*
       * On arrival the system is in the journal, so not knowing it means something is off and we
       * leave it alone. A jump destination is somewhere the commander has *not* been — that is the
       * whole point of asking early — so the journal-knows-it half of the gate cannot apply.
       */
      (arrived ? store.isKnownJournalSystem(systemAddress) : true) &&
      !store.hasMappableJournalExplorationForSystem(systemAddress),
    hydrate: async (systemAddress, systemName) => {
      const edsm = await fetchEdsmBodiesAsExplorationRecords(
        systemName,
        systemAddress,
        readEdsmCredentials(),
      );
      if (!edsm.ok) return { ok: false, error: edsm.error };
      store.replaceEdsmExplorationForSystem(systemAddress, edsm.records);
      push();
      return { ok: true };
    },
  });

  /**
   * One catch-up at a time.
   *
   * Two concurrent runs would both start from the same watermark and send the whole history twice —
   * harmless to EDSM, which discards duplicates, and exactly the kind of traffic a volunteer service
   * should not have to absorb from one client.
   */
  let edsmCatchUpRunning = false;
  let edsmCatchUpCancelled = false;

  /**
   * How often the live upload looks for new journal lines, and how far back it reaches.
   *
   * Three minutes because exploration data is not time-critical and a quiet tick costs nothing: the
   * discard list is cached for a day and unchanged journals are never opened, so a tick with no new
   * play makes no network request at all.
   *
   * A **week**, not everything. Wide enough to heal a gap from an app that was closed for a few days,
   * narrow enough that switching this on cannot silently start uploading four years — that is what
   * the button and its dropdown are for, and it should stay a deliberate act.
   */
  const EDSM_LIVE_INTERVAL_MS = 3 * 60 * 1000;
  const EDSM_LIVE_SCOPE = "week" as const;

  /**
   * One catch-up, whoever asked for it.
   *
   * The button and the timer go through here so there is exactly one place that decides whether a
   * run may start. Two runs would read the same watermark and send the history twice.
   */
  function startEdsmRun(scope: EdsmCatchUpScope, silent = false): { ok: boolean; error?: string } {
    if (!store.edsmUploadEnabled) return { ok: false, error: "Turn EDSM upload on first." };
    const credentials = readEdsmCredentials();
    if (!credentials) return { ok: false, error: "Store your EDSM commander name and API key first." };
    if (edsmCatchUpRunning) return { ok: false, error: "A catch-up is already running." };
    edsmCatchUpRunning = true;
    edsmCatchUpCancelled = false;
    void runEdsmCatchUp({
      journalDir,
      credentials,
      scope,
      isCancelled: () => edsmCatchUpCancelled,
      onProgress: (p) => {
        /*
          A live tick that found nothing does not touch the panel.

          Otherwise every three minutes the progress line would blink through "0 / 214 journals" and
          back, which reads as something going wrong. A tick that actually sends is worth showing.
        */
        if (silent && p.eventsSent === 0 && !p.error) return;
        store.setEdsmUploadProgress(p);
        push();
      },
    })
      .catch((e: unknown) => {
        // `runEdsmCatchUp` does not throw, so this is belt and braces — but a rejected promise that
        // left the flag set would make the button dead until a restart.
        console.error("[edsm] catch-up:", e);
      })
      .finally(() => {
        edsmCatchUpRunning = false;
        push();
      });
    return { ok: true };
  }

  /**
   * The live loop.
   *
   * Unref'd so it never holds the process open, and it asks `startEdsmRun` rather than checking the
   * switches itself — a commander who turns the upload off mid-tick gets the same refusal the button
   * would get.
   */
  const edsmLiveTimer = setInterval(() => {
    if (!store.edsmLiveUploadEnabled) return;
    startEdsmRun(EDSM_LIVE_SCOPE, true);
  }, EDSM_LIVE_INTERVAL_MS);
  edsmLiveTimer.unref?.();

  /**
   * Contributing discoveries back to Canonn, when the commander has asked for it.
   *
   * Off unless the toggle says otherwise, and fed only from the live tail — the historical replay
   * calls `store.apply` directly, which is what keeps switching it on from uploading four years of
   * journals in one burst. See `canonnUpload.ts` for what is sent and what the commander gives up.
   */
  const canonnUploader = new CanonnUploader({
    isEnabled: () => store.canonnUploadEnabled,
    cmdrName: () => store.commanderName,
    onResult: (ok) => store.recordCanonnUploadResult(ok),
    gameState: () => {
      const addr = store.currentSystemAddress;
      const pos = addr != null ? store.systemPositions.get(addr) : undefined;
      const name = store.currentSystem?.trim();
      if (!name) return null;
      return {
        systemName: name,
        ...(pos ? { systemCoordinates: [pos.x, pos.y, pos.z] as [number, number, number] } : {}),
        clientVersion: CANONN_CLIENT_VERSION,
        isBeta: false,
        platform: "PC" as const,
      };
    },
  });
  if (store.canonnUploadEnabled) void canonnUploader.loadWhitelist();

  /**
   * Sending live events to EDDN, when the commander has asked for it. Same live-only arrangement as
   * Canonn: `offer` is called from the live tail only. After every re-merge the sender re-learns the
   * session (game version, expansion flags, current system) from the newest journal file through
   * `observe` — see `primeEddnFromNewestJournal` — and that path never sends.
   */
  const eddnUploader = new EddnUploader({
    isEnabled: () => store.eddnUploadEnabled,
    cmdrName: () => store.commanderName,
    onResult: (ok) => store.recordEddnUploadResult(ok),
    testMode: process.env.EDEXO_EDDN_TEST === "1",
    readStatus: () => {
      try {
        return JSON.parse(readFileSync(path.join(journalDir, "Status.json"), "utf8")) as Record<
          string,
          unknown
        >;
      } catch {
        return null;
      }
    },
    readNavRoute: () => {
      try {
        return JSON.parse(readFileSync(path.join(journalDir, "NavRoute.json"), "utf8")) as unknown;
      } catch {
        return null;
      }
    },
  });

  /** Re-learn the session from the newest log without sending anything. */
  async function primeEddnFromNewestJournal(): Promise<void> {
    eddnUploader.resetSession();
    if (!journalPath) return;
    try {
      await readJournalFull(journalPath, (line) => eddnUploader.observe(line));
    } catch {
      /* the sender stays unprimed, which means it sends nothing until the next Fileheader */
    }
  }

  /**
   * `StartJump` is the countdown and names the destination; the rest are arrivals.
   *
   * Asking at the countdown spends the hyperspace transit on the request instead of making the
   * commander wait once they are already there. A `StartJump` with `JumpType: "Supercruise"` names
   * no system and is ignored.
   */
  function maybeAutoFetchOnArrival(line: JournalLine): void {
    const event = line.event;
    const systemName = typeof line.StarSystem === "string" ? line.StarSystem : "";
    const systemAddress = typeof line.SystemAddress === "number" ? line.SystemAddress : NaN;
    if (!systemName || !Number.isFinite(systemAddress)) return;
    if (event === "StartJump") {
      if (line.JumpType !== "Hyperspace") return;
      edsmAutoFetcher.onJumpStarted(systemAddress, systemName);
      return;
    }
    if (event !== "FSDJump" && event !== "CarrierJump" && event !== "Location") return;
    edsmAutoFetcher.onArrivedInSystem(systemAddress, systemName);
  }

  function createLiveJournalLine(): (line: JournalLine) => void {
    return (line: JournalLine) => {
      try {
        // Before the store applies it: a body the store already has is a re-scan, not a find.
        notices.observe(line, noticesContext);
        store.apply(line);
        // Live lines only. The historical replay calls store.apply directly, which is what keeps a
        // first run from asking EDSM about every system the commander has ever visited.
        maybeAutoFetchOnArrival(line);
        canonnUploader.offer(line);
        eddnUploader.offer(line);
        store.applyLiveNavRoute(readLiveNavRouteWaypoints());
        let statusRaw: string | null = null;
        try {
          statusRaw = readFileSync(path.join(journalDir, "Status.json"), "utf8");
        } catch {
          statusRaw = null;
        }
        const footFix = statusRaw ? parseStatusJsonFootFix(statusRaw) : null;
        ingestExoOrganicJournalLine(store, line, footFix, projectRoot, getCachedSpeciesDatabase());
        sessionLog.record(line, store, getCachedPrices());
        backupService.onJournalLine(typeof line.event === "string" ? line.event : undefined);
        gamePresence.onJournalLine(typeof line.event === "string" ? line.event : undefined);
        push();
      } catch (e) {
        console.error("Journal live line failed (skipped line):", e);
      }
    };
  }

  /*
    Boot timing (owner, 2026-09-13, "startup speed"): every phase of the journal resync is clocked
    and one console line reports them, so a slow start can be read off the log instead of guessed.
  */
  const bootClock = { t0: 0, marks: [] as Array<[string, number]>, last: 0 };
  const bootStart = (): void => {
    bootClock.t0 = performance.now();
    bootClock.last = bootClock.t0;
    bootClock.marks = [];
  };
  const bootMark = (label: string): void => {
    const now = performance.now();
    bootClock.marks.push([label, now - bootClock.last]);
    bootClock.last = now;
  };
  const bootReport = (path: string): void => {
    if (quietConsole) return;
    const total = performance.now() - bootClock.t0;
    const parts = bootClock.marks.map(
      ([l, ms]) => `${l} ${ms >= 1000 ? (ms / 1000).toFixed(1) + " s" : Math.round(ms) + " ms"}`,
    );
    console.info(`Journal boot (${path}): ${parts.join(" · ")} · total ${(total / 1000).toFixed(1)} s`);
  };

  /**
   * The in-flight full re-merge, so two callers can never run one at once.
   *
   * {@link resyncAllJournalFilesInner} begins with `store.resetAll()` and then spends about fifteen
   * seconds re-reading every log into that store. Two of them overlapping is not slow, it is
   * **destructive**: the second wipes what the first has built, and whichever finishes last writes
   * the remains to the cache as a complete merge. The commander's 19,000-body history came back as
   * 215 bodies and one codex species that way, recorded as all 271 files merged.
   *
   * The watcher is the usual source of a second call (see its own guard), but it is not the only
   * one — `restartJournalPipeline` and a journal-folder change call this too, and a guard that only
   * lives in the watcher would leave those free to collide with it. Callers share the running
   * promise instead of starting a rival: they all want the same thing, which is a store that has
   * finished merging.
   */
  let resyncInFlight: Promise<void> | null = null;

  function resyncAllJournalFiles(): Promise<void> {
    if (resyncInFlight) return resyncInFlight;
    // The EDDN sender learns the session from the newest file after every re-merge: a rotation
    // replays the new file's Fileheader and LoadGame here, where the live tail never sees them.
    const run = resyncAllJournalFilesInner()
      .then(primeEddnFromNewestJournal)
      .finally(() => {
        resyncInFlight = null;
      });
    resyncInFlight = run;
    return run;
  }

  async function resyncAllJournalFilesInner(): Promise<void> {
    bootStart();
    store.resetAll();
    notices.invalidate();
    journalBootProgress = {
      percent: 4,
      phase: "listing",
      filesDone: 0,
      filesTotal: 0,
      message: "Reading Elite Dangerous journal folder…",
    };
    pushFlush();
    const files = await listJournalFilesChronological(journalDir, getJournalListFilterOpts());
    bootMark(`list ${files.length} files`);
    journalFilesMerged = files.length;
    if (files.length === 0) {
      journalPath = null;
      journalBootProgress = null;
      removeJournalMergeCache(projectRoot);
      refreshLiveHudFromJournalDir();
      pushFlush();
      return;
    }

    const journalDirNorm = path.normalize(journalDir);
    journalBootProgress = {
      percent: 12,
      phase: "listing",
      filesDone: 0,
      filesTotal: files.length,
      message: `Checking ${files.length} journal log file(s) against the cache…`,
    };
    pushFlush();
    const manifest = await buildJournalFileManifest(files);
    bootMark("manifest");
    const cacheResult =
      process.env.EDEXO_DISABLE_JOURNAL_CACHE === "1"
        ? { hit: false as const }
        : tryPrepareJournalCacheLoad(
            projectRoot,
            journalDirNorm,
            files,
            manifest,
            store.journalHistoryPreset,
          );

    if (cacheResult.hit) {
      journalBootProgress = {
        percent: 35,
        phase: "merging",
        filesDone: 0,
        filesTotal: files.length,
        message: "Restoring merged journal state from cache…",
      };
      pushFlush();
      /**
       * A payload the store cannot read is a cache miss, not an empty history. Falling through to
       * the full replay is the only safe answer: carrying on would apply the new journal lines to an
       * empty store and then save that over a good cache.
       */
      bootMark("cache read");
      const hydrated = store.hydrateJournalMergePayload(cacheResult.payload);
      bootMark("hydrate");
      if (!hydrated) {
        // Leave the store as `resyncAllJournalFiles` found it and fall through to the full replay.
        store.resetAll();
        if (!quietConsole) {
          console.warn("Journal cache could not be read — rebuilding from the logs.");
        }
      } else {
        if (cacheResult.steps.length > 0) {
          const stepCount = cacheResult.steps.length;
          let stepsDone = 0;
          journalBootProgress = {
            percent: 70,
            phase: "merging",
            filesDone: 0,
            filesTotal: stepCount,
            message: `Applying ${stepCount} journal log file(s) written since the last run…`,
          };
          pushFlush();
          for (const step of cacheResult.steps) {
            if (step.kind === "tail") {
              await readJournalFromOffset(step.path, step.startByte, (line) => store.apply(line));
            } else {
              await readJournalFull(step.path, (line) => store.apply(line));
            }
            stepsDone += 1;
            journalBootProgress = {
              percent: 70 + Math.floor((25 * stepsDone) / stepCount),
              phase: "merging",
              filesDone: stepsDone,
              filesTotal: stepCount,
              message: `Applying new journal lines — file ${stepsDone} of ${stepCount}…`,
            };
            pushMergeProgress();
          }
          bootMark(`replay ${stepCount} new file(s)`);
        } else {
          journalBootProgress = {
            percent: 90,
            phase: "merging",
            filesDone: files.length,
            filesTotal: files.length,
            message: "Journal unchanged since the last run — finishing up…",
          };
          pushFlush();
        }
        await backfillCommanderPosition(store, files);
        bootMark("position backfill");
        journalPath = files[files.length - 1]!;
        store.resetFootTravelRuntime();
        loadOrganicSampleSessionFromDisk(projectRoot, store, getCachedSpeciesDatabase());
        journalBootProgress = null;
        refreshLiveHudFromJournalDir();
        pushFlush();
        bootMark("session + first push");
        if (cacheResult.steps.length > 0 || cacheResult.loadedFromLegacy) {
          saveJournalMergeCache(journalDirNorm, manifest, store, projectRoot, store.journalHistoryPreset);
          bootMark("cache save");
        }
        bootReport("cache");
        if (!quietConsole) {
          const s = cacheResult.steps.length;
          if (s === 0 && !cacheResult.loadedFromLegacy) {
            console.info(
              "Journal fast path: full cache hit (log set unchanged) — skipped replaying all files.",
            );
          } else if (s === 0 && cacheResult.loadedFromLegacy) {
            console.info(
              "Journal fast path: full cache hit — journal cache moved to app data (survives rebuilds).",
            );
          } else {
            console.info(
              `Journal fast path: cache + ${s} incremental replay step(s); state saved to app data cache.`,
            );
          }
        }
        return;
      }
    }

    journalBootProgress = {
      percent: 15,
      phase: "merging",
      filesDone: 0,
      filesTotal: files.length,
      message: `Merging ${files.length} journal log file(s) (oldest → newest)…`,
    };
    pushFlush();
    bootMergeLastFlush = Date.now();
    for (let i = 0; i < files.length; i++) {
      await readJournalFull(files[i]!, (line) => store.apply(line));
      const done = i + 1;
      const pct = 15 + Math.floor((80 * done) / files.length);
      journalBootProgress = {
        percent: Math.min(pct, 95),
        phase: "merging",
        filesDone: done,
        filesTotal: files.length,
        message: `Merging journal logs — file ${done} of ${files.length}…`,
      };
      pushMergeProgress();
    }
    journalPath = files[files.length - 1]!;
    store.resetFootTravelRuntime();
    loadOrganicSampleSessionFromDisk(projectRoot, store, getCachedSpeciesDatabase());
    journalBootProgress = null;
    refreshLiveHudFromJournalDir();
    pushFlush();
    saveJournalMergeCache(journalDirNorm, manifest, store, projectRoot, store.journalHistoryPreset);
  }

  async function restartJournalPipeline(): Promise<void> {
    if (watcher) {
      await watcher.close();
      watcher = null;
    }
    await resyncAllJournalFiles();
    const seed =
      journalPath !== null ? { path: journalPath, size: (await fsp.stat(journalPath)).size } : null;
    watcher = startJournalWatcher(
      journalDir,
      createLiveJournalLine(),
      resyncAllJournalFiles,
      seed,
      getJournalListFilterOpts,
      () => store.journalPollMs,
    );
  }

  async function applyNewJournalDirectory(nextRaw: string): Promise<{ ok: boolean; error?: string }> {
    const next = path.normalize(nextRaw.trim());
    if (!next || !existsSync(next)) {
      return { ok: false, error: "Path does not exist." };
    }
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(next);
    } catch {
      return { ok: false, error: "Cannot read path." };
    }
    if (!st.isDirectory()) {
      return { ok: false, error: "Journal path must be a folder." };
    }

    journalDir = next;
    persistJournalDirPreference(next);
    process.env.ED_JOURNAL_DIR = next;

    await restartJournalPipeline();
    // The Status.json watch is bound to the old folder; without this the HUD would keep waiting for
    // writes that now happen somewhere else, and fall back to the interval without saying so.
    startFootStatusWatch();
    pushFlush();
    return { ok: true };
  }

  let speciesDataWatchRoot = getSpeciesDataDir(projectRoot);
  const priceListPath = path.join(projectRoot, "data", "price-list.json");

  /**
   * The recursive fs.watch on data/species fires once per touched file — boot alone reloaded the
   * species database ~110 times, each pass re-parsing all 19 genus JSON files and forcing a push.
   * Coalesce bursts into one reload.
   */
  const SPECIES_RELOAD_DEBOUNCE_MS = 300;
  let speciesReloadTimer: ReturnType<typeof setTimeout> | null = null;
  const onSpeciesTreeOrPricesChange = () => {
    if (speciesReloadTimer) clearTimeout(speciesReloadTimer);
    speciesReloadTimer = setTimeout(() => {
      speciesReloadTimer = null;
      reloadSpeciesDerivedCaches();
      loadSpeciesDatabase();
      push();
    }, SPECIES_RELOAD_DEBOUNCE_MS);
  };

  let speciesFsWatcher: ReturnType<typeof watch> | null = null;
  let speciesPollFallback = false;

  /** Re-scan portable / species-data-dir.json, then move the species tree watcher if the dir changed. */
  function retargetSpeciesDataWatcherIfNeeded(): void {
    reapplySpeciesDataDirDiscoveryFromDisk();
    const next = getSpeciesDataDir(projectRoot);
    if (next === speciesDataWatchRoot) return;
    speciesFsWatcher?.close();
    speciesFsWatcher = null;
    if (speciesPollFallback) {
      try {
        unwatchFile(speciesDataWatchRoot, onSpeciesTreeOrPricesChange);
      } catch {
        /* ignore */
      }
      speciesPollFallback = false;
    }
    speciesDataWatchRoot = next;
    try {
      speciesFsWatcher = watch(speciesDataWatchRoot, { recursive: true }, onSpeciesTreeOrPricesChange);
    } catch {
      watchFile(speciesDataWatchRoot, { interval: 1500 }, onSpeciesTreeOrPricesChange);
      speciesPollFallback = true;
    }
  }

  /** The launcher's Exomastery downloads; the backups put the same two files in every zip. */
  const exportOwn = (kind: "exomastery" | "codex") => {
    const commander = { name: store.commanderName, fid: commanderIdHash(store.commanderFid) };
    if (kind === "codex") {
      const keys = new Set([...store.codexRegionLogged, ...ownCodexBackupKeys()]);
      return { fileName: exportFileName("codex", commander.name), body: buildCodexExport(keys, commander) };
    }
    return {
      fileName: exportFileName("exomastery", commander.name),
      body: buildExomasteryExport(ownFootEntriesWithBackups(getProjectRoot()), commander),
    };
  };

  const getStatisticsScan = async () =>
    scanJournalsForStatistics(await listJournalFilesChronological(journalDir, getJournalListFilterOpts()));

  /*
    Prepared in the background a while after start (UI review P7, 2026-09-29), so the first open of
    Statistics and the Encyclopedia is instant instead of "Reading your journals…" for seconds: the
    statistics parts for every journal but the one being written to, and the Encyclopedia's rows.
    Late enough not to compete with the journal boot and the first pushes.
  */
  const WARM_UP_AFTER_BOOT_MS = 20_000;
  let warmUpTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleWarmUp = () => {
    if (warmUpTimer != null) clearTimeout(warmUpTimer);
    warmUpTimer = setTimeout(() => {
      warmUpTimer = null;
      try {
        buildEncyclopediaPayload();
        buildFieldGuide(projectRoot, getCachedSpeciesDatabase());
      } catch {
        /* the Encyclopedia builds on open instead */
      }
      void getStatisticsScan().catch(() => {
        /* Statistics scans on open instead */
      });
    }, WARM_UP_AFTER_BOOT_MS);
    warmUpTimer.unref?.();
  };

  // The process check only matters to the desktop app's overlays; a plain server does not poll.
  const gamePresence = createGamePresence({ autoStart: process.env.EDEXO_ELECTRON === "1" });

  const backupService = createBackupService({
    appDataDir: path.dirname(userSettingsPath),
    getJournalDir: () => journalDir,
    getCommander: () => store.commanderName,
    appVersion: APP_VERSION,
    exports: () => [exportOwn("exomastery"), exportOwn("codex")],
  });

  const {
    server,
    broadcast: broadcastFn,
    broadcastExoLive,
    listening,
  } = createHttpServer({
    backup: backupService,
    port,
    bindHost,
    lanKey,
    getSnapshot,
    getStatus,
    getCommanderPosition: () => store.commanderPos,
    getFirstDiscoveryBacklog: () => firstDiscoveryBacklogWithDistance(store),
    getBacklogMap: () => backlogMap(store),
    getDiscoveries: () => buildDiscoveries(store, getProjectRoot(), greenExtras),
    searchGalaxyByValue: (query, limit) => galaxyValueSearch({ ...query, from: store.commanderPos, limit }),
    getGalaxySpecies: () => galaxySpeciesCatalogue(),
    getGalaxyRegions: () => galaxyRegions(),
    scanGalaxyBodies: (query, limit) => galaxyBodyScan({ ...query, from: store.commanderPos, limit }),
    getCommanderSectors: () => commanderSectorsDto(store),
    getMySystems: () => mySystemsDto(store, backlogMap(store)),
    getMySystem: (addr) => mySystemDetail(store, addr, backlogMap(store), loadBioIndex()),
    getSessionRoute: () => sessionRouteDto(store, sessionLog.toDto().systems),
    getJournalStore: () => store,
    getCodexMapLogged: () => store.codexMapLogged,
    getAchievements: () => achievementsList(getProjectRoot(), store, getCachedSpeciesDatabase().species),
    getAchievementDetail: (id) =>
      achievementDetail(getProjectRoot(), store, getCachedSpeciesDatabase().species, id),
    trackAchievement: (id) => {
      if (
        id !== null &&
        !achievementExists(getProjectRoot(), store, getCachedSpeciesDatabase().species, id)
      ) {
        return false;
      }
      store.setTrackedAchievement(id);
      persistUserPreferences();
      return true;
    },
    getCommanderSystem: () => store.currentSystem,
    setHudPrefs: (raw) => {
      store.setHudPrefs(raw);
      persistUserPreferences();
    },
    setPollRates: (statusMs, journalMs) => applyPollRates(statusMs, journalMs),
    getCollectionFocus: () => loadCollectionFocusConfig(),
    getNotifySettings: notifySettings,
    bookmarks,
    savedBoxels,
    ownGreenGiants: () => {
      const out: { x: number; y: number; z: number; body: string; system: string }[] = [];
      const src = greenSources();
      const keys = new Set([...store.greenCodexBodies.keys(), ...[...greenMarks.all()].filter(([, m]) => m.mark === "yes").map(([k]) => k)]);
      for (const k of keys) {
        const rec = scanOf(k);
        const pos = rec ? store.systemPositions.get(rec.systemAddress) : undefined;
        if (!rec || !pos) continue;
        const v = greenGiantForRecord(rec, src);
        if (v?.level === "confirmed" && !v.gggNumber) out.push({ ...pos, body: rec.bodyName, system: rec.starSystem });
      }
      return out;
    },
    setGreenGiantMark: (systemAddress, bodyId, mark) => {
      const rec = scanOf(`${systemAddress}:${bodyId}`);
      if (!rec) return false;
      greenMarks.set(`${systemAddress}:${bodyId}`, mark, { body: rec.bodyName, system: rec.starSystem });
      return greenGiantForRecord(rec, greenSources());
    },
    getRecords: () => ({ rows: notices.records(noticesContext), galactic: readGalacticRecordsStatus() }),
    fetchGalacticRecords: async (force) => {
      await fetchGalacticRecords({ force });
      return { rows: notices.records(noticesContext), galactic: readGalacticRecordsStatus() };
    },
    systemPositionOf: (addr) => store.systemPositions.get(addr) ?? null,
    setNotifyPrefs: (raw) => {
      notices.setPrefs(raw);
      push();
      return notifySettings();
    },
    markNoticesRead: (ids) => {
      const n = notices.markRead(ids);
      if (n) push();
      return n;
    },
    markNoticesUnread: (ids) => {
      const n = notices.markUnread(ids);
      if (n) push();
      return n;
    },
    clearReadNotices: () => {
      const n = notices.clearRead();
      if (n) push();
      return n;
    },
    /*
      Clamped on the way in and the stored config handed straight back, so a figure the server
      refused shows up in the panel as the figure that will actually be used.

      The cache is cleared because the marker is memoised for a few seconds and a threshold the
      commander has just moved should take effect on the next body, not when a timer says so.
    */
    setCollectionFocus: (raw) => {
      const next = mergeCollectionFocus(
        loadCollectionFocusConfig(),
        (raw ?? {}) as Partial<CollectionFocusConfig>,
      );
      saveCollectionFocusConfig(next);
      clearCollectionFocusCache();
      push();
      return next;
    },
    setRadarRadiusM: (raw) => {
      /*
        Pushed as well as persisted. The radar is drawn from a field on its DTO, so a client that is
        not looking at a live fix right now would otherwise keep the old circle until the next
        sample — and the commander changing this is, by definition, looking at the radar.
      */
      if (store.setMinimapRadiusM(raw)) {
        persistUserPreferences();
        lastFootStatusRunAt = Date.now();
        if (store.exoOrganicTracker || store.overlayTouchdownBodyKey) broadcastExoLive(buildExoLive());
        push();
      }
      return store.minimapRadiusM;
    },
    setIncludeBacterium: (v) => {
      store.setIncludeBacteriumInSearch(v);
      persistUserPreferences();
    },
    setIncludeExplorationScanData: (v) => {
      store.setIncludeExplorationScanDataInDataValue(v);
      persistUserPreferences();
    },
    setFootTravelOdometer: (v) => {
      store.setFootTravelOdometerEnabled(v);
      persistUserPreferences();
    },
    setPhotoStamp: (p) => {
      store.setPhotoStamp(p);
      persistUserPreferences();
    },
    setExoMapTierThresholds: (plus, pp) => {
      store.setExoMapTierThresholds(plus, pp);
      persistUserPreferences();
    },
    /*
      The launcher's "open in browser" and "phone view". The path is chosen here from a two-value
      enum rather than taken from the caller, so the route cannot be used to launch anything but
      this app's own views.
    */
    openAppView: (view) => {
      const url = view === "phone" ? `http://127.0.0.1:${port}/?screen=triage` : `http://127.0.0.1:${port}/`;
      openUrlInBrowser(url);
      return { ok: true };
    },
    openExoMissLog: () => {
      const file = resolveExoOutlierLogPath();
      // The panel that offers this is hidden at zero misses, so a missing file means the log was
      // deleted between the snapshot and the click. Say which file rather than failing blankly —
      // the path is the useful half of the answer either way.
      if (!existsSync(file)) return { ok: false, error: `No miss log yet: ${file}` };
      openLocalFile(file);
      return { ok: true };
    },
    /*
      Everything the app holds in memory from `data/`, dropped together.

      This is the launcher's "Refresh exomastery", and it makes one promise: the files on disk are
      re-read. Three caches added later — the ED-DSN colour tables, the photo credits manifest and
      the region x species table — were never listed here, so editing any of those files and
      pressing the button did nothing at all, silently. The owner asked whether it still worked
      after a session of changes; it did not, for those three.

      Anything that memoises a file under `data/` belongs on this list. There is no mechanism that
      enforces that, which is why it is written down.
    */
    exportExomastery: exportOwn,
    reloadExomastery: () => {
      clearSharedExomasteryCache();
      retargetSpeciesDataWatcherIfNeeded();
      reloadSpeciesDerivedCaches();
      loadSpeciesDatabase();
      pushFlush();
    },
    writeExoDataAlertFix: (alert) => {
      const out = writeExoDataAlertFixFiles(getCachedSpeciesDatabase(), alert);
      if (out.ok) {
        loadSpeciesDatabase();
        pushFlush();
      }
      return out;
    },
    showFixStubNativeDialog: showEdexoNativeFixInfo,
    clearExomasteryProfileCache: () => {
      reloadSpeciesDerivedCaches();
    },
    resetExobiology: () => {
      store.resetExobiologyTracking();
    },
    setViewingSystem: (addr) => {
      store.setViewingSystemAddress(addr);
    },
    rememberVisitedSystem: (starSystem, systemAddress) => {
      store.rememberVisitedSystem(starSystem, systemAddress);
    },
    lookupSystem: (systemAddress, starSystem) => {
      void ensureRemoteSystem(systemAddress, starSystem);
    },
    setUiSelectedBodyKey: (key) => store.setUiSelectedBodyKeyFromClient(key),
    setJournalDirectory: applyNewJournalDirectory,
    setJournalHistoryPreset: async (preset) => {
      if (store.journalHistoryPreset === preset) {
        pushFlush();
        return;
      }
      store.setJournalHistoryPreset(preset);
      persistUserPreferences();
      await restartJournalPipeline();
      pushFlush();
    },
    searchEdsmSystems: (query) => searchEdsmSystemsByName(query),
    getStatisticsScan,
    searchSpanshSystems: (query) => searchSpanshSystemsByName(query),
    hydrateSystemFromEdsm: async (systemAddress, systemName) => {
      const gate = hydrateGate(systemAddress, "EDSM");
      if (gate) return gate;
      const edsm = await fetchEdsmBodiesAsExplorationRecords(
        systemName,
        systemAddress,
        readEdsmCredentials(),
      );
      if (!edsm.ok) return { ok: false, error: edsm.error };
      store.replaceEdsmExplorationForSystem(systemAddress, edsm.records);
      return { ok: true };
    },
    hydrateSystemFromSpansh: async (systemAddress, systemName) => {
      const gate = hydrateGate(systemAddress, "Spansh");
      if (gate) return gate;
      const sp = await fetchSpanshBodiesAsExplorationRecords(systemAddress, systemName);
      if (!sp.ok) return { ok: false, error: sp.error };
      store.replaceEdsmExplorationForSystem(systemAddress, sp.records);
      return { ok: true };
    },
    getEdsmCredentialsStatus: () => edsmCredentialsStatus(),
    setEdsmCredentials: (commanderName, apiKey) => {
      const r = saveEdsmCredentials(commanderName, apiKey);
      if (r.ok) persistUserPreferences();
      return r;
    },
    forgetEdsmCredentials: () => {
      forgetEdsmCredentials();
      // No key, no consent: the toggle goes down with it rather than sitting on waiting for one.
      store.setEdsmAutoFetchEnabled(false);
      persistUserPreferences();
    },
    setEdsmAutoFetchEnabled: (enabled) => {
      if (enabled && !readEdsmCredentials()) {
        return { ok: false, error: "Store your EDSM commander name and API key first." };
      }
      store.setEdsmAutoFetchEnabled(enabled);
      persistUserPreferences();
      return { ok: true };
    },
    setEdsmUploadEnabled: (enabled) => {
      if (enabled && !readEdsmCredentials()) {
        return { ok: false, error: "Store your EDSM commander name and API key first." };
      }
      store.setEdsmUploadEnabled(enabled);
      // Switching the upload off takes the live loop with it, the way deleting the key takes
      // auto-fetch down. A "keep sending" left on under a switch that says off is a lie waiting to
      // be believed the next time the upload is turned back on.
      if (!enabled) store.setEdsmLiveUploadEnabled(false);
      persistUserPreferences();
      return { ok: true };
    },
    startEdsmCatchUp: (scope) => startEdsmRun(scope),
    setEdsmLiveUploadEnabled: (enabled) => {
      if (enabled && !store.edsmUploadEnabled) {
        return { ok: false, error: "Turn EDSM upload on first." };
      }
      store.setEdsmLiveUploadEnabled(enabled);
      persistUserPreferences();
      return { ok: true };
    },
    cancelEdsmCatchUp: () => {
      edsmCatchUpCancelled = true;
    },
    setCanonnUploadEnabled: (enabled) => {
      store.setCanonnUploadEnabled(enabled);
      persistUserPreferences();
      // Asked for the first time it is switched on, not at boot: a commander who never turns this
      // on should not cost Canonn a request.
      if (enabled) void canonnUploader.loadWhitelist();
      return { ok: true };
    },
    setEddnUploadEnabled: (enabled) => {
      store.setEddnUploadEnabled(enabled);
      persistUserPreferences();
      return { ok: true };
    },
    scheduleBroadcast: push,
    getEncyclopedia: buildEncyclopediaPayload,
    getFieldGuide: () => buildFieldGuide(projectRoot, getCachedSpeciesDatabase()),
    getEncyclopediaRegion: (name) =>
      Object.fromEntries(
        getCachedSpeciesDatabase().species.map((e) => [e.id, regionalRarity(projectRoot, name, e.id)] as const),
      ),
    getFeederStatus: () => buildFeederStatus(projectRoot, getCachedSpeciesDatabase()),
    getUpdateInfo: (force) => updateChecker.check(force),
    openUpdatePage: () => {
      const url = updateChecker.updatePageUrl();
      if (!url) return { ok: false, error: "No newer version known." };
      openUrlInBrowser(url);
      return { ok: true };
    },
    startImportDump,
    getImportDumpStatus: (file?: string | null) => importDumpStatusFor(file),
    getEncyclopediaExomastery: (genusDir, speciesEntryId, focusBodyKey) => {
      const entry = findSpeciesEntryForEncyclopedia(genusDir, speciesEntryId);
      if (!entry) return null;
      const fb = focusBodyKey?.trim() || store.uiSelectedBodyKey || null;
      return buildEncyclopediaExomasteryPlanetsPayload(projectRoot, entry, store, fb);
    },
  });
  broadcast = broadcastFn;

  let readyResolve!: () => void;
  let readyReject!: (e: unknown) => void;
  let listeningSettled = false;
  const ready = new Promise<void>((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });

  /** Must await `listening` immediately — if it rejects before a consumer attaches, devEntry's
   * `unhandledRejection` handler exits the process and Electron shows nothing. */
  void (async () => {
    try {
      await listening;
      listeningSettled = true;
      pushFlush();

      const url = `http://${bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost}:${port}`;
      if (!quietConsole) {
        console.info(`ED Exo Compare — journal dir: ${journalDir}`);
        console.info(`HTTP + WS: ${url}`);
        if (lanExposed) {
          const lan = lanUrlsWithKey();
          if (lan.length) {
            console.info("On your phone (same Wi‑Fi):", lan.join("  "));
            console.info(
              "Other devices need the ?k= access key in that link; this PC never does. " +
                `Key file: ${resolveLanKeyPath()}`,
            );
          }
        }
      }

      const launcherUrl = `${url}/launcher.html`;
      if (useShellLauncher) {
        openLauncherShell(launcherUrl);
      }

      if (shouldOpenMainUI) openUrlInBrowser(url);

      readyResolve();

      await restartJournalPipeline();

      if (footStatusPollTimer != null) {
        clearInterval(footStatusPollTimer);
        footStatusPollTimer = null;
      }
      let lastJumpKey: string | null = null;
      const jumpChangedNow = (): boolean => {
        const jt = store.nextJumpTarget();
        const key = jt ? `${jt.source}|${jt.systemAddress}|${jt.starSystem}|${jt.arrived ? 1 : 0}` : "";
        if (key === lastJumpKey) return false;
        lastJumpKey = key;
        return true;
      };
      footStatusTick = () => {
        const navChanged = store.applyLiveNavRoute(readLiveNavRouteWaypoints());
        const jumpChanged = jumpChangedNow();
        const statusPath = path.join(journalDir, "Status.json");
        let raw: string;
        try {
          raw = readFileSync(statusPath, "utf8");
        } catch (e) {
          /*
            A locked or momentarily missing file is not news either — same reasoning as a torn read
            below. Elite holds the file briefly while rewriting it, and at a 100 ms poll plus a
            watch on every write we land in that window often. Reporting "no position" each time
            blanked the radar and re-armed the sample cue.
          */
          if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") return;
          store.exoOrganicLastFix = null;
          const hadDest = store.statusDestination != null;
          store.statusDestination = null;
          store.applyLiveShipFuel(null, null);
          const footHudEmpty = store.footTravelOdometerEnabled && store.footTravelOdometerTracking;
          if (footHudEmpty || store.exoOrganicTracker || navChanged || hadDest || jumpChanged) push();
          return;
        }
        /*
          A read that could not be parsed is skipped outright, not reported as "off the surface".

          Those are two different facts and they used to share one `null`. Elite rewrites this file
          in place, so reading it mid-write yields a truncated line — constantly, now that the read
          happens on every write as well as every 100 ms. Each one cleared `exoOrganicLastFix`,
          which blanked the radar for a frame and, worse, sent `nearestSampleMeetsMin` through
          `true -> null -> true`: an edge, so the HUD played the "far enough now" cue again. The
          owner heard it on every radar update instead of once per boundary crossing.
        */
        const read = readStatusJsonFootFixText(raw);
        if (read.kind === "unreadable") return;
        const fix = read.kind === "fix" ? read.fix : null;
        if (fix) {
          store.applyFootTravelSample(fix.latDeg, fix.lonDeg, fix.planetRadiusM, fix.bodyName);
          store.exoOrganicLastFix = fix;
        } else {
          store.exoOrganicLastFix = null;
        }
        // The targeted body: the HUD's candidate list, and a one-shot jump to its Body tab. Pushed
        // only when it actually changes — see `applyStatusDestination`.
        const destChanged = store.applyStatusDestination(parseStatusJsonDestination(raw));
        const fuel = parseStatusJsonFuel(raw);
        const fuelChanged = store.applyLiveShipFuel(
          fuel != null ? fuel.fuelMain : null,
          fuel != null ? fuel.fuelReserve : null,
        );
        /*
          The radar goes out on every tick, at the commander's chosen poll rate, whether or not
          anything else changed. It is the one thing on the HUD that has to move smoothly, and the
          coalesced `push()` below cannot carry it: that window exists because a full snapshot is
          expensive to build, and the radar's two fields are not.

          Identical frames are dropped inside the broadcaster, so standing still costs nothing.
        */
        if (store.exoOrganicTracker || store.overlayTouchdownBodyKey) broadcastExoLive(buildExoLive());

        const footHud = store.footTravelOdometerEnabled && store.footTravelOdometerTracking;
        if (footHud || store.exoOrganicTracker || fuelChanged || navChanged || destChanged || jumpChanged)
          push();
      };
      armFootStatusPoll(true);
      startFootStatusWatch();

      /*
        A sample already in progress when the app started.

        `ingestExoOrganicJournalLine` runs on live lines only — replaying four years of scans would
        fire a celebration for each — so a plant half-sampled while the app was closed was invisible
        and the overlay said zero scans. The owner scanned one and was told none.

        Only the newest log, and only back to the last landing: a sample happens in one visit to one
        surface. Count only — the positions are not in the journal and must not be guessed.
      */
      if (journalPath) {
        try {
          const tail: JournalLine[] = [];
          await readJournalFull(journalPath, (l) => tail.push(l));
          if (restoreOrganicSessionFromJournal(store, tail, projectRoot, getCachedSpeciesDatabase())) {
            pushFlush();
          }
        } catch {
          /* An unreadable log costs a restored count, never the boot. */
        }
      }

      pushFlush();

      if (!quietConsole) {
        console.info(`Merged ${journalFilesMerged} journal log file(s) (oldest → newest), tailing latest.`);
      }
      scheduleWarmUp();
    } catch (e) {
      if (!listeningSettled) {
        readyReject(e);
      } else {
        console.error(e);
        journalBootProgress = null;
        pushFlush();
      }
      if (process.env.EDEXO_ELECTRON === "1") {
        return;
      }
      if (!listeningSettled) {
        const msg = e instanceof Error ? e.message : String(e);
        logFatal(["ED Exo Compare — startup failed:", msg]);
      }
    }
  })();

  try {
    speciesFsWatcher = watch(speciesDataWatchRoot, { recursive: true }, onSpeciesTreeOrPricesChange);
  } catch {
    watchFile(speciesDataWatchRoot, { interval: 1500 }, onSpeciesTreeOrPricesChange);
    speciesPollFallback = true;
  }

  if (existsSync(priceListPath)) {
    watchFile(priceListPath, { interval: 800 }, onSpeciesTreeOrPricesChange);
  }

  await ready;

  const shutdown = async () => {
    if (warmUpTimer != null) clearTimeout(warmUpTimer);
    // The foot catalog writes at most once a second; closing must not drop the last second.
    flushFootScannedCatalog();
    backupService.dispose();
    gamePresence.dispose();
    if (footStatusPollTimer != null) {
      clearInterval(footStatusPollTimer);
      footStatusPollTimer = null;
    }
    footStatusFsWatcher?.close();
    footStatusFsWatcher = null;
    speciesFsWatcher?.close();
    if (speciesPollFallback) unwatchFile(speciesDataWatchRoot, onSpeciesTreeOrPricesChange);
    if (existsSync(priceListPath)) unwatchFile(priceListPath, onSpeciesTreeOrPricesChange);
    if (watcher) await watcher.close();
    await new Promise<void>((res) => {
      server.close(() => res());
    });
  };

  return {
    ready,
    shutdown,
    getLocalBaseUrl: () => `http://127.0.0.1:${port}`,
    openMainAppInBrowser: () => openUrlInBrowser(`http://127.0.0.1:${port}/`),
    backupRunning: () => backupService.isRunning(),
    whenBackupDone: () => backupService.whenIdle(),
    onGameRunning: (cb) => gamePresence.onChange(cb),
    gameRunning: () => gamePresence.running(),
  };
}

/**
 * Where the desktop app listens, given the launch mode and whatever was typed after the exe.
 *
 * The port used to be hard-coded at 7111 and `--port` was simply dropped — so a second instance
 * could not be started beside a running one, which is the first thing anyone tries, and the flag
 * looked accepted because nothing complained. Same shape as `--local` being ignored by the console
 * wrappers: a flag that is silently discarded is worse than one that is rejected.
 *
 * The **mode** still decides the address, because that is what `--local` and `--client` mean to
 * `electron/main.cjs`. `--host` and `--lan` override it only when actually present: `parseHost`
 * answers `0.0.0.0` for an empty argv, and taking that unconditionally would put a client-mode
 * window on the network.
 */
export function electronRuntimeOptions(
  mode: "server" | "client",
  argv: readonly string[],
): { bindHost: string; port: number } {
  const explicitHost = argv.includes("--host") || argv.includes("--lan");
  return {
    bindHost: explicitHost ? parseHost([...argv]) : mode === "server" ? "0.0.0.0" : "127.0.0.1",
    port: parsePort([...argv]),
  };
}

export async function startEdexoFromElectronMode(
  mode: "server" | "client",
  argv: readonly string[] = process.argv,
): Promise<EdexoRuntime> {
  process.env.EDEXO_ELECTRON = "1";
  return startEdexo({
    ...electronRuntimeOptions(mode, argv),
    shouldOpenMainUI: false,
    quietConsole: true,
    useShellLauncher: false,
  });
}
