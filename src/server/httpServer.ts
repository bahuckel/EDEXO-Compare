import { parseWsChannel, slimSnapshotForChannel, type WsChannel } from "./wsChannels.js";
import { eliteDisplaySettingsPath, eliteDisplayWarning, readEliteDisplayMode } from "./eliteDisplayMode.js";
import { linuxCheckForThisMachine } from "./linuxProbes.js";
import http from "node:http";
import os from "node:os";
import express from "express";
import { WebSocketServer } from "ws";
import type {
  AchievementDetailDTO,
  AchievementsDTO,
  AppSnapshot,
  AppStatusDTO,
  ExoLiveDTO,
  EncyclopediaExomasteryPlanetsResponseDTO,
  EncyclopediaSpeciesRowDTO,
  FeederStatusDTO,
  UpdateInfoDTO,
  ImportDumpStatusDTO,
  BacklogMapDTO,
  CommanderSectorsDTO,
  GalaxySpeciesCatalogueDTO,
  GalaxyBodyScanDTO,
  GalaxyBodyScanQueryDTO,
  GalaxyRegionsDTO,
  GalaxyValueQueryDTO,
  GalaxyValueSearchDTO,
  FirstDiscoveryBacklogDTO,
  ExoDataAlertDTO,
  DiscoveriesDTO,
  PhotoStampPrefs,
  GalaxyMineDTO,
  GalaxyMySystemDTO,
  GalaxyRouteDTO,
} from "../shared/types.js";
import type { JournalHistoryPreset } from "../shared/journalHistoryPreset.js";
import type { GameStateStore } from "./gameState.js";
import { getProjectRoot, getWebRoot } from "./paths.js";
import type { CollectionFocusConfig } from "./collectionFocus.js";
import { perfBytes, perfCount, perfTime } from "./perf.js";
import { createLanAuthGuard, isLoopbackAddress, requestIsAuthorized } from "./lanAuth.js";
import type { JournalScan } from "./statisticsScan.js";
import { isLauncherOpenMode, readLauncherOpenMode, writeLauncherOpenMode } from "./launcherPrefs.js";
import { type EdsmCatchUpScope } from "./edsmCatchUp.js";

import { GZIP_MIN_BYTES, sendJson } from "./routes/httpHelpers.js";
import { registerSpeciesFilesRoutes } from "./routes/speciesFilesRoutes.js";
import { registerGalaxyRoutes } from "./routes/galaxyRoutes.js";
import { registerCarriersPoiRoutes } from "./routes/carriersPoiRoutes.js";
import { registerServerStatusRoutes } from "./routes/serverStatusRoutes.js";
import { registerSettingsRoutes } from "./routes/settingsRoutes.js";
import { registerHudRoutes } from "./routes/hudRoutes.js";
import { registerExomasteryRoutes } from "./routes/exomasteryRoutes.js";
import { registerBackupRoutes } from "./routes/backupRoutes.js";
import type { BackupService } from "./backupService.js";
export function getLanIPv4s(port: number): string[] {
  const nets = os.networkInterfaces();
  const out: string[] = [];
  for (const infos of Object.values(nets)) {
    if (!infos) continue;
    for (const info of infos) {
      const family = info.family as string | number;
      const v4 = family === "IPv4" || family === 4;
      if (v4 && !info.internal) {
        out.push(`http://${info.address}:${port}`);
      }
    }
  }
  return [...new Set(out)].sort();
}

