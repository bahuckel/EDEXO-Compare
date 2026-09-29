import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import express from "express";
import type { PhotoStampPrefs } from "../../shared/types.js";
import { isJournalHistoryPreset } from "../../shared/journalHistoryPreset.js";
import { feederDataDirExists, feederInboxDir, setConfiguredFeederDataDir } from "../../feeder/paths.js";
import { parseSpanshRouteFile, summariseSpanshRouteFile } from "../../feeder/spanshRouteFile.js";
import { isLoopbackAddress } from "../lanAuth.js";
import { isEdsmCatchUpScope } from "../edsmCatchUp.js";

import type { HttpServerOptions, RouteContext } from "../httpServer.js";

export function registerSettingsRoutes(
  app: express.Express,
  opts: HttpServerOptions,
  _ctx: RouteContext,
): void {
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

  /* "Notify me" (shared/notices.ts). The reply is the stored settings, after the allow-list. */
  app.get("/api/settings/notify", (_req, res) => {
    if (typeof opts.getNotifySettings !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    res.json({ ok: true, ...opts.getNotifySettings() });
  });

  app.post("/api/settings/notify", (req, res) => {
    if (typeof opts.setNotifyPrefs !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    if (!req.body || typeof req.body !== "object") {
      res.status(400).json({ ok: false, error: "JSON body must be an object." });
      return;
    }
    res.json({ ok: true, ...opts.setNotifyPrefs(req.body) });
  });

  app.post("/api/notices/read", (req, res) => {
    if (typeof opts.markNoticesRead !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const b = (req.body ?? {}) as { ids?: unknown; all?: unknown };
    if (b.all === true) {
      res.json({ ok: true, removed: opts.markNoticesRead("all") });
      return;
    }
    if (!Array.isArray(b.ids) || !b.ids.every((x) => typeof x === "string")) {
      res.status(400).json({ ok: false, error: 'JSON body must be { "ids": string[] } or { "all": true }.' });
      return;
    }
    res.json({ ok: true, removed: opts.markNoticesRead(b.ids as string[]) });
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

  app.post("/api/settings/photo-stamp", (req, res) => {
    if (typeof opts.setPhotoStamp !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const p: Partial<PhotoStampPrefs> = {};
    for (const k of ["commander", "system", "timestamp"] as const) {
      if (body[k] === undefined) continue;
      if (typeof body[k] !== "boolean") {
        res.status(400).json({ ok: false, error: `"${k}" must be a boolean.` });
        return;
      }
      p[k] = body[k] as boolean;
    }
    opts.setPhotoStamp(p);
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

  app.post("/api/settings/eddn-upload", (req, res) => {
    if (typeof opts.setEddnUploadEnabled !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ ok: false, error: "enabled must be a boolean." });
      return;
    }
    const r = opts.setEddnUploadEnabled(enabled);
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
        opts.lookupSystem?.(addrRaw, starRaw.trim());
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
}
