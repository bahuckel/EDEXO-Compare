import { parseWsChannel, slimSnapshotForChannel, type WsChannel } from "./wsChannels.js";
import { eliteDisplayWarning, readEliteDisplayMode } from "./eliteDisplayMode.js";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { promises as fsp } from "node:fs";
import { gzip as gzipCb } from "node:zlib";
import express from "express";
import { WebSocketServer } from "ws";
import type {
  AppSnapshot,
  AppStatusDTO,
  ExoLiveDTO,
  EncyclopediaExomasteryPlanetsResponseDTO,
  EncyclopediaSpeciesRowDTO,
  FeederStatusDTO,
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
} from "../shared/types.js";
import type { JournalHistoryPreset } from "../shared/journalHistoryPreset.js";
import { isJournalHistoryPreset } from "../shared/journalHistoryPreset.js";
import { getProjectRoot, getSpeciesDataDir, getWebRoot } from "./paths.js";
import type { CollectionFocusConfig } from "./collectionFocus.js";
import { feederDataDirExists, feederInboxDir, setConfiguredFeederDataDir } from "../feeder/paths.js";
import { parseSpanshRouteFile, summariseSpanshRouteFile } from "../feeder/spanshRouteFile.js";
import { findGenusPhotosFolder, findGenusNotesFile } from "./speciesTreeLoader.js";
import { perfBytes, perfCount, perfTime } from "./perf.js";
import { createLanAuthGuard, isLoopbackAddress, requestIsAuthorized } from "./lanAuth.js";
import { EDSM_USER_AGENT } from "./edsmSystemHydration.js";
import {
  countCarriers,
  fetchCarrierData,
  parseCarrierQueryParams,
  queryCarriers,
  readCarrierStatus,
} from "./edastroCarriers.js";
import { countPoi, fetchPoiData, queryPoi, readPoiStatus } from "./edastroPoi.js";
import { lookupCarrierOnSpansh } from "./spanshCarrier.js";
import { EDASTRO_USER_AGENT } from "./edastroCarriers.js";
import { lookupCarrierOnGalmap } from "./edastroGalmap.js";
import type { JournalScan } from "./statisticsScan.js";
import { summariseStatistics } from "./statistics.js";
import { isEdsmCatchUpScope, type EdsmCatchUpScope } from "./edsmCatchUp.js";

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

/** Below this, framing and CPU cost more than the bytes saved. */
const GZIP_MIN_BYTES = 8192;

/**
 * Send an already-serialized JSON body, gzipped when the client accepts it.
 *
 * The snapshot is ~630 KB of highly repetitive JSON and compresses ~85%. Compression runs on the
 * zlib threadpool, not the event loop, so a poll no longer costs the main thread anything beyond
 * the serialize it already did. `onSent` reports both sizes for the perf log.
 */
function sendJson(
  req: express.Request,
  res: express.Response,
  body: string,
  onSent?: (rawBytes: number, sentBytes: number) => void,
): void {
  const raw = Buffer.from(body, "utf8");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Vary", "Accept-Encoding");
  const acceptsGzip = String(req.headers["accept-encoding"] ?? "").includes("gzip");
  if (!acceptsGzip || raw.length < GZIP_MIN_BYTES) {
    onSent?.(raw.length, raw.length);
    res.end(raw);
    return;
  }
  gzipCb(raw, { level: 6 }, (err, gz) => {
    if (err || res.writableEnded) {
      onSent?.(raw.length, raw.length);
      if (!res.writableEnded) res.end(raw);
      return;
    }
    res.setHeader("Content-Encoding", "gzip");
    onSent?.(raw.length, gz.length);
    res.end(gz);
  });
}

function assertInsideDir(dir: string, candidate: string): boolean {
  const base = path.resolve(dir);
  const abs = path.resolve(candidate);
  const rel = path.relative(base, abs);
  return (rel === "" || !rel.startsWith("..")) && !path.isAbsolute(rel);
}

