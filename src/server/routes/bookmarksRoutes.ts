/**
 * `/api/bookmarks` — the commander's bookmarks (server/bookmarks.ts). Open to the phone as well: a
 * bookmark is the commander's own note, and marking a system from the second screen is the point.
 */
import type express from "express";
import { parseBookmarkInput } from "../../shared/bookmarks.js";
import type { HttpServerOptions, RouteContext } from "../httpServer.js";

export function registerBookmarksRoutes(app: express.Express, opts: HttpServerOptions, _ctx: RouteContext): void {
  const service = opts.bookmarks;
  const ready = (res: express.Response): boolean => {
    if (service) return true;
    res.status(501).json({ ok: false, error: "Bookmarks are not available in this build." });
    return false;
  };

  app.get("/api/bookmarks", (_req, res) => {
    if (!ready(res)) return;
    res.json({ ok: true, ...service!.list(opts.getCommanderPosition()) });
  });

  app.post("/api/bookmarks", (req, res) => {
    if (!ready(res)) return;
    const input = parseBookmarkInput(req.body);
    if (!input) {
      res.status(400).json({ ok: false, error: "A bookmark needs a system name." });
      return;
    }
    const pos = input.systemAddress != null ? (opts.systemPositionOf?.(input.systemAddress) ?? null) : null;
    const saved = service!.save(input, pos);
    opts.scheduleBroadcast?.();
    res.json({ ok: true, bookmark: saved });
  });

  app.delete("/api/bookmarks/:id", (req, res) => {
    if (!ready(res)) return;
    const gone = service!.remove(String(req.params.id ?? ""));
    if (gone) opts.scheduleBroadcast?.();
    res.status(gone ? 200 : 404).json({ ok: gone });
  });
}
