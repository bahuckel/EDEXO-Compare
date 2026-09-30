/**
 * `/api/ggg/mark` — the commander's own call on a gas giant: it is green, it is not, or no call
 * (server/greenGiants.ts). Open to the phone: he may be looking at the planet while the app is on it.
 */
import type express from "express";
import type { HttpServerOptions, RouteContext } from "../httpServer.js";

export function registerGreenGiantRoutes(app: express.Express, opts: HttpServerOptions, _ctx: RouteContext): void {
  app.post("/api/ggg/mark", (req, res) => {
    const setMark = opts.setGreenGiantMark;
    if (!setMark) {
      res.status(501).json({ ok: false, error: "Not available in this build." });
      return;
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const addr = typeof b.systemAddress === "number" && Number.isFinite(b.systemAddress) ? b.systemAddress : null;
    const bodyId = typeof b.bodyId === "number" && Number.isInteger(b.bodyId) ? b.bodyId : null;
    const mark = b.mark === "yes" || b.mark === "no" ? b.mark : b.mark === null ? null : undefined;
    if (addr == null || bodyId == null || mark === undefined) {
      res.status(400).json({ ok: false, error: "Needs systemAddress, bodyId and mark (yes, no or null)." });
      return;
    }
    const verdict = setMark(addr, bodyId, mark);
    if (verdict === false) {
      res.status(404).json({ ok: false, error: "No scan of that body." });
      return;
    }
    opts.scheduleBroadcast?.();
    res.json({ ok: true, verdict });
  });
}