export function createHttpServer(opts: {
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
  /**
   * GET /api/feeder/status — feeder corpus vs installed profiles.
   *
   * Absent on a build with no feeder corpus, which is every normal install; the panel hides itself
   * rather than showing empty numbers.
   */
  getFeederStatus?: () => FeederStatusDTO;
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
}): {
  server: http.Server;
  broadcast: (s: AppSnapshot) => void;
  /** The radar's own frame, straight to the HUD sockets. See {@link ExoLiveDTO}. */
  broadcastExoLive: (live: ExoLiveDTO) => void;
  listening: Promise<void>;
} {
  const app = express();
  const root = getProjectRoot();
  const webRoot = getWebRoot(root);

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

  app.get("/photos/__builtin_placeholder.svg", (_req, res) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="220" viewBox="0 0 360 220"><rect width="100%" height="100%" fill="#12121a"/><rect x="12" y="12" width="336" height="196" fill="none" stroke="#ff6a1a" stroke-opacity="0.45" stroke-width="2"/><text x="180" y="100" fill="#c8c4bf" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13">No species photo on disk</text><text x="180" y="128" fill="#ff6a1a" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12">Add images under data/species/&lt;genus&gt;/*_photos/</text></svg>`;
    res.type("image/svg+xml").send(svg);
  });

  /**
   * Species artwork. Opening the encyclopedia used to fire ~108 of these at once, and each request
   * did three synchronous fs calls plus a directory scan on the event loop — requests stalled and
   * the browser fell back to the "no photo on disk" placeholder. Now: cached directory lookup,
   * async stat, and a week of client caching so reopening the modal costs nothing.
   */
  const SPECIES_PHOTO_MAX_AGE_S = 604_800;
  app.get("/species-photos/:genusDir/:file", (req, res) => {
    void (async () => {
      const genusDir = String(req.params.genusDir);
      const file = path.basename(String(req.params.file));
      if (!genusDir || genusDir.includes("..") || /[/\\]/.test(genusDir)) {
        res.status(400).end();
        return;
      }
      const speciesBase = getSpeciesDataDir(root);
      const genusPath = path.join(speciesBase, genusDir);

      if (!assertInsideDir(speciesBase, genusPath)) {
        res.status(403).end();
        return;
      }
      const photosDir = findGenusPhotosFolder(genusPath, genusDir);
      if (!photosDir) {
        res.status(404).end();
        return;
      }
      // ?size=thumb|card serves the generated WebP derivative (npm run images) and silently falls
      // back to the original, so hand-added artwork keeps working until derivatives are rebuilt.
      const size = String(req.query.size ?? "");
      const derivativeDir = size === "thumb" ? "_thumbs" : size === "card" ? "_cards" : null;
      let abs = path.join(photosDir, file);
      if (derivativeDir) {
        const stem = file.replace(/\.[^.]+$/, "");
        const candidate = path.join(photosDir, derivativeDir, `${stem}.webp`);
        if (assertInsideDir(photosDir, candidate)) {
          try {
            if ((await fsp.stat(candidate)).isFile()) abs = candidate;
          } catch {
            /* fall back to the original */
          }
        }
      }
      if (!assertInsideDir(photosDir, abs)) {
        res.status(403).end();
        return;
      }
      try {
        const st = await fsp.stat(abs);
        if (!st.isFile()) {
          res.status(404).end();
          return;
        }
      } catch {
        res.status(404).end();
        return;
      }
      res.setHeader("Cache-Control", `public, max-age=${SPECIES_PHOTO_MAX_AGE_S}`);
      res.sendFile(abs, (err) => {
        if (err && !res.headersSent) res.status(404).end();
      });
    })();
  });

  app.get("/api/genus-notes/:genusDir", (req, res) => {
    const genusDir = String(req.params.genusDir);
    if (!genusDir || genusDir.includes("..") || /[/\\]/.test(genusDir)) {
      res.status(400).type("text/plain").send("Invalid genus parameter.");
      return;
    }
    const speciesBase = getSpeciesDataDir(root);
    const genusPath = path.join(speciesBase, genusDir);
    if (!assertInsideDir(speciesBase, genusPath)) {
      res.status(400).type("text/plain").send("Invalid genus path.");
      return;
    }
    if (!existsSync(genusPath) || !statSync(genusPath).isDirectory()) {
      res.status(404).type("text/plain").send("Genus folder not found.");
      return;
    }
    const notesPath = findGenusNotesFile(genusPath, genusDir);
    if (!notesPath) {
      res.status(404).type("text/plain").send("No *notes*.txt file in this genus folder.");
      return;
    }
    try {
      const text = readFileSync(notesPath, "utf8");
      res.type("text/plain; charset=utf-8").send(text);
    } catch {
      res.status(500).type("text/plain").send("Could not read notes file.");
    }
  });

  app.get("/api/exomastery-feeder-json/:genusDir/:basename", (req, res) => {
    const genusDir = String(req.params.genusDir);
    const basename = path.basename(String(req.params.basename));
    if (!genusDir || genusDir.includes("..") || /[/\\]/.test(genusDir)) {
      res.status(400).json({ error: "Invalid genus parameter." });
      return;
    }
    if (!basename || basename.includes("..")) {
      res.status(400).json({ error: "Invalid file name." });
      return;
    }
    const speciesBase = getSpeciesDataDir(root);
    const genusPath = path.join(speciesBase, genusDir);
    if (!assertInsideDir(speciesBase, genusPath)) {
      res.status(403).end();
      return;
    }
    if (!existsSync(genusPath) || !statSync(genusPath).isDirectory()) {
      res.status(404).json({ error: "Genus folder not found." });
      return;
    }
    const absRoot = path.join(genusPath, basename);
    const absSub = path.join(genusPath, "exomastery", basename);
    let abs = absRoot;
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      abs = absSub;
    }
    if (!assertInsideDir(genusPath, abs)) {
      res.status(403).end();
      return;
    }
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      res.status(404).json({ error: "Exomastery profile not found." });
      return;
    }
    if (!basename.endsWith(".json")) {
      res.status(400).json({ error: "Only JSON exports are allowed." });
      return;
    }
    try {
      const raw = readFileSync(abs, "utf8");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${basename}"`);
      res.send(raw);
    } catch {
      res.status(500).json({ error: "Could not read file." });
    }
  });

  /**
   * Cheap status for the launcher window. It polls every 2.5 s and only renders a lamp, the journal
   * folder, a file count and the connect URLs — but it used to call /api/state, which rebuilds the
   * whole snapshot (~186 ms, ~630 KB) and consumed the one-shot auto-select key. This endpoint
   * reads store fields directly and allocates nothing.
   */
  /**
   * The sector heat map's data (Phase 10 step 3).
   *
   * Served from `data/exomastery/sector-map.json`, which the feeder writes — the app never opens the
   * corpus store. Read on demand rather than held in the snapshot: it is 87 kB, the map is one
   * screen among many, and most sessions never open it.
   *
   * A missing file is a 404 rather than an error. The map is a derived artefact; a build that has
   * not run the feeder should show "no map yet", not a broken app.
   */
  /**
   * The vendored region map, for the galaxy backdrop.
   *
   * 179 kB of run-length rows, served whole and cached hard: it is checked-in data that changes only
   * when the file is replaced, and the client paints it once into a canvas. Sent from disk rather
   * than through the decoder so the bytes on the wire are the bytes in the repo, notice and all.
   */
  app.get("/api/galaxy/my-sectors", (_req, res) => {
    perfCount("http.commanderSectors");
    if (!opts.getCommanderSectors) {
      res.status(404).json({ error: "no journal store behind this build" });
      return;
    }
    res.json(opts.getCommanderSectors());
  });

  app.get("/api/galaxy/species", (_req, res) => {
    perfCount("http.galaxySpecies");
    if (!opts.getGalaxySpecies) {
      res.status(404).json({ error: "no galaxy index in this build" });
      return;
    }
    res.json(opts.getGalaxySpecies());
  });

  app.get("/api/galaxy/regions", (_req, res) => {
    perfCount("http.galaxyRegions");
    if (!opts.getGalaxyRegions) {
      res.status(404).json({ error: "no galaxy body file on this machine" });
      return;
    }
    res.json(opts.getGalaxyRegions());
  });

  /**
   * Bodies that could hold a species, in places nobody has looked.
   *
   * The evidence ticks arrive as three independent booleans rather than a mode, because that is
   * what they are: FSS-only, already probed, and already walked are separate questions and the
   * commander may want any combination. Defaults match the panel's — untouched bodies only.
   */
  app.get("/api/galaxy/possible", (req, res) => {
    perfCount("http.galaxyPossible");
    if (!opts.scanGalaxyBodies) {
      res.status(404).json({ error: "no galaxy body file on this machine" });
      return;
    }
    const regionId = Number(req.query.regionId ?? 0);
    if (!Number.isFinite(regionId) || regionId <= 0) {
      res.status(400).json({ error: "regionId must be a positive region index" });
      return;
    }
    const limit = Number(req.query.limit ?? 200);
    const list = (v: unknown): string[] | undefined => {
      const raw = String(v ?? "").trim();
      if (!raw) return undefined;
      const parts = raw
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      return parts.length ? parts : undefined;
    };
    // Absent means the default, so `fss=0` can turn the default off — `!== "0"` would read a
    // missing parameter as a tick the commander never made.
    const tick = (v: unknown, fallback: boolean): boolean => {
      const raw = String(v ?? "").trim();
      if (!raw) return fallback;
      return raw === "1" || raw.toLowerCase() === "true";
    };
    opts
      .scanGalaxyBodies(
        {
          regionId: Math.trunc(regionId),
          speciesIds: list(req.query.species),
          genusDirs: list(req.query.genus),
          includeUnprobed: tick(req.query.fss, true),
          includeProbed: tick(req.query.dss, false),
          includeWalked: tick(req.query.walked, false),
          // Absent or 0 means no floor, which is the default; see GalaxyBodyScanQueryDTO.
          minGravityOddsPct: Number(req.query.minGravityOdds ?? 0) || 0,
        },
        Number.isFinite(limit) ? limit : 200,
      )
      .then((dto) => res.json(dto))
      .catch((e: unknown) => {
        console.warn(`ED Exo Compare — galaxy body scan failed: ${String(e)}`);
        res.status(500).json({ error: "the galaxy body scan failed" });
      });
  });

  app.get("/api/galaxy/worth", (req, res) => {
    perfCount("http.galaxyWorth");
    if (!opts.searchGalaxyByValue) {
      res.status(404).json({ error: "no galaxy index in this build" });
      return;
    }
    const minCr = Number(req.query.minCr ?? 0);
    const limit = Number(req.query.limit ?? 200);
    if (!Number.isFinite(minCr) || minCr < 0) {
      res.status(400).json({ error: "minCr must be a non-negative number" });
      return;
    }
    /** Comma-separated so the whole query stays a GET a human can read in a log. */
    const list = (v: unknown): string[] | undefined => {
      const raw = String(v ?? "").trim();
      if (!raw) return undefined;
      const parts = raw
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      return parts.length ? parts : undefined;
    };
    const tiers = Number(req.query.tiers ?? 0);
    res.json(
      opts.searchGalaxyByValue(
        {
          minCr,
          speciesIds: list(req.query.species),
          genusDirs: list(req.query.genus),
          requireTiers: Number.isFinite(tiers) && tiers > 0 ? tiers : 0,
        },
        Number.isFinite(limit) ? limit : 200,
      ),
    );
  });

  app.get("/api/discoveries", (_req, res) => {
    perfCount("http.discoveries");
    if (!opts.getDiscoveries) {
      res.status(404).json({ error: "discoveries not available in this build" });
      return;
    }
    res.json(opts.getDiscoveries());
  });

  app.get("/api/backlog-map", (_req, res) => {
    perfCount("http.backlogMap");
    if (!opts.getBacklogMap) {
      res.status(404).json({ error: "no journal store behind this build" });
      return;
    }
    res.json(opts.getBacklogMap());
  });

  app.get("/api/region-map", (_req, res) => {
    perfCount("http.regionMap");
    const file = path.join(getProjectRoot(), "data", "exomastery", "region-map.json");
    if (!existsSync(file)) {
      res.status(404).json({ error: "no region map vendored in this build" });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.type("application/json").send(readFileSync(file, "utf8"));
  });

  /**
   * The galaxy photograph the region map is drawn over, when this machine has one.
   *
   * Served from `data/galaxy/`, which is gitignored, and 404s cleanly when the file is absent — the
   * backdrop then paints exactly as it did before, region colours on nothing. That is deliberate:
   * the image is a picture of the Milky Way as the game renders it, and shipping it inside a public
   * MIT repository is a licensing decision for the owner to make, not a side effect of adding a
   * backdrop. Nothing here copies it anywhere it would be committed.
   */
  app.get("/api/galaxy-image", (_req, res) => {
    perfCount("http.galaxyImage");
    const file = path.join(getProjectRoot(), "data", "galaxy", "milkyway-game-normalized.jpg");
    if (!existsSync(file)) {
      res.status(404).json({ error: "no galaxy image on this machine" });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.type("image/jpeg").send(readFileSync(file));
  });

  app.get("/api/first-discovery-backlog", (_req, res) => {
    perfCount("http.firstDiscoveryBacklog");
    if (!opts.getFirstDiscoveryBacklog) {
      res.status(404).json({ error: "no journal store behind this build" });
      return;
    }
    res.json(opts.getFirstDiscoveryBacklog());
  });

  app.get("/api/sector-map", (_req, res) => {
    perfCount("http.sectorMap");
    const file = path.join(getProjectRoot(), "data", "exomastery", "sector-map.json");
    if (!existsSync(file)) {
      res.status(404).json({ error: "no sector map built yet — run: npm run feeder -- sector-map --write" });
      return;
    }
    res.type("application/json").send(readFileSync(file, "utf8"));
  });

  /**
   * One sector's systems (Phase 10 step 4).
   *
   * The file is 935 kB for 3,015 systems and would be far larger once the Spansh export lands, so
   * the client never downloads it — it asks for the cell it just clicked. The file is parsed once
   * and held; it changes only when the feeder runs, and re-reading 935 kB per hover would be silly.
   *
   * The cell key arrives as a query parameter rather than a path segment because it contains colons.
   */
  let sectorSystemsCache: { mtimeMs: number; cells: Record<string, unknown[]> } | null = null;
  app.get("/api/sector-systems", (req, res) => {
    perfCount("http.sectorSystems");
    const cell = String(req.query.cell ?? "").trim();
    if (!/^-?\d+:-?\d+:-?\d+$/.test(cell)) {
      res.status(400).json({ error: "cell must look like x:y:z" });
      return;
    }
    const file = path.join(getProjectRoot(), "data", "exomastery", "sector-systems.json");
    if (!existsSync(file)) {
      res
        .status(404)
        .json({ error: "no sector systems built yet — run: npm run feeder -- sector-map --write" });
      return;
    }
    const mtimeMs = statSync(file).mtimeMs;
    if (!sectorSystemsCache || sectorSystemsCache.mtimeMs !== mtimeMs) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { cells?: Record<string, unknown[]> };
      sectorSystemsCache = { mtimeMs, cells: parsed.cells ?? {} };
    }
    res.json({ cell, systems: sectorSystemsCache.cells[cell] ?? [] });
  });

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
  app.get("/api/carriers/status", (_req, res) => {
    res.json(readCarrierStatus());
  });

  app.post("/api/carriers/fetch", async (req, res) => {
    const force = req.body?.force === true;
    try {
      const result = await fetchCarrierData({ force });
      if (!result.ok) {
        // 409 rather than 500: a cooldown is the server working, not failing, and the panel shows
        // the message beside a button it leaves enabled.
        res.status(409).json({ ok: false, error: result.error, status: result.status });
        return;
      }
      res.json({ ok: true, unchanged: result.unchanged === true, status: result.status });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /*
    Points of interest, from EDAstro's Galactic Exploration Catalog. Same shape as the carrier
    routes, same rule: the commander presses a button, the fetch happens on their machine, and it
    never goes through a server of ours.
  */
  /*
    Statistics: income by source, activity and balances, over a window.

    The scan behind it reads 303 MB of journals and is cached on a manifest of the folder, so the
    first call after a new journal costs a few seconds and the rest are arithmetic.
  */
  app.get("/api/statistics", async (req, res) => {
    if (typeof opts.getStatisticsScan !== "function") {
      res.status(501).json({ error: "Not available" });
      return;
    }
    const window = typeof req.query?.window === "string" ? req.query.window : "all";
    try {
      const scan = await opts.getStatisticsScan();
      res.json(summariseStatistics(scan, window));
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/poi/status", (_req, res) => {
    res.json(readPoiStatus());
  });

  app.post("/api/poi/fetch", async (req, res) => {
    const force = req.body?.force === true;
    try {
      const result = await fetchPoiData({ force });
      if (!result.ok) {
        res.status(409).json({ ok: false, error: result.error, status: result.status });
        return;
      }
      res.json({ ok: true, status: result.status });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/poi/query", (req, res) => {
    const groupsRaw = req.query?.groups;
    const groups =
      typeof groupsRaw === "string" && groupsRaw.trim()
        ? groupsRaw
            .split(",")
            .map((g) => g.trim())
            .filter(Boolean)
        : [];
    const minRating = Number(req.query?.minRating);
    const limit = Number(req.query?.limit);
    const origin = opts.getCommanderPosition();
    const query = {
      origin,
      groups,
      organicOnly: req.query?.organicOnly === "1",
      minRating: Number.isFinite(minRating) ? minRating : 0,
      search: typeof req.query?.q === "string" ? req.query.q : "",
      limit: Number.isFinite(limit) ? limit : 100,
    };
    res.json({ rows: queryPoi(query), matchCount: countPoi(query), status: readPoiStatus(), origin });
  });

  /*
    One carrier, checked against Spansh on the commander's own press.

    Deliberately not automatic and deliberately not a correction: the two sources disagree in both
    directions (Spansh newer on 9 of 16 sampled, EDAstro newer on 3), so this answers "does anyone
    else know something" for a single row rather than quietly rewriting the list.
  */
  app.get("/api/carriers/live", async (req, res) => {
    const callsign = typeof req.query?.callsign === "string" ? req.query.callsign : "";
    const cachedSystem = typeof req.query?.system === "string" ? req.query.system : "";
    const origin = opts.getCommanderPosition();
    const distanceFrom = (x: number | null, y: number | null, z: number | null) =>
      origin && x != null && y != null && z != null
        ? Math.sqrt((x - origin.x) ** 2 + (y - origin.y) ** 2 + (z - origin.z) ** 2)
        : null;
    // Compared case-insensitively on the trimmed name: the sources agree on spelling, but a stray
    // space would otherwise read as "it moved".
    const differsFrom = (system: string) =>
      cachedSystem.trim().length > 0 && system.trim().toLowerCase() !== cachedSystem.trim().toLowerCase();

    try {
      /*
        EDAstro's own map feed first.

        It is the only source that knew OASIS Vera Rubin had jumped -- the daily CSV and Spansh both
        still had the previous system, from the same EDDN event. It covers ~2,300 carriers: the
        curated networks and whatever moved recently. Fetched once per session, held in memory, never
        written to disk, so a restart falls back to the CSV and nothing upstream can corrupt what is
        stored.
      */
      const onMap = await lookupCarrierOnGalmap(callsign, EDASTRO_USER_AGENT);
      if (onMap) {
        res.json({
          ok: true,
          fix: {
            callsign: onMap.callsign,
            system: onMap.system,
            // The map carries no per-carrier sighting time, so there is none to report. Saying
            // "unknown" is honest where inventing "now" would not be.
            updatedAt: null,
            distanceLy: distanceFrom(onMap.x, onMap.y, onMap.z),
            differs: differsFrom(onMap.system),
            marketId: null,
            source: "galmap",
            network: onMap.network,
            // 767 of the feed's carriers sit in a cluster pin that is nobody's position.
            positionUnknown: onMap.x == null,
          },
        });
        return;
      }

      // Not on the map: Spansh still covers the other ~88,000.
      const result = await lookupCarrierOnSpansh(callsign);
      if (!result.ok) {
        res.status(result.notFound ? 404 : 502).json({ ok: false, error: result.error });
        return;
      }
      const { fix } = result;
      res.json({
        ok: true,
        fix: {
          callsign: fix.callsign,
          system: fix.system,
          updatedAt: fix.updatedAt,
          distanceLy: distanceFrom(fix.x, fix.y, fix.z),
          differs: differsFrom(fix.system),
          marketId: fix.marketId,
          source: "spansh",
          network: null,
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/carriers/query", (req, res) => {
    const origin = opts.getCommanderPosition();
    // One parser, tested: see parseCarrierQueryParams. Inlining this is how the OASIS filter shipped
    // as a chip that did nothing.
    const query = parseCarrierQueryParams(req.query as Record<string, unknown>, origin);
    res.json({
      rows: queryCarriers(query),
      matchCount: countCarriers(query),
      status: readCarrierStatus(),
      origin,
    });
  });

  /**
   * Whether Elite is in a display mode the HUDs can be drawn over.
   *
   * Read fresh on every call rather than cached at boot: the commander changes this while the app is
   * running, and a cached "borderless" would keep telling him everything is fine while he stares at
   * a screen with no overlay on it.
   */
  app.get("/api/elite-display-mode", (_req, res) => {
    const status = readEliteDisplayMode();
    res.json({ ...status, warning: eliteDisplayWarning(status) });
  });

  app.get("/api/state", (req, res) => {
    perfCount("http.apiState");
    const chq = parseWsChannel(req.query?.channel) ?? "app";
    const body = perfTime("http.apiState.serialize", () =>
      JSON.stringify(slimSnapshotForChannel(opts.getSnapshot(), chq)),
    );
    sendJson(req, res, body, (raw, sent) => {
      perfBytes("http.apiState.bytes", raw);
      perfBytes("http.apiState.sent", sent);
    });
  });

  const fetchWithTimeout = async (url: string, ms: number): Promise<Response> => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try {
      return await fetch(url, {
        signal: ac.signal,
        headers: { Accept: "application/json", "User-Agent": EDSM_USER_AGENT },
      });
    } finally {
      clearTimeout(t);
    }
  };

  /** Proxies FDev / Frontier status (browser-safe; avoids CORS). */
  app.get("/api/elite-server-status/orerve", async (_req, res) => {
    const url = "https://ed-server-status.orerve.net/";
    try {
      const r = await fetchWithTimeout(url, 12_000);
      if (!r.ok) {
        res.status(502).json({ ok: false });
        return;
      }
      const j = (await r.json()) as { status?: string; code?: number; message?: string };
      const code = Number(j.code);
      const statusText =
        typeof j.status === "string" && j.status.trim()
          ? j.status.trim()
          : typeof j.message === "string" && j.message.trim()
            ? j.message.trim()
            : code === 1
              ? "Good"
              : "Unknown";
      const healthy = code === 1 || /^good$/i.test(statusText) || /^good$/i.test(String(j.message ?? ""));
      res.json({
        ok: true as const,
        healthy,
        statusText,
      });
    } catch {
      res.status(502).json({ ok: false });
    }
  });

  app.get("/api/elite-server-status/edsm", async (_req, res) => {
    const url = "https://www.edsm.net/api-status-v1/elite-server";
    try {
      const r = await fetchWithTimeout(url, 12_000);
      if (!r.ok) {
        res.status(502).json({ ok: false });
        return;
      }
      const j = (await r.json()) as { message?: string; status?: number; type?: string };
      const statusText = typeof j.message === "string" && j.message.trim() ? j.message.trim() : "Unknown";
      const healthy = Number(j.status) === 1 && String(j.type).toLowerCase() === "success";
      res.json({
        ok: true as const,
        healthy,
        statusText,
      });
    } catch {
      res.status(502).json({ ok: false });
    }
  });

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
  app.get("/api/feeder/status", (_req, res) => {
    if (typeof opts.getFeederStatus !== "function") {
      res.status(501).json({ error: "Not available" });
      return;
    }
    try {
      res.json(opts.getFeederStatus());
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

  app.post("/api/settings/journal-directory", async (req, res) => {
    if (typeof opts.setJournalDirectory !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const dir = req.body?.journalDir;
    if (typeof dir !== "string" || !dir.trim()) {
      res.status(400).json({ ok: false, error: 'JSON body must include string "journalDir".' });
      return;
    }
    const result = await opts.setJournalDirectory(dir.trim());
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error ?? "Invalid folder." });
      return;
    }
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  /**
   * Where the feeder corpus lives, remembered across restarts.
   *
   * Needed because the two built-in search paths are relative to `PROJECT_ROOT`, which in a packaged
   * build is the install directory — so a corpus kept beside the repository is unreachable and the
   * feeder hides itself. Sending `null` forgets the path and falls back to the search.
   */
  /**
   * Accept a Spansh exobiology route export and queue it for the feeder.
   *
   * The file is parsed here so the panel can say what is in it immediately, and then written to the
   * corpus inbox rather than imported: the packaged app has no `sql.js` and cannot write a row to
   * the corpus. `npm run feeder -- import` drains the inbox.
   *
   * A route export is a few hundred kilobytes, so it arrives as text in the JSON body rather than as
   * a multipart upload, which would mean a new dependency for one endpoint.
   */
  app.post("/api/feeder/import", (req, res) => {
    const text = req.body?.text;
    const name = typeof req.body?.filename === "string" ? req.body.filename : "route";
    if (typeof text !== "string" || !text.trim()) {
      res.status(400).json({ ok: false, error: 'JSON body must include a non-empty string "text".' });
      return;
    }
    if (!feederDataDirExists()) {
      res
        .status(409)
        .json({ ok: false, error: "No corpus on this machine. Set its folder in Options first." });
      return;
    }
    let summary;
    try {
      summary = summariseSpanshRouteFile(parseSpanshRouteFile(text));
    } catch (e) {
      res
        .status(400)
        .json({ ok: false, error: e instanceof Error ? e.message : "Could not read that file." });
      return;
    }
    if (summary.rows === 0) {
      res.status(400).json({ ok: false, error: "No landmark rows in that file." });
      return;
    }
    try {
      const dir = feederInboxDir();
      mkdirSync(dir, { recursive: true });
      // Timestamp first so the inbox drains oldest-first by name, and the original name is kept so
      // the owner can tell two routes apart.
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safe = name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "route";
      const ext = summary.format === "json" ? "json" : "csv";
      const file = path.join(dir, `${stamp}__${safe.replace(/\.(json|csv)$/i, "")}.${ext}`);
      writeFileSync(file, text, "utf8");
      res.json({ ok: true, queuedAs: file, summary });
    } catch (e) {
      res
        .status(500)
        .json({ ok: false, error: e instanceof Error ? e.message : "Could not queue the file." });
    }
  });

  app.post("/api/settings/feeder-data-directory", (req, res) => {
    const raw = req.body?.feederDataDir;
    if (raw !== null && typeof raw !== "string") {
      res.status(400).json({ ok: false, error: 'JSON body must include string or null "feederDataDir".' });
      return;
    }
    const result = setConfiguredFeederDataDir(raw);
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error ?? "Invalid folder." });
      return;
    }
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  app.post("/api/settings/journal-history", async (req, res) => {
    if (typeof opts.setJournalHistoryPreset !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const preset = req.body?.preset;
    if (!isJournalHistoryPreset(preset)) {
      res.status(400).json({
        ok: false,
        error: 'JSON body must include string "preset" (all | 1m | 6m | 1y … 5y).',
      });
      return;
    }
    try {
      await opts.setJournalHistoryPreset(preset);
      opts.scheduleBroadcast?.();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /** POST /api/settings/hud-prefs — the launcher mirrors its HUD settings here for phones. */
  app.post("/api/settings/hud-prefs", (req, res) => {
    if (typeof opts.setHudPrefs !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const body = req.body;
    if (!body || typeof body !== "object") {
      res.status(400).json({ ok: false, error: "JSON body must be an object." });
      return;
    }
    opts.setHudPrefs(body);
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  /**
   * How often the server re-reads `Status.json` and tails the journal.
   *
   * Both numbers are sent together even when one changed: the pair is one setting in the launcher,
   * and a partial body would make "leave the other alone" a second, silent meaning for a missing
   * field. The values are clamped server-side (`shared/pollRates.ts`) and the accepted pair comes
   * back, so a launcher that is out of step with the bounds still ends up showing the truth.
   */
  app.post("/api/settings/poll-rates", (req, res) => {
    if (typeof opts.setPollRates !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const body = req.body;
    if (!body || typeof body !== "object") {
      res.status(400).json({ ok: false, error: "JSON body must be an object." });
      return;
    }
    const statusMs = (body as { statusPollMs?: unknown }).statusPollMs;
    const journalMs = (body as { journalPollMs?: unknown }).journalPollMs;
    if (!Number.isFinite(Number(statusMs)) || !Number.isFinite(Number(journalMs))) {
      res
        .status(400)
        .json({ ok: false, error: 'JSON body must include numbers "statusPollMs" and "journalPollMs".' });
      return;
    }
    const applied = opts.setPollRates(statusMs, journalMs);
    res.json({ ok: true, ...applied });
  });

  /**
   * The collection marker's thresholds, read and written.
   *
   * The reply is always the stored config, so a value the server clamped comes straight back and the
   * panel shows what will actually be used rather than what was typed.
   */
  app.get("/api/settings/collection-focus", (_req, res) => {
    if (typeof opts.getCollectionFocus !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    res.json({ ok: true, config: opts.getCollectionFocus() });
  });

  app.post("/api/settings/collection-focus", (req, res) => {
    if (typeof opts.setCollectionFocus !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const body = req.body;
    if (!body || typeof body !== "object") {
      res.status(400).json({ ok: false, error: "JSON body must be an object." });
      return;
    }
    res.json({ ok: true, config: opts.setCollectionFocus(body) });
  });

  /** How far the sample radar draws. See `shared/radarRadius.ts` for the bounds and the reason. */
  app.post("/api/settings/radar-radius", (req, res) => {
    if (typeof opts.setRadarRadiusM !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const raw = (req.body as { radiusM?: unknown } | undefined)?.radiusM;
    if (!Number.isFinite(Number(raw))) {
      res.status(400).json({ ok: false, error: 'JSON body must include a number "radiusM".' });
      return;
    }
    res.json({ ok: true, radiusM: opts.setRadarRadiusM(raw) });
  });

  app.post("/api/settings/include-bacterium", (req, res) => {
    if (typeof opts.setIncludeBacterium !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const value = req.body?.value;
    if (typeof value !== "boolean") {
      res.status(400).json({ ok: false, error: 'JSON body must include boolean "value".' });
      return;
    }
    opts.setIncludeBacterium(value);
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  app.post("/api/settings/include-exploration-scan-data", (req, res) => {
    if (typeof opts.setIncludeExplorationScanData !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const value = req.body?.value;
    if (typeof value !== "boolean") {
      res.status(400).json({ ok: false, error: 'JSON body must include boolean "value".' });
      return;
    }
    opts.setIncludeExplorationScanData(value);
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  app.post("/api/settings/foot-travel-odometer", (req, res) => {
    if (typeof opts.setFootTravelOdometer !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const value = req.body?.value;
    if (typeof value !== "boolean") {
      res.status(400).json({ ok: false, error: 'JSON body must include boolean "value".' });
      return;
    }
    opts.setFootTravelOdometer(value);
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  app.get("/api/system/spansh-search", async (req, res) => {
    if (typeof opts.searchSpanshSystems !== "function") {
      res.status(501).json({ error: "Not available" });
      return;
    }
    const qRaw = req.query?.q;
    const q = typeof qRaw === "string" ? qRaw : "";
    try {
      const result = await opts.searchSpanshSystems(q);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json({ systems: result.systems });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/system/hydrate-from-spansh", async (req, res) => {
    if (typeof opts.hydrateSystemFromSpansh !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const systemAddress = req.body?.systemAddress;
    const systemName = req.body?.systemName;
    if (typeof systemAddress !== "number" || !Number.isFinite(systemAddress)) {
      res.status(400).json({ ok: false, error: 'JSON body must include numeric "systemAddress".' });
      return;
    }
    if (typeof systemName !== "string" || !systemName.trim()) {
      res.status(400).json({ ok: false, error: 'JSON body must include non-empty string "systemName".' });
      return;
    }
    try {
      const result = await opts.hydrateSystemFromSpansh(systemAddress, systemName.trim());
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error ?? "Spansh hydrate failed." });
        return;
      }
      opts.scheduleBroadcast?.();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/system/edsm-search", async (req, res) => {
    if (typeof opts.searchEdsmSystems !== "function") {
      res.status(501).json({ error: "Not available" });
      return;
    }
    const qRaw = req.query?.q;
    const q = typeof qRaw === "string" ? qRaw : "";
    try {
      const result = await opts.searchEdsmSystems(q);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json({ systems: result.systems });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/api/settings/edsm-credentials", (_req, res) => {
    if (typeof opts.getEdsmCredentialsStatus !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    res.json({ ok: true, ...opts.getEdsmCredentialsStatus() });
  });

  app.post("/api/settings/edsm-credentials", (req, res) => {
    if (typeof opts.setEdsmCredentials !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const commanderName = req.body?.commanderName;
    const apiKey = req.body?.apiKey;
    if (typeof commanderName !== "string" || typeof apiKey !== "string") {
      res.status(400).json({ ok: false, error: "commanderName and apiKey are required." });
      return;
    }
    const r = opts.setEdsmCredentials(commanderName, apiKey);
    // The key is never echoed back, not even on success — the status shape carries a four-character
    // hint and nothing more.
    res.status(r.ok ? 200 : 400).json(r);
  });

  app.delete("/api/settings/edsm-credentials", (_req, res) => {
    if (typeof opts.forgetEdsmCredentials !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    opts.forgetEdsmCredentials();
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  app.post("/api/settings/edsm-auto-fetch", (req, res) => {
    if (typeof opts.setEdsmAutoFetchEnabled !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ ok: false, error: "enabled must be a boolean." });
      return;
    }
    const r = opts.setEdsmAutoFetchEnabled(enabled);
    if (r.ok) opts.scheduleBroadcast?.();
    res.status(r.ok ? 200 : 400).json(r);
  });

  /**
   * Contributing the journal to EDSM.
   *
   * Two endpoints, because the switch and the work are different decisions: turning it on says the
   * commander agrees to send their journal, and the catch-up run is what actually sends four years
   * of it. Neither happens on its own.
   */
  app.post("/api/settings/edsm-upload", (req, res) => {
    if (typeof opts.setEdsmUploadEnabled !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ ok: false, error: "enabled must be a boolean." });
      return;
    }
    const r = opts.setEdsmUploadEnabled(enabled);
    if (r.ok) opts.scheduleBroadcast?.();
    res.status(r.ok ? 200 : 400).json(r);
  });

  app.post("/api/settings/edsm-live-upload", (req, res) => {
    if (typeof opts.setEdsmLiveUploadEnabled !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ ok: false, error: "enabled must be a boolean." });
      return;
    }
    const r = opts.setEdsmLiveUploadEnabled(enabled);
    if (r.ok) opts.scheduleBroadcast?.();
    res.status(r.ok ? 200 : 400).json(r);
  });

  app.post("/api/settings/edsm-catch-up", (req, res) => {
    if (typeof opts.startEdsmCatchUp !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const scope = req.body?.scope;
    if (scope !== undefined && !isEdsmCatchUpScope(scope)) {
      res.status(400).json({ ok: false, error: "scope must be day, week, month, year or all." });
      return;
    }
    const r = opts.startEdsmCatchUp(scope ?? "all");
    if (r.ok) opts.scheduleBroadcast?.();
    res.status(r.ok ? 200 : 400).json(r);
  });

  app.post("/api/settings/edsm-catch-up-cancel", (_req, res) => {
    if (typeof opts.cancelEdsmCatchUp !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    opts.cancelEdsmCatchUp();
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  app.post("/api/settings/canonn-upload", (req, res) => {
    if (typeof opts.setCanonnUploadEnabled !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ ok: false, error: "enabled must be a boolean." });
      return;
    }
    const r = opts.setCanonnUploadEnabled(enabled);
    if (r.ok) opts.scheduleBroadcast?.();
    res.status(r.ok ? 200 : 400).json(r);
  });

  app.post("/api/system/hydrate-from-edsm", async (req, res) => {
    if (typeof opts.hydrateSystemFromEdsm !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const systemAddress = req.body?.systemAddress;
    const systemName = req.body?.systemName;
    if (typeof systemAddress !== "number" || !Number.isFinite(systemAddress)) {
      res.status(400).json({ ok: false, error: 'JSON body must include numeric "systemAddress".' });
      return;
    }
    if (typeof systemName !== "string" || !systemName.trim()) {
      res.status(400).json({ ok: false, error: 'JSON body must include non-empty string "systemName".' });
      return;
    }
    try {
      const result = await opts.hydrateSystemFromEdsm(systemAddress, systemName.trim());
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error ?? "EDSM hydrate failed." });
        return;
      }
      opts.scheduleBroadcast?.();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/ui/view-system", (req, res) => {
    if (typeof opts.setViewingSystem !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const addrRaw = req.body?.systemAddress;
    if (addrRaw !== null && typeof addrRaw !== "number") {
      res.status(400).json({
        ok: false,
        error: 'JSON body must include "systemAddress": number or null to follow live location.',
      });
      return;
    }
    if (typeof addrRaw === "number" && !Number.isFinite(addrRaw)) {
      res.status(400).json({ ok: false, error: "systemAddress must be a finite number." });
      return;
    }
    if (typeof addrRaw === "number") {
      const starRaw = req.body?.starSystem;
      if (typeof starRaw === "string" && starRaw.trim()) {
        opts.rememberVisitedSystem?.(starRaw.trim(), addrRaw);
      }
    }
    opts.setViewingSystem(addrRaw as number | null);
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  app.post("/api/ui/selected-body", (req, res) => {
    if (typeof opts.setUiSelectedBodyKey !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const raw = req.body?.bodyKey;
    if (raw !== null && typeof raw !== "string") {
      res.status(400).json({ ok: false, error: 'JSON body must include "bodyKey": string | null.' });
      return;
    }
    // The client applies the selection optimistically; the broadcast exists only so the overlay
    // windows follow along. Skip it when nothing changed — this fires on every tab click.
    const changed = opts.setUiSelectedBodyKey(raw);
    if (changed !== false) opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  app.post("/api/settings/exo-map-tiers", (req, res) => {
    if (typeof opts.setExoMapTierThresholds !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const plus = req.body?.plusMinCr;
    const pp = req.body?.plusPlusMinCr;
    if (
      typeof plus !== "number" ||
      typeof pp !== "number" ||
      !Number.isFinite(plus) ||
      !Number.isFinite(pp)
    ) {
      res.status(400).json({
        ok: false,
        error: 'JSON body must include finite numbers "plusMinCr" and "plusPlusMinCr" (CR).',
      });
      return;
    }
    opts.setExoMapTierThresholds(plus, pp);
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  app.post("/api/ui/open-external", (req, res) => {
    if (typeof opts.openAppView !== "function") {
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
    const view = req.body?.view;
    if (view !== "app" && view !== "phone") {
      res.status(400).json({ ok: false, error: 'Send JSON { "view": "app" | "phone" }.' });
      return;
    }
    res.json(opts.openAppView(view));
  });

  app.post("/api/settings/open-miss-log", (req, res) => {
    if (typeof opts.openExoMissLog !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      res.status(403).json({
        ok: false,
        error: "The miss log opens on the PC running the app, so it can only be opened from there.",
      });
      return;
    }
    res.json(opts.openExoMissLog());
  });

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
              "Wrote or updated fixes_*.json next to the codex (original JSON unchanged).",
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

  app.post("/api/exomastery/reload", (_req, res) => {
    if (typeof opts.reloadExomastery !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    try {
      opts.reloadExomastery();
      const root = getProjectRoot();
      res.json({
        ok: true,
        speciesDataDir: getSpeciesDataDir(root),
        projectRoot: root,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.use(
    express.static(webRoot, {
      index: false,
      setHeaders(res, absPath) {
        const norm = absPath.replace(/\\/g, "/").toLowerCase();
        if (norm.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
        } else if (/\/assets\//.test(norm)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/photos")) {
      res.status(404).end();
      return;
    }
    if (req.path.startsWith("/species-photos")) {
      res.status(404).end();
      return;
    }
    if (req.path.startsWith("/api")) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.sendFile(path.join(webRoot, "index.html"), {
      etag: false,
      lastModified: false,
      cacheControl: false,
    });
  });

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
    JSON.stringify({ type: "state", channel, payload: slimSnapshotForChannel(snap, channel) });

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
        const msg = perfTime("ws.serialize", () => stateMessage(snap, ch));
        if (msg === lastBroadcastMsg.get(ch)) {
          perfCount("ws.push.skippedIdentical");
          built.set(ch, null);
        } else {
          lastBroadcastMsg.set(ch, msg);
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
