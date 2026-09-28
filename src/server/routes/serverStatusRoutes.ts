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
}
