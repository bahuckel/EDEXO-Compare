import path from "node:path";
import {
  existsSync,
  watchFile,
  unwatchFile,
  writeFileSync,
  readFileSync,
  promises as fsp,
  watch,
  statSync,
  readdirSync,
} from "node:fs";
import type {
  AppSnapshot,
  AppStatusDTO,
  ExoLiveDTO,
  ImportDumpStatusDTO,
  JournalBootProgressDTO,
  JournalLine,
} from "../shared/types.js";
import { journalHistoryCutoffUtcMs, parseJournalHistoryPreset } from "../shared/journalHistoryPreset.js";
import { clampStatusPollMs, pollRatesDto } from "../shared/pollRates.js";
import { radarRadiusDto } from "../shared/radarRadius.js";
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
import { createHttpServer, getLanIPv4s } from "./httpServer.js";
import { describeUserDataMigration, migrateLegacyUserData } from "./userDataMigration.js";
import {
  edsmCredentialsStatus,
  forgetEdsmCredentials,
  readEdsmCredentials,
  saveEdsmCredentials,
} from "./edsmCredentials.js";
import { EdsmAutoFetcher } from "./edsmAutoFetch.js";
import { CANONN_CLIENT_VERSION, CanonnUploader } from "./canonnUpload.js";
import { lanUrlWithKey, loadOrCreateLanKey } from "./lanAuth.js";
import { buildEncyclopediaExomasteryPlanetsPayload } from "./exomasteryEdsmEncyclopedia.js";
import {
  buildEncyclopediaPayload,
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
import { clearSpeciesPhotoCache } from "./speciesPhotos.js";
import { buildDiscoveries } from "./discoveries.js";
import { clearFootScannedCatalogCache } from "./footScannedCatalog.js";
import { clearGenusPhotosFolderCache, getSpeciesDataWarnings } from "./speciesTreeLoader.js";
import { parseStatusJsonDestination, parseStatusJsonFootFix, parseStatusJsonFuel } from "./footTravelStatus.js";
import { parseNavRouteJson } from "./navRouteFuel.js";
import {
  getProjectRoot,
  getWebRoot,
  resolveLanKeyPath,
  resolveUserSettingsJsonPath,
  resolveExoOutlierLogPath,
  USER_SETTINGS_FILENAME,
  getSpeciesDataDir,
  reapplySpeciesDataDirDiscoveryFromDisk,
  resolveImportDumpLedgerPath,
} from "./paths.js";
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
import { commanderSectorsDto } from "./galaxySectorTiers.js";
import { runEdsmCatchUp, type EdsmCatchUpScope } from "./edsmCatchUp.js";

/**
 * Recover the commander's galactic position when the merge cache did not carry one.
 *
 * `commanderPos` (§10.3) is read off `StarPos` on `FSDJump` / `Location`, and the merge cache stores
 * it — but every cache written before that field existed restores as `null`, and the fast path then
 * never replays a line that could fill it. The commander is left with no position until their next
 * jump, which silently disables **every** Phase 7 spatial gate: `demoteFailedSpatialGates` treats a
 * missing coordinate as "no verdict", so radialem, Bark Mounds, Brain Trees and Sinuous Tubers all
 * stay in the strict list no matter where the ship is.
 *
 * Rather than bump the cache format — which would force a full replay of every log for one field —
 * read the position back out of the newest logs. Newest first, stop at the first `StarPos` found,
 * and give up after a handful of files: a commander whose last twelve logs contain no jump and no
 * `Location` has no position to recover.
 */
export async function backfillCommanderPosition(store: GameStateStore, files: string[]): Promise<void> {
  if (store.commanderPos) return;
  const MAX_FILES = 12;
  for (let i = files.length - 1; i >= 0 && i >= files.length - MAX_FILES; i--) {
    // A holder rather than a plain `let`: TypeScript does not track assignments made inside a
    // callback, so a narrowed local would read as `null` after the loop and the branch below would
    // be dead code as far as the compiler is concerned.
    const hit: { pos: { x: number; y: number; z: number } | null } = { pos: null };
    try {
      // Keep the last hit in the file, not the first — the newest line wins.
      await readJournalFull(files[i]!, (line) => {
        const p = (line as Record<string, unknown>).StarPos;
        if (!Array.isArray(p) || p.length < 3) return;
        const [x, y, z] = p as unknown[];
        if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
        hit.pos = { x, y, z };
      });
    } catch {
      continue; // An unreadable log is not a reason to abandon the search.
    }
    if (hit.pos) {
      store.commanderPos = hit.pos;
      return;
    }
  }
}

const DEFAULT_JOURNAL =
  process.platform === "win32"
    ? path.join(process.env.USERPROFILE || "", "Saved Games", "Frontier Developments", "Elite Dangerous")
    : path.join(process.env.HOME || "", ".local/share/Frontier Developments/Elite Dangerous");

const PATHS_FILE = "edexo-compare-paths.json";

function showEdexoNativeFixInfo(message: string): boolean {
  if (process.env.EDEXO_ELECTRON !== "1") return false;
  try {
    const electron = require("electron") as typeof import("electron");
    electron.dialog.showMessageBoxSync({
      type: "info",
      title: "ED Exo Compare — Fix",
      message,
    });
    return true;
  } catch {
    return false;
  }
}

export function logFatal(lines: string[]): never {
  const text = lines.join("\n");
  console.error(text);
  try {
    const logPath = path.join(path.dirname(process.execPath), "edexo-compare-startup-error.log");
    writeFileSync(logPath, `${text}\n`, "utf8");
  } catch {
    /* ignore */
  }
  if (process.env.EDEXO_ELECTRON === "1") {
    throw new Error(text);
  }
  process.exit(1);
}

export function assertResourceLayout(): void {
  const root = getProjectRoot();
  const webRoot = getWebRoot(root);
  const indexHtml = path.join(webRoot, "index.html");
  const speciesTree = getSpeciesDataDir(root);
  const missing: string[] = [];
  if (!existsSync(indexHtml)) {
    missing.push(`UI not found: ${indexHtml}`);
  }
  if (!existsSync(speciesTree) || !statSync(speciesTree).isDirectory()) {
    missing.push(`Species data folder not found: ${speciesTree}`);
  } else {
    let hasGenusJson = false;
    try {
      for (const name of readdirSync(speciesTree)) {
        const p = path.join(speciesTree, name);
        if (!statSync(p).isDirectory()) continue;
        for (const f of readdirSync(p)) {
          if (f.toLowerCase().endsWith(".json") && f.toLowerCase() !== "package.json") {
            hasGenusJson = true;
            break;
          }
        }
        if (hasGenusJson) break;
      }
    } catch {
      hasGenusJson = false;
    }
    if (!hasGenusJson) {
      missing.push(
        `No genus .json under: ${speciesTree} — add data/species/<Genus>/<genus>.json (and optional <Genus>-notes.txt, <Genus>_photos/).`,
      );
    }
  }
  if (missing.length) {
    const lines = [
      "ED Exo Compare — cannot start.",
      ...missing,
      "",
      'Keep "web" and "data" next to the app; species live in data/species/<genus>/.',
      "(Development: npm run build)",
    ];
    if (process.env.EDEXO_ELECTRON === "1") {
      throw new Error(lines.join("\n"));
    }
    logFatal(lines);
  }
}

export function parseHost(argv: string[]): string {
  const i = argv.indexOf("--host");
  if (i >= 0 && argv[i + 1]) return argv[i + 1]!;
  if (argv.includes("--lan")) return "0.0.0.0";
  if (argv.includes("--local")) return "127.0.0.1";
  return "0.0.0.0";
}

export function parsePort(argv: string[]): number {
  const i = argv.indexOf("--port");
  if (i >= 0 && argv[i + 1]) return Number(argv[i + 1]) || 7111;
  return 7111;
}

export type CliOptions = {
  bindHost: string;
  port: number;
  shouldOpenMainUI: boolean;
  quietConsole: boolean;
  useShellLauncher: boolean;
};

export function parseCli(argv: string[]): CliOptions {
  return {
    bindHost: parseHost(argv),
    port: parsePort(argv),
    shouldOpenMainUI: argv.includes("--open"),
    quietConsole: process.env.EDEXO_ELECTRON === "1" || argv.includes("--quiet") || argv.includes("--gui"),
    useShellLauncher: process.env.EDEXO_USE_SHELL_LAUNCHER === "1" || argv.includes("--shell-launcher"),
  };
}

function loadPersistedJournalDir(projectRoot: string): string | null {
  try {
    const p = path.join(projectRoot, PATHS_FILE);
    if (!existsSync(p)) return null;
    const j = JSON.parse(readFileSync(p, "utf8")) as { journalDir?: string };
    if (typeof j.journalDir === "string" && j.journalDir.trim()) return path.normalize(j.journalDir.trim());
  } catch {
    /* ignore */
  }
  return null;
}

function persistJournalDirPreference(projectRoot: string, journalDir: string): void {
  try {
    const p = path.join(projectRoot, PATHS_FILE);
    writeFileSync(
      p,
      `${JSON.stringify({ journalDir: path.normalize(journalDir.trim()) }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    /* optional */
  }
}

function resolveInitialJournalDir(projectRoot: string): string {
  const env = process.env.ED_JOURNAL_DIR?.trim();
  if (env) return path.normalize(env);
  const persisted = loadPersistedJournalDir(projectRoot);
  if (persisted) return persisted;
  return DEFAULT_JOURNAL;
}

export type EdexoRuntime = {
  ready: Promise<void>;
  shutdown: () => Promise<void>;
  getLocalBaseUrl: () => string;
  openMainAppInBrowser: () => void;
};

export async function startEdexo(cli: CliOptions): Promise<EdexoRuntime> {
  assertResourceLayout();
  startPerfReporter();

  // Before anything reads user data: fold in whatever the old Electron directory still holds (§47).
  for (const line of describeUserDataMigration(migrateLegacyUserData())) console.log(line);

  const projectRoot = getProjectRoot();

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

  function persistUserPreferences(): void {
    try {
      writeFileSync(
        userSettingsPath,
        `${JSON.stringify(
          {
            includeBacteriumInSearch: store.includeBacteriumInSearch,
            includeExplorationScanDataInDataValue: store.includeExplorationScanDataInDataValue,
            exoMapTierPlusMinCr: store.exoMapTierPlusMinCr,
            exoMapTierPlusPlusMinCr: store.exoMapTierPlusPlusMinCr,
            footTravelOdometerEnabled: store.footTravelOdometerEnabled,
            journalHistoryPreset: store.journalHistoryPreset,
            // The toggle only. The EDSM key lives in its own file (edsmCredentials.ts) precisely so
            // it never lands in a settings JSON that gets pasted into bug reports.
            edsmAutoFetchEnabled: store.edsmAutoFetchEnabled,
            canonnUploadEnabled: store.canonnUploadEnabled,
            edsmUploadEnabled: store.edsmUploadEnabled,
            edsmLiveUploadEnabled: store.edsmLiveUploadEnabled,
            statusPollMs: store.statusPollMs,
            journalPollMs: store.journalPollMs,
            minimapRadiusM: store.minimapRadiusM,
            hudPrefs: store.hudPrefs,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    } catch {
      /* optional */
    }
  }

  type PersistedUserPrefs = {
    includeBacteriumInSearch?: boolean;
    includeExplorationScanDataInDataValue?: boolean;
    exoMapTierPlusMinCr?: number;
    exoMapTierPlusPlusMinCr?: number;
    footTravelOdometerEnabled?: boolean;
    journalHistoryPreset?: string;
    edsmAutoFetchEnabled?: boolean;
    canonnUploadEnabled?: boolean;
    edsmUploadEnabled?: boolean;
    edsmLiveUploadEnabled?: boolean;
    statusPollMs?: number;
    journalPollMs?: number;
    minimapRadiusM?: number;
    hudPrefs?: unknown;
  };

  function applyPersistedUserPrefs(j: PersistedUserPrefs): void {
    if (j.hudPrefs && typeof j.hudPrefs === "object") store.setHudPrefs(j.hudPrefs);
    if (typeof j.statusPollMs === "number" || typeof j.journalPollMs === "number") {
      // Read back through the same clamp that wrote them: a hand-edited settings file is the case
      // this exists for, and a 5 ms status poll would read the same file two hundred times a second.
      store.setPollRates(j.statusPollMs ?? store.statusPollMs, j.journalPollMs ?? store.journalPollMs);
    }
    if (typeof j.minimapRadiusM === "number") store.setMinimapRadiusM(j.minimapRadiusM);
    if (typeof j.includeBacteriumInSearch === "boolean") {
      store.setIncludeBacteriumInSearch(j.includeBacteriumInSearch);
    }
    if (typeof j.includeExplorationScanDataInDataValue === "boolean") {
      store.setIncludeExplorationScanDataInDataValue(j.includeExplorationScanDataInDataValue);
    }
    if (typeof j.exoMapTierPlusMinCr === "number" && typeof j.exoMapTierPlusPlusMinCr === "number") {
      store.setExoMapTierThresholds(j.exoMapTierPlusMinCr, j.exoMapTierPlusPlusMinCr);
    }
    if (typeof j.footTravelOdometerEnabled === "boolean") {
      store.setFootTravelOdometerEnabled(j.footTravelOdometerEnabled);
    }
    // dssSlack* keys from older preference files are ignored: the mechanism they tuned is gone.
    if (typeof j.journalHistoryPreset === "string") {
      store.setJournalHistoryPreset(parseJournalHistoryPreset(j.journalHistoryPreset));
    }
    // Restored only alongside a stored key: a settings file carried to a machine without one must
    // not switch outbound traffic back on by itself.
    if (j.edsmAutoFetchEnabled === true && readEdsmCredentials()) {
      store.setEdsmAutoFetchEnabled(true);
    }
    // Restored as written. There is no second factor to check the way the EDSM key is checked —
    // the switch is the whole consent — so a settings file that says on means the commander said on.
    if (j.canonnUploadEnabled === true) store.setCanonnUploadEnabled(true);
    if (j.edsmUploadEnabled === true) store.setEdsmUploadEnabled(true);
    // Only meaningful with the upload on; a settings file saying otherwise is a file that was edited.
    if (j.edsmLiveUploadEnabled === true && store.edsmUploadEnabled) store.setEdsmLiveUploadEnabled(true);
  }

  function tryReadUserPrefs(file: string): PersistedUserPrefs | null {
    try {
      const raw = readFileSync(file, "utf8");
      return JSON.parse(raw) as PersistedUserPrefs;
    } catch {
      return null;
    }
  }

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
  const getSnapshot = () =>
    perfTime("buildSnapshot", () =>
      buildSnapshot(
        store,
        journalPath,
        journalDir,
        bindHost,
        port,
        lanExposed ? lanUrlsWithKey() : [],
        journalFilesMerged,
        journalBootProgress,
        sessionLog.toDto(),
      ),
    );

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
    if (!feederDataDirExists()) return { ok: false, error: "No feeder corpus on this machine — this is a build-side tool." };
    if (!existsSync(file)) return { ok: false, error: `File not found: ${file}` };
    importDump = { running: true, file, apply, startedAt: new Date().toISOString(), finishedAt: null, report: null, error: null };
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
  function applyPollRates(statusRaw: unknown, journalRaw: unknown): { statusPollMs: number; journalPollMs: number } {
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
  function startEdsmRun(
    scope: EdsmCatchUpScope,
    silent = false,
  ): { ok: boolean; error?: string } {
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
        store.apply(line);
        // Live lines only. The historical replay calls store.apply directly, which is what keeps a
        // first run from asking EDSM about every system the commander has ever visited.
        maybeAutoFetchOnArrival(line);
        canonnUploader.offer(line);
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
    const parts = bootClock.marks.map(([l, ms]) => `${l} ${ms >= 1000 ? (ms / 1000).toFixed(1) + " s" : Math.round(ms) + " ms"}`);
    console.info(`Journal boot (${path}): ${parts.join(" · ")} · total ${(total / 1000).toFixed(1)} s`);
  };

  async function resyncAllJournalFiles(): Promise<void> {
    bootStart();
    store.resetAll();
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
    persistJournalDirPreference(projectRoot, next);
    process.env.ED_JOURNAL_DIR = next;

    await restartJournalPipeline();
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
      clearExomasteryProfileCache();
      clearSpeciesPhotoCache();
      clearGenusPhotosFolderCache();
      clearFootScannedCatalogCache();
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

  const {
    server,
    broadcast: broadcastFn,
    broadcastExoLive,
    listening,
  } = createHttpServer({
    port,
    bindHost,
    lanKey,
    getSnapshot,
    getStatus,
    getCommanderPosition: () => store.commanderPos,
    getFirstDiscoveryBacklog: () => firstDiscoveryBacklogWithDistance(store),
    getBacklogMap: () => backlogMap(store),
    getDiscoveries: () => buildDiscoveries(store, getProjectRoot()),
    searchGalaxyByValue: (query, limit) =>
      galaxyValueSearch({ ...query, from: store.commanderPos, limit }),
    getGalaxySpecies: () => galaxySpeciesCatalogue(),
    getGalaxyRegions: () => galaxyRegions(),
    scanGalaxyBodies: (query, limit) =>
      galaxyBodyScan({ ...query, from: store.commanderPos, limit }),
    getCommanderSectors: () => commanderSectorsDto(store),
    getCommanderSystem: () => store.currentSystem,
    setHudPrefs: (raw) => {
      store.setHudPrefs(raw);
      persistUserPreferences();
    },
    setPollRates: (statusMs, journalMs) => applyPollRates(statusMs, journalMs),
    setRadarRadiusM: (raw) => {
      /*
        Pushed as well as persisted. The radar is drawn from a field on its DTO, so a client that is
        not looking at a live fix right now would otherwise keep the old circle until the next
        sample — and the commander changing this is, by definition, looking at the radar.
      */
      if (store.setMinimapRadiusM(raw)) {
        persistUserPreferences();
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
    reloadExomastery: () => {
      retargetSpeciesDataWatcherIfNeeded();
      clearExomasteryProfileCache();
      clearSpeciesPhotoCache();
      clearGenusPhotosFolderCache();
      clearEddsnColourVariantsCache();
      clearPhotoCreditsCache();
      clearRegionSpeciesCache();
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
      clearExomasteryProfileCache();
      clearSpeciesPhotoCache();
      clearGenusPhotosFolderCache();
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
    scheduleBroadcast: push,
    getEncyclopedia: buildEncyclopediaPayload,
    getFeederStatus: () => buildFeederStatus(projectRoot, getCachedSpeciesDatabase()),
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
        } catch {
          store.exoOrganicLastFix = null;
          const hadDest = store.statusDestination != null;
          store.statusDestination = null;
          store.applyLiveShipFuel(null, null);
          const footHudEmpty = store.footTravelOdometerEnabled && store.footTravelOdometerTracking;
          if (footHudEmpty || store.exoOrganicTracker || navChanged || hadDest || jumpChanged) push();
          return;
        }
        const fix = parseStatusJsonFootFix(raw);
        if (fix) {
          store.applyFootTravelSample(fix.latDeg, fix.lonDeg, fix.planetRadiusM, fix.bodyName);
          store.exoOrganicLastFix = fix;
        } else {
          store.exoOrganicLastFix = null;
        }
        // The targeted body, for the HUD's candidate list. Pushed only when it actually changes.
        const dest = parseStatusJsonDestination(raw);
        const prevDest = store.statusDestination;
        const destChanged =
          (dest == null) !== (prevDest == null) ||
          (dest != null &&
            prevDest != null &&
            (dest.systemAddress !== prevDest.systemAddress || dest.bodyId !== prevDest.bodyId || dest.name !== prevDest.name));
        if (destChanged) store.statusDestination = dest;
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
        if (footHud || store.exoOrganicTracker || fuelChanged || navChanged || destChanged || jumpChanged) push();
      };
      armFootStatusPoll(true);

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
    if (footStatusPollTimer != null) {
      clearInterval(footStatusPollTimer);
      footStatusPollTimer = null;
    }
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
  };
}

export async function startEdexoFromElectronMode(mode: "server" | "client"): Promise<EdexoRuntime> {
  const bindHost = mode === "server" ? "0.0.0.0" : "127.0.0.1";
  process.env.EDEXO_ELECTRON = "1";
  return startEdexo({
    bindHost,
    port: 7111,
    shouldOpenMainUI: false,
    quietConsole: true,
    useShellLauncher: false,
  });
}
