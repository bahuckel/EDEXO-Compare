/**
 * Web pages must not drive the app (combined plan 1.4, 2026-10-01): a DNS-rebinding page (its own
 * name in `Host`), a cross-site POST (a foreign `Origin`), and a cross-site WebSocket are refused;
 * the app's own pages, the dev proxy and scripts without an Origin are not. Routes that act on this
 * PC answer to this PC only.
 */
import type { AddressInfo } from "node:net";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createHttpServer } from "../src/server/httpServer.js";
import { localOnly, requestOriginIsAllowed } from "../src/server/lanAuth.js";
import type { AppSnapshot } from "../src/shared/types.js";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

async function start() {
  const { server, listening } = createHttpServer({
    port: 0,
    bindHost: "127.0.0.1",
    getSnapshot: () => ({ n: 1 }) as unknown as AppSnapshot,
    getStatus: () => ({ ok: true }) as never,
    getCommanderPosition: () => null,
    getCommanderSystem: () => null,
  });
  await listening;
  closers.push(() => new Promise((r) => server.close(() => r())));
  return (server.address() as AddressInfo).port;
}

function request(port: number, method: string, path: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end(method === "POST" ? "{}" : undefined);
  });
}

describe("Host and Origin", () => {
  it("refuses a DNS-rebinding page (its own name in Host), for reads too", async () => {
    const port = await start();
    const r = await request(port, "GET", "/api/status", { Host: `evil.example:${port}` });
    expect(r.status).toBe(403);
    expect((await request(port, "GET", "/api/status", { Host: `127.0.0.1:${port}` })).status).toBe(200);
    expect((await request(port, "GET", "/api/status", { Host: "localhost:5173" })).status).toBe(200); // dev proxy
  });

  it("refuses a cross-site POST, and lets the app's own and Origin-less requests through", async () => {
    const port = await start();
    const foreign = await request(port, "POST", "/api/notices/clear-read", {
      Host: `127.0.0.1:${port}`,
      Origin: "https://evil.example",
      "Content-Type": "text/plain",
    });
    expect(foreign.status).toBe(403);
    expect(foreign.body).toContain("foreign_origin");
    for (const headers of <Record<string, string>[]>[
      { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}`, "Content-Type": "application/json" },
      { Host: `127.0.0.1:${port}`, "Content-Type": "application/json" },
    ]) {
      const ok = await request(port, "POST", "/api/notices/clear-read", headers);
      expect(ok.body).not.toContain("foreign_origin");
    }
  });

  it("refuses a WebSocket opened by another site", async () => {
    const port = await start();
    const evil = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: "https://evil.example" });
    const evilResult = await new Promise<string>((r) => {
      evil.on("open", () => r("open"));
      evil.on("unexpected-response", (_q, res) => r(String(res.statusCode)));
      evil.on("error", () => r("error"));
    });
    expect(evilResult).toBe("403");
    const own = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: `http://127.0.0.1:${port}` });
    const ownResult = await new Promise<string>((r) => {
      own.on("open", () => r("open"));
      own.on("error", () => r("error"));
    });
    own.close();
    expect(ownResult).toBe("open");
  });

  it("checks Host for this PC's own requests only; other devices may use any name, same-origin", () => {
    const req = (from: string, host: string, origin?: string) =>
      ({ socket: { remoteAddress: from }, headers: { host, ...(origin ? { origin } : {}) } }) as unknown as http.IncomingMessage;
    const lan = (h: string) => h === "192.168.0.6";
    const o = { checkOrigin: true };
    expect(requestOriginIsAllowed(req("127.0.0.1", "192.168.0.6:7111", "http://192.168.0.6:7111"), lan, o)).toBe(true);
    expect(requestOriginIsAllowed(req("127.0.0.1", "[::1]:7111"), lan, o)).toBe(true);
    expect(requestOriginIsAllowed(req("127.0.0.1", "10.0.0.9:7111"), lan, { checkOrigin: false })).toBe(false);
    // A phone on a public URL or a DDNS name: its own name, same-origin.
    expect(requestOriginIsAllowed(req("203.0.113.5", "my.ddns.example:7111", "http://my.ddns.example:7111"), lan, o)).toBe(true);
    // ...but not another site's page posting from that phone.
    expect(requestOriginIsAllowed(req("203.0.113.5", "my.ddns.example:7111", "https://evil.example"), lan, o)).toBe(false);
    expect(requestOriginIsAllowed(req("192.168.0.20", "192.168.0.6:7111", "null"), lan, o)).toBe(false);
  });
});

describe("localOnly", () => {
  it("answers 403 to a LAN client and passes this PC", () => {
    const run = (addr: string) => {
      let status = 0;
      let passed = false;
      const res = { status: (s: number) => ((status = s), res), json: () => res } as never;
      localOnly({ socket: { remoteAddress: addr } } as never, res, () => (passed = true));
      return { status, passed };
    };
    expect(run("192.168.0.20")).toEqual({ status: 403, passed: false });
    expect(run("::ffff:127.0.0.1")).toEqual({ status: 0, passed: true });
  });
});
