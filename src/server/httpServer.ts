import http from "node:http";
import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import { promises as fsp } from "node:fs";
import { gzip as gzipCb } from "node:zlib";
import express from "express";
import { WebSocketServer } from "ws";
import type {
  AppSnapshot,
  AppStatusDTO,
  EncyclopediaExomasteryPlanetsResponseDTO,
  EncyclopediaSpeciesRowDTO,
  FeederStatusDTO,
  ExoDataAlertDTO,
} from "../shared/types.js";
import type { JournalHistoryPreset } from "../shared/journalHistoryPreset.js";
import { isJournalHistoryPreset } from "../shared/journalHistoryPreset.js";
import { getProjectRoot, getSpeciesDataDir, getWebRoot } from "./paths.js";
import { findGenusPhotosFolder, findGenusNotesFile } from "./speciesTreeLoader.js";
import { perfBytes, perfCount, perfTime } from "./perf.js";
import { createLanAuthGuard, requestIsAuthorized } from "./lanAuth.js";
import { EDSM_USER_AGENT } from "./edsmSystemHydration.js";

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
  /** GET /api/species-encyclopedia — species rows including exomastery flags */
  getEncyclopedia?: () => EncyclopediaSpeciesRowDTO[];
  /**
   * GET /api/feeder/status — feeder corpus vs installed profiles.
   *
   * Absent on a build with no feeder corpus, which is every normal install; the panel hides itself
   * rather than showing empty numbers.
   */
  getFeederStatus?: () => FeederStatusDTO;
  /** POST /api/settings/include-bacterium */
  setIncludeBacterium?: (value: boolean) => void;
  setIncludeExplorationScanData?: (value: boolean) => void;
  /** POST /api/settings/foot-travel-odometer — JSON { value: boolean } */
  setFootTravelOdometer?: (value: boolean) => void;
  /** POST /api/settings/exo-map-tiers — JSON { plusMinCr: number, plusPlusMinCr: number } */
  setExoMapTierThresholds?: (plusMinCr: number, plusPlusMinCr: number) => void;
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
  /** GET /api/system/edsm-search?q= — galaxy name prefix via EDSM (returns id64 as systemAddress). */
  searchEdsmSystems?: (
    query: string,
  ) => Promise<
    { ok: true; systems: { systemAddress: number; starSystem: string }[] } | { ok: false; error: string }
  >;
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
}): { server: http.Server; broadcast: (s: AppSnapshot) => void; listening: Promise<void> } {
  const app = express();
  const root = getProjectRoot();
  const webRoot = getWebRoot(root);

  /**
   * First middleware on purpose: an unpaired LAN client must not reach a route handler, and must
   * not get its request body parsed either.
   */
  const lanKey = opts.lanKey ?? null;
  app.use(createLanAuthGuard(lanKey));

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
  app.get("/api/status", (_req, res) => {
    perfCount("http.apiStatus");
    res.json(opts.getStatus());
  });

  app.get("/api/state", (req, res) => {
    perfCount("http.apiState");
    const body = perfTime("http.apiState.serialize", () => JSON.stringify(opts.getSnapshot()));
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
    perfCount("ws.connect");
    try {
      ws.send(JSON.stringify({ type: "state", payload: opts.getSnapshot() }));
    } catch {
      /* ignore */
    }
    ws.on("close", () => clients.delete(ws));
  });

  /** Last frame sent, so an identical rebuild is not pushed to every client again. */
  let lastBroadcastMsg: string | null = null;

  const broadcast = (snap: AppSnapshot) => {
    const msg = perfTime("ws.serialize", () => JSON.stringify({ type: "state", payload: snap }));
    if (msg === lastBroadcastMsg) {
      perfCount("ws.push.skippedIdentical");
      return;
    }
    lastBroadcastMsg = msg;
    perfCount("ws.push");
    perfBytes("ws.push.bytes", Buffer.byteLength(msg));
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(msg);
        } catch {
          clients.delete(ws);
        }
      }
    }
  };

  server.listen(opts.port, opts.bindHost);
  return { server, broadcast, listening };
}
