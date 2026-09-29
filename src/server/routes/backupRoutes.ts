/**
 * `/api/backup/*` — the launcher's Backups row (docs/galaxy-plan-28092026.md section B).
 *
 * Every route answers the PC running the app only: a backup holds the commander's journals and data,
 * and a restore writes files, neither of which is anything a phone on the LAN should reach.
 */
import type express from "express";
import { mkdirSync } from "node:fs";
import { isLoopbackAddress } from "../lanAuth.js";
import { openLocalFile } from "../openUrl.js";
import type { HttpServerOptions, RouteContext } from "../httpServer.js";

export function registerBackupRoutes(app: express.Express, opts: HttpServerOptions, _ctx: RouteContext): void {
  const service = opts.backup;
  const guard = (req: express.Request, res: express.Response): boolean => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      res.status(403).json({ ok: false, error: "Backups are managed on the PC running the app." });
      return false;
    }
    if (!service) {
      res.status(501).json({ ok: false, error: "Backups are not available in this build." });
      return false;
    }
    return true;
  };
  const fail = (res: express.Response, e: unknown, status = 400) =>
    res.status(status).json({ ok: false, error: e instanceof Error ? e.message : String(e) });

  app.get("/api/backup/status", async (req, res) => {
    if (!guard(req, res)) return;
    res.json({ ok: true, ...(await service!.status()) });
  });

  /** Starts a backup and answers when it is written (a few seconds; the launcher shows it running). */
  app.post("/api/backup/run", async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const r = await service!.runNow("now");
      res.json({ ok: true, result: r });
    } catch (e) {
      fail(res, e, 409);
    }
  });

  app.post("/api/backup/settings", (req, res) => {
    if (!guard(req, res)) return;
    try {
      res.json({ ok: true, settings: service!.setSettings(req.body ?? {}) });
    } catch (e) {
      fail(res, e);
    }
  });

  /** Open the backups folder in Explorer / the file manager (made first, so there is one to open). */
  app.post("/api/backup/open-folder", async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const { folder } = await service!.status();
      mkdirSync(folder, { recursive: true });
      openLocalFile(folder);
      res.json({ ok: true, folder });
    } catch (e) {
      fail(res, e);
    }
  });

  /** Red / yellow / fine for a folder (`?folder=`, else the saved one): same partition, same drive, or not. */
  app.get("/api/backup/folder-check", async (req, res) => {
    if (!guard(req, res)) return;
    try {
      res.json({ ok: true, ...(await service!.checkFolder(typeof req.query.folder === "string" ? req.query.folder : undefined)) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.get("/api/backup/list", async (req, res) => {
    if (!guard(req, res)) return;
    const all = await service!.list();
    res.json({
      ok: true,
      backups: all
        .map((b) => ({
          file: b.file,
          bytes: b.bytes,
          created: b.manifest.created,
          kind: b.manifest.kind,
          commander: b.manifest.commander,
          app: b.manifest.app,
          journals: b.manifest.journals.included.length,
          journalsTotal: b.manifest.journals.all.length,
          appDataFiles: b.manifest.appData.files.length,
          errors: b.manifest.errors.length,
        }))
        .reverse(),
    });
  });

  /**
   * `{file, what: "app-data"}` stages the app data for the next start; `{file, what: "journals",
   * target, allowGameFolder}` writes the journals into `target`.
   */
  app.post("/api/backup/restore", async (req, res) => {
    if (!guard(req, res)) return;
    const b = (req.body ?? {}) as { file?: unknown; what?: unknown; target?: unknown; allowGameFolder?: unknown };
    if (typeof b.file !== "string" || !b.file) return void fail(res, new Error("Which backup?"));
    try {
      if (b.what === "app-data") {
        res.json({ ok: true, ...(await service!.restoreAppData(b.file)) });
      } else if (b.what === "journals") {
        if (typeof b.target !== "string" || !b.target.trim()) return void fail(res, new Error("Choose a folder for the journals."));
        res.json({ ok: true, ...(await service!.restoreJournals(b.file, b.target.trim(), b.allowGameFolder === true)) });
      } else {
        fail(res, new Error("what must be app-data or journals."));
      }
    } catch (e) {
      fail(res, e);
    }
  });
}
