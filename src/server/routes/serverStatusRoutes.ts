import express from "express";
import { EDSM_USER_AGENT } from "../edsmSystemHydration.js";

import type { HttpServerOptions, RouteContext } from "../httpServer.js";

export function registerServerStatusRoutes(
  app: express.Express,
  _opts: HttpServerOptions,
  _ctx: RouteContext,
): void {
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

  /*
    One answer shared by every window for STATUS_CACHE_MS (UI review P4): each open window used to
    cause its own outbound request every 15 s. The game's server status does not change that fast.
  */
  const STATUS_CACHE_MS = 45_000;
  const cached = new Map<string, { at: number; body: unknown }>();
  const fromCache = (key: string, res: express.Response): boolean => {
    const c = cached.get(key);
    if (!c || Date.now() - c.at > STATUS_CACHE_MS) return false;
    res.json(c.body);
    return true;
  };

  /** Proxies FDev / Frontier status (browser-safe; avoids CORS). */
  app.get("/api/elite-server-status/orerve", async (_req, res) => {
    if (fromCache("orerve", res)) return;
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
      const body = { ok: true as const, healthy, statusText };
      cached.set("orerve", { at: Date.now(), body });
      res.json(body);
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
}
