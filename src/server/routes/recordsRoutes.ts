/**
 * `/api/records` — Statistics → Records: the commander's largest and smallest per star type and
 * planet class (notices.ts keeps them) and EDAstro's galactic records (galacticRecords.ts), which
 * download only when asked.
 */
import type express from "express";
import type { HttpServerOptions, RouteContext } from "../httpServer.js";

export function registerRecordsRoutes(
  app: express.Express,
  opts: HttpServerOptions,
  _ctx: RouteContext,
): void {
  app.get("/api/records", (_req, res) => {
    if (!opts.getRecords) {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    res.json({ ok: true, ...opts.getRecords() });
  });

  app.post("/api/records/fetch-galactic", async (req, res) => {
    if (!opts.fetchGalacticRecords) {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    try {
      res.json({ ok: true, ...(await opts.fetchGalacticRecords(req.body?.force === true)) });
    } catch (e) {
      res.status(502).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
