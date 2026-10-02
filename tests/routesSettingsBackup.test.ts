/**
 * Route tests for the settings and backup routes (review F-F5: 11 of 12 route modules had none;
 * settings and backup first, since they change what is on disk). A real server on port 0 with stub
 * options: each route's "not wired" answer, its validation, and what it hands to the app.
 */
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpServer, type HttpServerOptions } from "../src/server/httpServer.js";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

async function start(extra: Partial<HttpServerOptions> = {}) {
  let broadcasts = 0;
  const { server, listening } = createHttpServer({
    port: 0,
    bindHost: "127.0.0.1",
    getSnapshot: () => ({}) as never,
    getStatus: () => ({}) as never,
    getCommanderPosition: () => null,
    getCommanderSystem: () => null,
    scheduleBroadcast: () => {
      broadcasts += 1;
    },
    ...extra,
  } as HttpServerOptions);
  await listening;
  const port = (server.address() as AddressInfo).port;
  closers.push(() => new Promise((r) => server.close(() => r())));
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* plain text */
    }
    return { status: r.status, json, text, type: r.headers.get("content-type") ?? "" };
  };
  return { call, broadcasts: () => broadcasts };
}

describe("settings routes: not wired", () => {
  it("answer 501 rather than pretending", async () => {
    const s = await start();
    for (const [m, p, b] of [
      ["POST", "/api/settings/journal-history", { preset: "all" }],
      ["POST", "/api/settings/include-bacterium", { value: true }],
      ["POST", "/api/settings/radar-radius", { radiusM: 300 }],
      ["POST", "/api/notices/test", {}],
      ["GET", "/api/app/whats-new", undefined],
      ["GET", "/api/app/diagnostics", undefined],
    ] as const) {
      expect((await s.call(m, p, b)).status, p).toBe(501);
    }
  });
});

describe("settings routes: validation", () => {
  it("refuses bodies of the wrong shape with 400 and a reason", async () => {
    const s = await start({
      setJournalHistoryPreset: async () => {},
      setPollRates: () => ({ statusPollMs: 0, journalPollMs: 0 }) as never,
      setRadarRadiusM: () => 0,
      setIncludeBacterium: () => {},
      setPhotoStamp: () => {},
      setViewingSystem: () => {},
      setUiSelectedBodyKey: () => true,
      setExoMapTierThresholds: () => {},
      markNoticesRead: () => 0,
      openAppView: () => ({ ok: true }) as never,
    });
    const bad: [string, unknown][] = [
      ["/api/settings/journal-history", { preset: "forever" }],
      ["/api/settings/poll-rates", { statusPollMs: 500 }],
      ["/api/settings/radar-radius", { radiusM: "far" }],
      ["/api/settings/include-bacterium", { value: "yes" }],
      ["/api/settings/photo-stamp", { commander: 1 }],
      ["/api/ui/view-system", { systemAddress: "Sol" }],
      ["/api/ui/selected-body", { bodyKey: 7 }],
      ["/api/settings/exo-map-tiers", { plusMinCr: 1 }],
      ["/api/notices/read", { ids: [1, 2] }],
      ["/api/ui/open-external", { view: "galaxy" }],
    ];
    for (const [p, b] of bad) {
      const r = await s.call("POST", p, b);
      expect(r.status, p).toBe(400);
      expect(r.json?.ok, p).toBe(false);
      expect(typeof r.json?.error, p).toBe("string");
    }
    expect(s.broadcasts()).toBe(0);
  });
});

