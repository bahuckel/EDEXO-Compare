/**
 * The game server status is fetched once and shared for 45 s (UI review P4, 2026-09-29): every open
 * window used to cause its own outbound request every 15 s.
 */
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerServerStatusRoutes } from "../src/server/routes/serverStatusRoutes.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

describe("game server status", () => {
  it("asks orerve once for many requests inside the cache window, and again after it", async () => {
    let outbound = 0;
    const stub = vi.fn(async (url: string | URL) => {
      if (String(url).includes("orerve")) outbound++;
      return new Response(JSON.stringify({ status: "Good", code: 1 }), { status: 200 });
    });
    const app = express();
    registerServerStatusRoutes(app, {} as never, {} as never);
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as AddressInfo).port;
    // The route's own outbound fetch is stubbed; the test talks to the route with the real fetch.
    globalThis.fetch = ((url: string | URL, init?: RequestInit) =>
      String(url).startsWith("http://127.0.0.1") ? realFetch(url, init) : stub(url)) as typeof fetch;
    try {
      const ask = async () => (await (await fetch(`http://127.0.0.1:${port}/api/elite-server-status/orerve`)).json()) as { healthy: boolean };
      for (let i = 0; i < 5; i++) expect((await ask()).healthy).toBe(true);
      expect(outbound).toBe(1);
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now + 46_000);
      await ask();
      expect(outbound).toBe(2);
    } finally {
      vi.restoreAllMocks();
      server.close();
    }
  });
});
