import { getHudBridge } from "../hudBridge.js";
import express from "express";

import type { HttpServerOptions, RouteContext } from "../httpServer.js";

export function registerHudRoutes(app: express.Express, _opts: HttpServerOptions, _ctx: RouteContext): void {
  const hudBridgeOr501 = (res: express.Response) => {
    const bridge = getHudBridge();
    if (!bridge) {
      res.status(501).json({
        ok: false,
        error: "Overlay windows need the desktop app. Start EDExoCompare.exe, or --connect to it.",
      });
      return null;
    }
    return bridge;
  };

  const hudAction = (name: "open" | "toggle" | "set" | "close"): express.RequestHandler => {
    return async (req, res) => {
      const bridge = hudBridgeOr501(res);
      if (!bridge) return;
      const body = (req.body ?? {}) as { pathname?: unknown; width?: unknown; height?: unknown };
      const pathname = typeof body.pathname === "string" ? body.pathname.trim() : "";
      if (name === "close" && !pathname) {
        res.status(400).json({ ok: false, error: 'JSON body must include string "pathname".' });
        return;
      }
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
      try {
        const result =
          name === "close"
            ? await bridge.close({ pathname })
            : await bridge[name]({ pathname, width: num(body.width), height: num(body.height) });
        res.json({ ok: true, result });
      } catch (e) {
        res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    };
  };

  app.get("/api/hud/overlay", async (_req, res) => {
    const bridge = hudBridgeOr501(res);
    if (!bridge) return;
    try {
      res.json({ ok: true, ...(await bridge.state()) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/hud/overlay/open", hudAction("open"));
  app.post("/api/hud/overlay/toggle", hudAction("toggle"));
  app.post("/api/hud/overlay/set", hudAction("set"));
  app.post("/api/hud/overlay/close", hudAction("close"));

  app.get("/api/hud/layout", async (_req, res) => {
    const bridge = hudBridgeOr501(res);
    if (!bridge) return;
    try {
      res.json({ ok: true, layout: await bridge.getLayout() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/hud/layout", async (req, res) => {
    const bridge = hudBridgeOr501(res);
    if (!bridge) return;
    const body = req.body;
    if (!body || typeof body !== "object") {
      res.status(400).json({ ok: false, error: "JSON body must be an object." });
      return;
    }
    try {
      res.json({ ok: true, layout: await bridge.setLayout(body as Record<string, unknown>) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/hud/visibility", async (req, res) => {
    const bridge = hudBridgeOr501(res);
    if (!bridge) return;
    const hidden = (req.body as { hidden?: unknown } | undefined)?.hidden;
    try {
      res.json({
        ok: true,
        ...(await bridge.toggleVisibility({ hidden: typeof hidden === "boolean" ? hidden : undefined })),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