describe("settings routes: what reaches the app", () => {
  it("hands the accepted values over and broadcasts", async () => {
    const got: Record<string, unknown> = {};
    const s = await start({
      setJournalHistoryPreset: async (p) => {
        got.preset = p;
      },
      setPollRates: (a, b) => {
        got.poll = [a, b];
        return { statusPollMs: 250, journalPollMs: 1000 } as never;
      },
      setViewingSystem: (a) => {
        got.view = a;
      },
      lookupSystem: (a, n) => {
        got.lookup = [a, n];
      },
      setUiSelectedBodyKey: () => false,
      markNoticesRead: (ids) => {
        got.read = ids;
        return 3;
      },
    });
    expect((await s.call("POST", "/api/settings/journal-history", { preset: "1y" })).json).toEqual({
      ok: true,
    });
    expect(got.preset).toBe("1y");
    // Clamped by the app; the reply is what it accepted.
    expect(
      (await s.call("POST", "/api/settings/poll-rates", { statusPollMs: 1, journalPollMs: 99999 })).json,
    ).toEqual({
      ok: true,
      statusPollMs: 250,
      journalPollMs: 1000,
    });
    await s.call("POST", "/api/ui/view-system", { systemAddress: 42, starSystem: " Sol " });
    expect(got.view).toBe(42);
    expect(got.lookup).toEqual([42, "Sol"]);
    await s.call("POST", "/api/ui/view-system", { systemAddress: null });
    expect(got.view).toBeNull();
    const before = s.broadcasts();
    // An unchanged tab selection is not broadcast (it fires on every tab click).
    await s.call("POST", "/api/ui/selected-body", { bodyKey: "1:2" });
    expect(s.broadcasts()).toBe(before);
    expect((await s.call("POST", "/api/notices/read", { all: true })).json).toEqual({ ok: true, removed: 3 });
    expect(got.read).toBe("all");
  });
});

describe("app routes added 2026-10-02", () => {
  it("What's new, Copy diagnostics and the test notice", async () => {
    let seen = 0;
    let tests = 0;
    const s = await start({
      getWhatsNew: async (any) => ({
        pending: !any,
        current: "1.2.11",
        from: "1.2.10",
        releases: [],
        error: null,
      }),
      markWhatsNewSeen: () => {
        seen += 1;
      },
      getDiagnostics: async () => "```\nED Exo Compare 1.2.11\n```\n",
      sendTestNotice: () => {
        tests += 1;
      },
    });
    expect((await s.call("GET", "/api/app/whats-new")).json?.pending).toBe(true);
    expect((await s.call("GET", "/api/app/whats-new?any=1")).json?.pending).toBe(false);
    expect((await s.call("POST", "/api/app/whats-new/seen")).json).toEqual({ ok: true });
    expect(seen).toBe(1);
    const d = await s.call("GET", "/api/app/diagnostics");
    expect(d.type).toContain("text/plain");
    expect(d.text).toContain("ED Exo Compare 1.2.11");
    expect((await s.call("POST", "/api/notices/test", {})).json).toEqual({ ok: true });
    expect(tests).toBe(1);
  });
});

describe("backup routes", () => {
  it("answer 501 without the service", async () => {
    const s = await start();
    expect((await s.call("GET", "/api/backup/status")).status).toBe(501);
  });

  it("validate a restore, map the list newest first, and say why a run failed", async () => {
    const backup = {
      status: async () => ({ folder: "x" }),
      runNow: async () => {
        throw new Error("A backup is already running.");
      },
      setSettings: () => {
        throw new Error("No such folder.");
      },
      checkFolder: async () => ({ level: "fine" }),
      list: async () =>
        ["a", "b"].map((file, i) => ({
          file,
          bytes: 10 + i,
          manifest: {
            created: `2026-10-0${i + 1}`,
            kind: "auto",
            commander: "CMDR",
            app: "1.2.11",
            journals: { included: [1], all: [1, 2] },
            appData: { files: [1, 2, 3] },
            errors: [],
          },
        })),
      restoreAppData: async () => ({ staged: true }),
      restoreJournals: async () => ({ written: 2 }),
    };
    const s = await start({ backup: backup as never });
    expect((await s.call("POST", "/api/backup/restore", {})).json?.error).toBe("Which backup?");
    expect((await s.call("POST", "/api/backup/restore", { file: "a", what: "journals" })).json?.error).toBe(
      "Choose a folder for the journals.",
    );
    expect((await s.call("POST", "/api/backup/restore", { file: "a", what: "x" })).status).toBe(400);
    expect((await s.call("POST", "/api/backup/restore", { file: "a", what: "app-data" })).json).toEqual({
      ok: true,
      staged: true,
    });
    const list = (await s.call("GET", "/api/backup/list")).json?.backups as {
      file: string;
      journals: number;
    }[];
    expect(list.map((b) => b.file)).toEqual(["b", "a"]);
    expect(list[0]).toMatchObject({ journals: 1, journalsTotal: 2, appDataFiles: 3, errors: 0 });
    const run = await s.call("POST", "/api/backup/run");
    expect(run.status).toBe(409);
    expect(run.json?.error).toBe("A backup is already running.");
    expect((await s.call("POST", "/api/backup/settings", { folder: "nowhere" })).status).toBe(400);
  });
});