export interface HttpServerOptions {
  port: number;
  bindHost: string;
  /**
   * Shared access key required of every non-loopback client. `null` disables the check, which is
   * correct for a loopback-only bind. See lanAuth.ts.
   */
  lanKey?: string | null;
  getSnapshot: () => AppSnapshot;
  /** GET /api/status — launcher-sized status; must not rebuild the snapshot. */
  getStatus: () => AppStatusDTO;
  /** §10.3 — the commander's own coordinates, or null before the first jump this session. */
  getCommanderPosition: () => { x: number; y: number; z: number } | null;
  getCommanderSystem: () => string | null;
  /** GET /api/species-encyclopedia — species rows including exomastery flags */
  getEncyclopedia?: () => EncyclopediaSpeciesRowDTO[];
  /**
   * GET /api/first-discovery-backlog — biology left uncollected in systems this commander found.
   *
   * Its own endpoint rather than a snapshot field because it costs ~15 s over this commander's
   * history, and the snapshot rebuilds on every journal line. Absent on a build with no store
   * behind it, in which case the panel hides itself.
   */
  getFirstDiscoveryBacklog?: () => FirstDiscoveryBacklogDTO;
  /** GET /api/backlog-map — the same backlog rolled up to placed systems, for the galaxy map. */
  getBacklogMap?: () => BacklogMapDTO;
  /** Everything scanned, for the "My discoveries" panel. Built on request; see discoveries.ts. */
  getDiscoveries?: () => DiscoveriesDTO;
  /**
   * GET /api/galaxy/worth — systems the codex says hold a species worth at least `minCr`.
   *
   * Absent on a build with no galaxy index, which is every install until the index ships; the caller
   * hides the control rather than showing an empty answer.
   */
  searchGalaxyByValue?: (query: GalaxyValueQueryDTO, limit: number) => GalaxyValueSearchDTO;
  /** GET /api/galaxy/species — what the genus/species picker can offer, with per-species coverage. */
  getGalaxySpecies?: () => GalaxySpeciesCatalogueDTO;
  /**
   * GET /api/galaxy/regions — the regions the body file holds, for the predicted search's picker.
   *
   * Absent on a build with no body file, which is every install but the one that built it; the
   * panel hides the whole predicted mode rather than offering a picker with nothing behind it.
   */
  getGalaxyRegions?: () => GalaxyRegionsDTO;
  /**
   * GET /api/galaxy/possible — bodies whose conditions suit a species, in systems nobody has walked.
   *
   * Async because it is seconds of work, not milliseconds: a region is up to 3.2 M bodies and the
   * scan yields to the event loop as it goes so the journal watcher keeps running underneath it.
   */
  scanGalaxyBodies?: (query: GalaxyBodyScanQueryDTO, limit: number) => Promise<GalaxyBodyScanDTO>;
  /** GET /api/galaxy/my-sectors — this commander's own state per sector, for colouring the map. */
  getCommanderSectors?: () => CommanderSectorsDTO;
  /** The 3D map's "your systems" layer, its detail panel, and this session's route (galaxyMine.ts). */
  getMySystems?: () => GalaxyMineDTO;
  getMySystem?: (addr: number) => GalaxyMySystemDTO | null;
  getSessionRoute?: () => GalaxyRouteDTO;
  /** The journal store itself, for the map's Find box (the commander's own system names). */
  getJournalStore?: () => GameStateStore;
  /** Codex map: the commander's codex entries, `regionJoinKey|entryKey` (see codexMap.ts). */
  getCodexMapLogged?: () => ReadonlySet<string>;
  /** Achievements: the list, one set's entries, and which one is tracked (false = no such id). */
  getAchievements?: () => AchievementsDTO;
  getAchievementDetail?: (id: string) => AchievementDetailDTO | null;
  trackAchievement?: (id: string | null) => boolean;
  /**
   * GET /api/feeder/status — feeder corpus vs installed profiles.
   *
   * Absent on a build with no feeder corpus, which is every normal install; the panel hides itself
   * rather than showing empty numbers.
   */
  getFeederStatus?: () => Promise<FeederStatusDTO>;
  /** GET /api/app/update (`?force=1` asks GitHub again) — running version vs newest release. */
  getUpdateInfo?: (force: boolean) => Promise<UpdateInfoDTO>;
  /**
   * POST /api/app/open-update — open the newer release's page in the system browser. No URL is
   * taken from the caller; the server opens the page it found itself, on github.com, or nothing.
   */
  openUpdatePage?: () => { ok: boolean; error?: string };
  /**
   * POST /api/feeder/import-dump — start a Spansh JSONL export import into the feeder corpus
   * (`{ file, apply }`); GET /api/feeder/import-dump/status — its progress and last report.
   * Absent on a build with no feeder corpus.
   */
  startImportDump?: (file: string, apply: boolean) => { ok: boolean; error?: string };
  getImportDumpStatus?: (file?: string | null) => ImportDumpStatusDTO;
  /** POST /api/settings/include-bacterium */
  /** POST /api/settings/hud-prefs */
  setHudPrefs?: (raw: unknown) => void;
  /**
   * POST /api/settings/poll-rates — JSON `{ statusPollMs, journalPollMs }`.
   *
   * Applied to the running timers, not queued for the next launch: that is the entire request. The
   * implementation clamps, so the reply is the accepted pair and the launcher shows that rather
   * than what it sent.
   */
  setPollRates?: (
    statusPollMs: unknown,
    journalPollMs: unknown,
  ) => { statusPollMs: number; journalPollMs: number };
  /**
   * POST /api/settings/radar-radius — JSON `{ radiusM }`. Returns the accepted (clamped) value.
   *
   * Applied to the live radar, not queued: the commander changing this is looking at the thing it
   * changes.
   */
  setRadarRadiusM?: (radiusM: unknown) => number;
  /**
   * GET/POST `/api/settings/collection-focus` — the thresholds behind the ⌖ mark.
   *
   * Local-only state (`edexo-collection-focus.json` beside the user settings), so it is read back
   * from the server rather than mirrored into the snapshot: it changes when somebody edits it and
   * at no other time, and the snapshot is already the biggest thing on the wire.
   */
  getCollectionFocus?: () => CollectionFocusConfig;
  setCollectionFocus?: (raw: unknown) => CollectionFocusConfig;
  setIncludeBacterium?: (value: boolean) => void;
  setIncludeExplorationScanData?: (value: boolean) => void;
  /** POST /api/settings/photo-stamp — JSON { commander?, system?, timestamp?: boolean } */
  setPhotoStamp?: (p: Partial<PhotoStampPrefs>) => void;
  /** POST /api/settings/foot-travel-odometer — JSON { value: boolean } */
  setFootTravelOdometer?: (value: boolean) => void;
  /** POST /api/settings/exo-map-tiers — JSON { plusMinCr: number, plusPlusMinCr: number } */
  setExoMapTierThresholds?: (plusMinCr: number, plusPlusMinCr: number) => void;
  /**
   * POST /api/ui/open-external — open one of this app's own views in the system browser.
   *
   * The launcher's "Open exobiology UI" used to navigate the launcher window itself, which is the
   * one place the commander cannot get back from. The owner asked for a choice, with the browser
   * as the default.
   *
   * The view is an **enum, not a URL**. The server builds the address from its own port, so this
   * can never be talked into launching something else — a route that takes a URL and hands it to
   * the shell is an open redirect with a browser on the end of it.
   *
   * Loopback only, for the same reason as the miss log: the window opens on the PC running the
   * app, so a phone pressing this would open something on a screen it cannot see.
   */
  openAppView?: (view: "app" | "phone") => { ok: boolean; error?: string };
  /**
   * POST /api/settings/open-miss-log — hand `edexo-outliers.jsonl` to the desktop.
   *
   * **Loopback only**, and not because the file is a secret to the commander: it is *their* miss log
   * and it never leaves the machine. The point is that the window that opens would open on the PC
   * running the app, so a phone on the LAN pressing this would make a window appear on a screen it
   * cannot see and cannot close. The route refuses rather than doing that.
   */
  openExoMissLog?: () => { ok: boolean; error?: string };
  /** POST /api/exobiology/reset with confirm: true */
  resetExobiology?: () => void;
  /** POST /api/system/hydrate-from-edsm — JSON { systemAddress: number, systemName: string } (known systems only). */
  hydrateSystemFromEdsm?: (
    systemAddress: number,
    systemName: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** GET /api/settings/edsm-credentials — commander name + whether a key is stored. Never the key. */
  getEdsmCredentialsStatus?: () => { commanderName: string | null; hasKey: boolean; keyHint: string | null };
  /** POST /api/settings/edsm-credentials — JSON { commanderName, apiKey }. */
  setEdsmCredentials?: (commanderName: string, apiKey: string) => { ok: boolean; error?: string };
  /** DELETE /api/settings/edsm-credentials — also switches auto-fetch off. */
  forgetEdsmCredentials?: () => void;
  /** POST /api/settings/edsm-auto-fetch — JSON { enabled }. Refused without stored credentials. */
  setEdsmAutoFetchEnabled?: (enabled: boolean) => { ok: boolean; error?: string };
  /** POST /api/settings/canonn-upload — JSON { enabled }. The switch is the whole consent. */
  setCanonnUploadEnabled?: (enabled: boolean) => { ok: boolean; error?: string };
  /** POST /api/settings/eddn-upload — JSON { enabled }. The switch is the whole consent. */
  setEddnUploadEnabled?: (enabled: boolean) => { ok: boolean; error?: string };
  /** GET /api/system/edsm-search?q= — galaxy name prefix via EDSM (returns id64 as systemAddress). */
  searchEdsmSystems?: (
    query: string,
  ) => Promise<
    { ok: true; systems: { systemAddress: number; starSystem: string }[] } | { ok: false; error: string }
  >;
  /** GET /api/system/spansh-search?q= — the same shape from Spansh (id64 = SystemAddress). */
  searchSpanshSystems?: (
    query: string,
  ) => Promise<
    { ok: true; systems: { systemAddress: number; starSystem: string }[] } | { ok: false; error: string }
  >;
  /**
   * The statistics scan: three years of journals reduced to totals.
   *
   * A callback rather than a path, because the http layer has no business listing the commander's
   * journal folder — the bootstrap already knows where it is and which files count.
   */
  getStatisticsScan?: () => Promise<JournalScan>;
  /** POST /api/system/hydrate-from-spansh — bodies from Spansh's dump for a system the journal never scanned. */
  hydrateSystemFromSpansh?: (
    systemAddress: number,
    systemName: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** POST /api/ui/view-system — JSON { systemAddress: number | null, starSystem?: string } */
  setViewingSystem?: (systemAddress: number | null) => void;
  /** Optional: remember system name when client provides it (journal row or EDSM pick). */
  rememberVisitedSystem?: (starSystem: string, systemAddress: number) => void;
  /**
   * A system chosen from the header search: when the journals know nothing about it, fetch it from
   * Spansh (cache first, 30 days) — see `remoteSystems.ts`. Replaces writing the pasted name into the
   * visited-systems list, which put systems he had never flown to into "My discoveries".
   */
  lookupSystem?: (systemAddress: number, starSystem: string) => void;
  /** POST /api/ui/selected-body — JSON { bodyKey: string | null } */
  setUiSelectedBodyKey?: (bodyKey: string | null) => boolean | void;
  /** POST /api/settings/journal-directory — JSON { journalDir: string } */
  setJournalDirectory?: (dir: string) => Promise<{ ok: boolean; error?: string }>;
  /** POST /api/settings/journal-history — JSON { preset: JournalHistoryPreset } */
  setJournalHistoryPreset?: (preset: JournalHistoryPreset) => Promise<void>;
  /** POST /api/settings/edsm-upload — JSON { enabled }. Refused without stored credentials. */
  setEdsmUploadEnabled?: (enabled: boolean) => { ok: boolean; error?: string };
  /** Kick off a catch-up. Refused when one is already running or the switch is off. */
  startEdsmCatchUp?: (scope: EdsmCatchUpScope) => { ok: boolean; error?: string };
  cancelEdsmCatchUp?: () => void;
  /** POST /api/settings/edsm-live-upload — JSON { enabled }. Refused unless upload is on. */
  setEdsmLiveUploadEnabled?: (enabled: boolean) => { ok: boolean; error?: string };
  /** After mutating server state, refresh WebSocket clients (e.g. debounced push). */
  scheduleBroadcast?: () => void;
  /** GET /api/encyclopedia-exomastery/:genusDir/:speciesEntryId — feeder profile or per-body EDSM rows. */
  getEncyclopediaExomastery?: (
    genusDir: string,
    speciesEntryId: string,
    focusBodyKey?: string | null,
  ) => EncyclopediaExomasteryPlanetsResponseDTO | null;
  /** POST /api/exomastery/reload — re-read species DB + clear exomastery JSON cache; then call {@link scheduleBroadcast}. */
  reloadExomastery?: () => void;
  /** The commander's own exomastery (on-foot finds) or codex record, as a download (§S). */
  exportExomastery?: (kind: "exomastery" | "codex") => { fileName: string; body: unknown };
  /** The launcher's Backups row (backupService.ts); absent where backups are not wired. */
  backup?: BackupService;
  /** Clear in-memory exomastery JSON cache only (used by encyclopedia `?force=1`). */
  clearExomasteryProfileCache?: () => void;
  /** POST /api/exo-data-alerts/fix — write fixes_*.json stubs next to codex / feeder JSON. */
  writeExoDataAlertFix?: (alert: ExoDataAlertDTO) => {
    ok: boolean;
    written?: { root: string; relativePath: string; absolutePath: string }[];
    error?: string;
  };
  /** When set (e.g. Electron main process), successful Fix can show a native dialog instead of the browser. */
  showFixStubNativeDialog?: (message: string) => boolean;
}

/** What the route modules read from the server's own scope. */
export interface RouteContext {
  root: string;
  webRoot: string;
}

export function createHttpServer(opts: HttpServerOptions): {
  server: http.Server;
  broadcast: (s: AppSnapshot) => void;
  /** The radar's own frame, straight to the HUD sockets. See {@link ExoLiveDTO}. */
  broadcastExoLive: (live: ExoLiveDTO) => void;
  listening: Promise<void>;
} {
  const app = express();
  const root = getProjectRoot();
  const webRoot = getWebRoot(root);
  const routeCtx: RouteContext = { root, webRoot };

  /**
   * First middleware on purpose: an unpaired LAN client must not reach a route handler, and must
   * not get its request body parsed either.
   */
  const lanKey = opts.lanKey ?? null;
  app.use(createLanAuthGuard(lanKey));

  /**
   * A route export needs more room than everything else combined.
   *
   * The global limit below is 48 kB, which is right for every other endpoint and far too small for a
   * Spansh export: the owner's two are 136 kB and 145 kB, and a longer route is bigger again. This
   * must be mounted *before* the global parser, because express.json rejects an oversized body where
   * it is mounted and a later, larger parser never sees the request. Bounded at 8 MB, and scoped to
   * the one path: the galaxy dump is read from disk by the CLI and never travels through here.
   */
  app.use("/api/feeder/import", express.json({ limit: "8mb" }));
  app.use(express.json({ limit: "48kb" }));

  registerSpeciesFilesRoutes(app, opts, routeCtx);

  registerGalaxyRoutes(app, opts, routeCtx);

  /**
   * Where the commander is (§10.3).
   *
   * Its own endpoint rather than a field on the snapshot: the sector map is a separate screen with no
   * WebSocket, and it wants one small thing on a slow poll. `/api/state` rebuilds the whole snapshot
   * (~186 ms, ~630 kB) and would be absurd for three numbers.
   *
   * Null is a real answer — the app may not have seen a jump yet — and the map draws nothing rather
   * than guessing the origin.
   */
  app.get("/api/commander-position", (_req, res) => {
    perfCount("http.commanderPosition");
    const pos = opts.getCommanderPosition();
    res.json({ position: pos, system: opts.getCommanderSystem() });
  });

  app.get("/api/status", (_req, res) => {
    perfCount("http.apiStatus");
    res.json(opts.getStatus());
  });

  /*
    Fleet carriers, from EDAstro. Three routes, and none of them runs by itself.

    The commander presses a button, `fetch` downloads a 21 MB CSV to their own machine, and `query`
    answers from that file forever after. There is no background poll and no per-jump call: the
    source rebuilds about daily. See `docs/archive/edastro-integration.md` for the licence position
    — the short version is that we ship the endpoint and never the data, so the fetch must stay on
    the commander's machine and must never be proxied through here.
  */
  registerCarriersPoiRoutes(app, opts, routeCtx);

  /**
   * Whether Elite is in a display mode the HUDs can be drawn over.
   *
   * Read fresh on every call rather than cached at boot: the commander changes this while the app is
   * running, and a cached "borderless" would keep telling him everything is fine while he stares at
   * a screen with no overlay on it.
   */
  /**
   * The Linux start-up check (linuxCheck.ts): what is missing here and the command to install it on
   * this distro. `{ applicable: false }` off Linux. The HUD rows only for the Electron app.
   */
  app.get("/api/system/linux-check", (_req, res) => {
    const r = linuxCheckForThisMachine(process.env.EDEXO_ELECTRON === "1");
    res.json(r ? { applicable: true, ...r } : { applicable: false });
  });

  app.get("/api/elite-display-mode", (_req, res) => {
    const status = readEliteDisplayMode(eliteDisplaySettingsPath(opts.getSnapshot().journalDir));
    res.json({ ...status, warning: eliteDisplayWarning(status) });
  });

  /**
   * The revision of the last push on the app channel — a few bytes the client asks for every 10 s
   * instead of the whole snapshot (UI review P2). A different number than the last push it saw means a
   * push was missed (a half-open socket), and only then does it fetch `/api/state`.
   */
  app.get("/api/state/rev", (_req, res) => {
    res.json({ rev: pushRev });
  });

  app.get("/api/state", (req, res) => {
    perfCount("http.apiState");
    res.setHeader("X-Edexo-Rev", String(pushRev));
    const chq = parseWsChannel(req.query?.channel) ?? "app";
    const body = perfTime("http.apiState.serialize", () =>
      JSON.stringify(slimSnapshotForChannel(opts.getSnapshot(), chq)),
    );
    sendJson(req, res, body, (raw, sent) => {
      perfBytes("http.apiState.bytes", raw);
      perfBytes("http.apiState.sent", sent);
    });
  });

  registerServerStatusRoutes(app, opts, routeCtx);

  app.get("/api/species-encyclopedia", (req, res) => {
    if (typeof opts.getEncyclopedia !== "function") {
      res.status(501).json({ error: "Not available" });
      return;
    }
    try {
      sendJson(req, res, JSON.stringify({ species: opts.getEncyclopedia() }), (raw, sent) => {
        perfBytes("http.encyclopedia.bytes", raw);
        perfBytes("http.encyclopedia.sent", sent);
      });
    } catch {
      res.status(500).json({ error: "Could not load species database." });
    }
  });

  /**
   * Whether the data the app ranks with is the data the corpus holds. Before the feeder merge the
   * answer was no on 72 of 79 profiles and nothing in the app said so.
   */
  /** Where the launcher opens the UI — saved in user data so a rebuilt exe keeps it (launcherPrefs.ts). */
  app.get("/api/launcher/open-mode", (_req, res) => {
    res.json({ ok: true, mode: readLauncherOpenMode() });
  });

  app.post("/api/launcher/open-mode", (req, res) => {
    const mode = (req.body as { mode?: unknown } | undefined)?.mode;
    if (!isLauncherOpenMode(mode)) {
      res.status(400).json({ ok: false, error: "mode must be browser, window or phone." });
      return;
    }
    try {
      writeLauncherOpenMode(mode);
      res.json({ ok: true, mode });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/app/update", async (req, res) => {
    if (typeof opts.getUpdateInfo !== "function") {
      res.status(501).json({ error: "Not available" });
      return;
    }
    res.json(await opts.getUpdateInfo(req.query.force === "1"));
  });

  app.post("/api/app/open-update", (req, res) => {
    if (typeof opts.openUpdatePage !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      res.status(403).json({
        ok: false,
        error: "A browser opens on the PC running the app, so it can only be opened from there.",
      });
      return;
    }
    res.json(opts.openUpdatePage());
  });

  app.get("/api/feeder/status", async (_req, res) => {
    if (typeof opts.getFeederStatus !== "function") {
      res.status(501).json({ error: "Not available" });
      return;
    }
    try {
      res.json(await opts.getFeederStatus());
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  /*
    The launcher's "Import Spansh export" button. The import streams a multi-gigabyte file through
    the same four gates the CLI uses, so it runs as a background job and the launcher polls the
    status route; only one at a time.
  */
  app.post("/api/feeder/import-dump", (req, res) => {
    if (typeof opts.startImportDump !== "function") {
      res.status(501).json({ ok: false, error: "Not available on this build" });
      return;
    }
    const body = (req.body ?? {}) as { file?: unknown; apply?: unknown };
    const file = typeof body.file === "string" ? body.file.trim() : "";
    if (!file) {
      res.status(400).json({ ok: false, error: "Send JSON { file, apply }" });
      return;
    }
    const r = opts.startImportDump(file, body.apply === true);
    res.status(r.ok ? 200 : 409).json(r);
  });
  app.get("/api/feeder/import-dump/status", (req, res) => {
    if (typeof opts.getImportDumpStatus !== "function") {
      res.status(501).json({ error: "Not available on this build" });
      return;
    }
    const f = typeof req.query.file === "string" ? req.query.file : null;
    res.json(opts.getImportDumpStatus(f));
  });

  app.get("/api/encyclopedia-exomastery/:genusDir/:speciesEntryId", (req, res) => {
    if (typeof opts.getEncyclopediaExomastery !== "function") {
      res.status(501).json({ error: "Not available" });
      return;
    }
    const genusDir = decodeURIComponent(String(req.params.genusDir));
    const speciesEntryId = decodeURIComponent(String(req.params.speciesEntryId));
    const fq = req.query?.force;
    const force =
      fq === "1" ||
      (typeof fq === "string" && fq.toLowerCase() === "true") ||
      (Array.isArray(fq) && fq.some((x) => x === "1" || String(x).toLowerCase() === "true"));
    const rawFocus = req.query?.focusBodyKey;
    const focusBodyKey = typeof rawFocus === "string" && rawFocus.trim().length > 0 ? rawFocus.trim() : null;
    if (force && typeof opts.clearExomasteryProfileCache === "function") {
      opts.clearExomasteryProfileCache();
    }
    try {
      const payload = opts.getEncyclopediaExomastery(genusDir, speciesEntryId, focusBodyKey);
      if (!payload) {
        res
          .status(404)
          .json({ error: "No exomastery data for this species (feeder profile or at least one EDSM row)." });
        return;
      }
      res.json(payload);
    } catch {
      res.status(500).json({ error: "Could not load exomastery encyclopedia data." });
    }
  });

  registerSettingsRoutes(app, opts, routeCtx);

  app.post("/api/exo-data-alerts/fix", (req, res) => {
    if (typeof opts.writeExoDataAlertFix !== "function") {
      res.status(501).json({ ok: false, error: "Fix stubs are not available in this build." });
      return;
    }
    const alert = req.body?.alert as ExoDataAlertDTO | undefined;
    if (!alert?.id || !alert.speciesEntryId || !alert.genusDataDir) {
      res.status(400).json({
        ok: false,
        error: 'Send JSON { "alert": { ... full ExoDataAlertDTO with speciesEntryId + genusDataDir } }.',
      });
      return;
    }
    try {
      const out = opts.writeExoDataAlertFix(alert);
      const lines =
        out.ok && out.written?.length
          ? [
              "Wrote or updated fixes_*.json in your user data folder, and next to the codex where that folder is writable (original JSON unchanged).",
              "Species data was reloaded — criteriaPatch entries (e.g. volcanism) apply immediately.",
              "",
              ...out.written.map((w) => `${w.relativePath}\n  (${w.root})`),
            ].join("\n")
          : "";
      let notifyTarget: "native" | "browser" = "browser";
      if (out.ok && lines && opts.showFixStubNativeDialog?.(lines)) notifyTarget = "native";
      res.json({ ...out, notifyTarget });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/exobiology/reset", (req, res) => {
    if (typeof opts.resetExobiology !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    if (req.body?.confirm !== true) {
      res.status(400).json({
        ok: false,
        error:
          'Send JSON { "confirm": true } to clear organic progress, pending data value, and footfall flags in this session.',
      });
      return;
    }
    opts.resetExobiology();
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  /*
    The HUD overlay windows, for anything that is not the app's own UI.

    Overlays are Electron windows and every control for them is an `ipcMain` channel, which a console
    build has no way to reach. `hudBridge.ts` is the seam; these routes are the only door through it.
    A build with no windows answers 501 rather than pretending — the CLI prints that reason as-is.
  */
  registerHudRoutes(app, opts, routeCtx);

  registerBackupRoutes(app, opts, routeCtx);

  registerExomasteryRoutes(app, opts, routeCtx);

  const server = http.createServer(app);

  const listening = new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", (err: NodeJS.ErrnoException) => {
      console.error("HTTP server error:", err.message);
      if (err.code === "EADDRINUSE") {
        console.error(
          `Port ${opts.port} is already in use. Close the other app (e.g. EDExoCompare-*-CLI.exe) or set PORT in the environment.`,
        );
      }
      reject(err);
    });
  });

  /**
   * Compress large frames only. A snapshot push is ~630 KB of repetitive JSON (~85% smaller
   * deflated), which matters for LAN clients; small boot-progress frames stay raw so they are not
   * slowed down by framing overhead.
   */
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    perMessageDeflate: { threshold: GZIP_MIN_BYTES, zlibDeflateOptions: { level: 4 } },
    // The upgrade bypasses Express, so the same key check runs here. A paired browser sends the
    // cookie on the handshake; a script can pass ?k= or the header.
    verifyClient: ({ req }, done) => {
      if (requestIsAuthorized(req, lanKey)) done(true);
      else done(false, 401, "Access key required");
    },
  });
  const clients = new Set<import("ws").WebSocket>();
  /** What each socket asked for with its hello; "app" (the full state) until it says otherwise. */
  const channelOf = new WeakMap<import("ws").WebSocket, WsChannel>();
  const stateMessage = (snap: AppSnapshot, channel: WsChannel): string =>
    JSON.stringify({ type: "state", channel, rev: pushRev, payload: slimSnapshotForChannel(snap, channel) });

  /*
    Pushes carry only what changed (UI review P1, owner 2026-09-29). A snapshot is ~0.8 MB and, in a
    system full of bio bodies, ~10 MB — and while the commander plays, most pushes change nothing but
    the fuel. So on the app channel every field of at least OMIT_UNCHANGED_MIN_BYTES that is identical
    to the one in the previous push is left out and named in `unchanged`; the client keeps its copy.
    A socket always gets the full snapshot first (on connect, and on a channel change), so it has
    every field before a push can leave one out. The launcher and HUD channels are small and unchanged.
  */
  const OMIT_UNCHANGED_MIN_BYTES = 2048;
  const lastFieldJson = new Map<WsChannel, Map<string, string>>();
  /** Counts pushes that went out on the app channel; `/api/state/rev` lets a client check it cheaply (P2). */
  let pushRev = 0;
  const pushMessage = (snap: AppSnapshot, channel: WsChannel): string => {
    if (channel !== "app") return stateMessage(snap, channel);
    const prev = lastFieldJson.get(channel);
    const next = new Map<string, string>();
    const parts: string[] = [];
    const unchanged: string[] = [];
    for (const [k, v] of Object.entries(slimSnapshotForChannel(snap, channel))) {
      const j = v === undefined ? undefined : JSON.stringify(v);
      if (j === undefined) continue;
      next.set(k, j);
      if (j.length >= OMIT_UNCHANGED_MIN_BYTES && prev?.get(k) === j) unchanged.push(k);
      else parts.push(`${JSON.stringify(k)}:${j}`);
    }
    // Nothing at all changed since the last push (same fields, same content): no frame.
    if (prev && prev.size === next.size && [...next].every(([k, j]) => prev.get(k) === j)) return "";
    lastFieldJson.set(channel, next);
    return `{"type":"state","channel":"app","rev":__REV__,"payload":{${parts.join(",")}}${
      unchanged.length ? `,"unchanged":${JSON.stringify(unchanged)}` : ""
    }}`;
  };

  /** Keep connections warm (NAT / middleboxes); helps clients detect half-open TCP. */
  const wsKeepAlive = setInterval(() => {
    for (const ws of clients) {
      if (ws.readyState !== ws.OPEN) {
        clients.delete(ws);
        continue;
      }
      try {
        ws.ping();
      } catch {
        clients.delete(ws);
      }
    }
  }, 25_000);
  wsKeepAlive.unref();

  server.once("close", () => clearInterval(wsKeepAlive));

  wss.on("connection", (ws) => {
    clients.add(ws);
    channelOf.set(ws, "app");
    perfCount("ws.connect");
    try {
      ws.send(stateMessage(opts.getSnapshot(), "app"));
    } catch {
      /* ignore */
    }
    ws.on("message", (raw) => {
      // The only message a client sends: which slice of the state it wants from now on.
      try {
        const msg = JSON.parse(String(raw)) as { type?: unknown; channel?: unknown };
        if (msg && msg.type === "hello") {
          const ch = parseWsChannel(msg.channel);
          if (ch && ch !== channelOf.get(ws)) {
            channelOf.set(ws, ch);
            ws.send(stateMessage(opts.getSnapshot(), ch));
          }
        }
      } catch {
        /* not ours */
      }
    });
    ws.on("close", () => clients.delete(ws));
  });

  /** Last frame sent per channel, so an identical rebuild is not pushed to those clients again. */
  const lastBroadcastMsg = new Map<WsChannel, string>();

  const broadcast = (snap: AppSnapshot) => {
    // One serialization per channel per push; null marks "identical to the last frame, skip".
    const built = new Map<WsChannel, string | null>();
    for (const ws of clients) {
      if (ws.readyState !== ws.OPEN) continue;
      const ch = channelOf.get(ws) ?? "app";
      if (!built.has(ch)) {
        // The revision is filled in after the identical-frame check, so it cannot make every frame differ.
        const draft = perfTime("ws.serialize", () => pushMessage(snap, ch));
        if (draft === "" || draft === lastBroadcastMsg.get(ch)) {
          perfCount("ws.push.skippedIdentical");
          built.set(ch, null);
        } else {
          lastBroadcastMsg.set(ch, draft);
          if (ch === "app") pushRev++;
          const msg = draft.replace("__REV__", String(pushRev));
          perfCount("ws.push");
          perfBytes("ws.push.bytes", Buffer.byteLength(msg));
          built.set(ch, msg);
        }
      }
      const msg = built.get(ch);
      if (!msg) continue;
      try {
        ws.send(msg);
      } catch {
        clients.delete(ws);
      }
    }
  };

  /**
   * Push the radar's two fields to the HUD sockets, and to nothing else.
   *
   * Separate from {@link broadcast} on purpose: this frame is a few hundred bytes built straight
   * from the store, so it is sent on every `Status.json` poll rather than through the 250 ms
   * coalescing window that exists to stop full snapshot rebuilds piling up. The app and launcher
   * channels do not get it — neither draws a radar, and the app keeps receiving the same data in
   * the snapshot it already reads.
   *
   * Identical frames are dropped. A commander standing still produces the same numbers every tick,
   * and at a 100 ms poll that would be ten redundant sends a second into a window redrawing an SVG.
   */
  let lastExoLiveMsg: string | null = null;
  const broadcastExoLive = (live: ExoLiveDTO) => {
    let msg: string | null = null;
    for (const ws of clients) {
      if (ws.readyState !== ws.OPEN) continue;
      if ((channelOf.get(ws) ?? "app") !== "hud") continue;
      if (msg === null) {
        msg = JSON.stringify({ type: "exoLive", channel: "hud", payload: live });
        if (msg === lastExoLiveMsg) {
          perfCount("ws.exoLive.skippedIdentical");
          return;
        }
        lastExoLiveMsg = msg;
        perfCount("ws.exoLive");
        perfBytes("ws.exoLive.bytes", Buffer.byteLength(msg));
      }
      try {
        ws.send(msg);
      } catch {
        clients.delete(ws);
      }
    }
  };

  server.listen(opts.port, opts.bindHost);
  return { server, broadcast, broadcastExoLive, listening };
}
