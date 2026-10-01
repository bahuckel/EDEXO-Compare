/**
 * Pushes carry only what changed (UI review P1/P2, 2026-09-29): on the app channel a big field that is
 * identical to the previous push is left out and named in `unchanged`; the socket's first message is
 * always complete; `/api/state/rev` answers the revision of the last push in a few bytes.
 */
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createHttpServer } from "../src/server/httpServer.js";
import type { AppSnapshot } from "../src/shared/types.js";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

async function start(initial: Record<string, unknown>) {
  let snap = initial as unknown as AppSnapshot;
  const { server, broadcast, listening } = createHttpServer({
    port: 0,
    bindHost: "127.0.0.1",
    getSnapshot: () => snap,
    getStatus: () => ({}) as never,
    getCommanderPosition: () => null,
    getCommanderSystem: () => null,
  });
  await listening;
  const port = (server.address() as AddressInfo).port;
  closers.push(() => new Promise((r) => server.close(() => r())));
  const messages: Record<string, unknown>[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  closers.unshift(async () => ws.close());
  ws.on("message", (d) => messages.push(JSON.parse(String(d))));
  await new Promise((r) => ws.once("open", r));
  const next = async (n: number) => {
    for (let i = 0; i < 100 && messages.length < n; i++) await new Promise((r) => setTimeout(r, 10));
    return messages[n - 1]!;
  };
  return {
    port,
    messages,
    next,
    set: (s: Record<string, unknown>) => {
      snap = s as unknown as AppSnapshot;
      broadcast(snap);
    },
    /** Change what the server would build, without a push. */
    setQuiet: (s: Record<string, unknown>) => {
      snap = s as unknown as AppSnapshot;
    },
  };
}

const big = (tag: string) => Array.from({ length: 400 }, (_, i) => ({ starSystem: `${tag} ${i}`, systemAddress: i }));

describe("snapshot pushes", () => {
  it("send the whole snapshot first, then leave out big fields that did not change", async () => {
    const t = await start({ journalSystems: big("A"), liveShipFuelRange: { ly: 10 } });
    const first = await t.next(1);
    expect((first.payload as Record<string, unknown>).journalSystems).toHaveLength(400);
    expect(first.unchanged).toBeUndefined();

    // First push: every field is new to the push history, so all go out.
    t.set({ journalSystems: big("A"), liveShipFuelRange: { ly: 11 } });
    const p1 = await t.next(2);
    expect(Object.keys(p1.payload as object).sort()).toEqual(["journalSystems", "liveShipFuelRange"]);

    // Only the fuel changed: the big list stays home.
    t.set({ journalSystems: big("A"), liveShipFuelRange: { ly: 12 } });
    const p2 = await t.next(3);
    expect(Object.keys(p2.payload as object)).toEqual(["liveShipFuelRange"]);
    expect(p2.unchanged).toEqual(["journalSystems"]);
    expect(JSON.stringify(p2).length).toBeLessThan(200);

    // The big list changes: it goes out again.
    t.set({ journalSystems: big("B"), liveShipFuelRange: { ly: 12 } });
    const p3 = await t.next(4);
    expect(((p3.payload as Record<string, unknown>).journalSystems as unknown[])[0]).toMatchObject({ starSystem: "B 0" });
    expect(p3.unchanged).toBeUndefined();
  });

  it("does not push a frame when nothing changed, and small fields are always sent", async () => {
    const t = await start({ journalSystems: big("A"), commanderName: "X" });
    await t.next(1);
    t.set({ journalSystems: big("A"), commanderName: "X" });
    await t.next(2);
    t.set({ journalSystems: big("A"), commanderName: "X" });
    t.set({ journalSystems: big("A"), commanderName: "Y" });
    const p = await t.next(3);
    expect(p.payload).toEqual({ commanderName: "Y" });
    expect(p.unchanged).toEqual(["journalSystems"]);
  });

  it("answers the revision of the last push, and sends it with /api/state", async () => {
    const t = await start({ journalSystems: big("A"), n: 0 });
    await t.next(1);
    t.set({ journalSystems: big("A"), n: 1 });
    const p1 = await t.next(2);
    t.set({ journalSystems: big("A"), n: 2 });
    const p2 = await t.next(3);
    expect(p2.rev).toBe((p1.rev as number) + 1);
    const rev = (await (await fetch(`http://127.0.0.1:${t.port}/api/state/rev`)).json()) as { rev: number };
    expect(rev.rev).toBe(p2.rev);
    const full = await fetch(`http://127.0.0.1:${t.port}/api/state`);
    expect(full.headers.get("x-edexo-rev")).toBe(String(p2.rev));
    expect(((await full.json()) as { journalSystems: unknown[] }).journalSystems).toHaveLength(400);
  });

  it("sends only the bodies that changed, with every key in order", async () => {
    const body = (key: string, n: number) => ({
      state: { key, bodyName: `B ${key}`, n },
      matches: [],
      pad: "x".repeat(3000),
    });
    const t = await start({ bodies: [body("1", 0), body("2", 0), body("3", 0)] });
    await t.next(1);
    t.set({ bodies: [body("1", 0), body("2", 0), body("3", 0)], tick: 1 });
    await t.next(2);
    // One body changes and one is added: the others stay home.
    t.set({ bodies: [body("1", 0), body("2", 1), body("3", 0), body("4", 0)], tick: 1 });
    const p = await t.next(3);
    expect((p.payload as Record<string, unknown>).bodies).toBeUndefined();
    const d = p.bodiesDelta as { keys: string[]; changed: { state: { key: string; n: number } }[] };
    expect(d.keys).toEqual(["1", "2", "3", "4"]);
    expect(d.changed.map((b) => [b.state.key, b.state.n])).toEqual([
      ["2", 1],
      ["4", 0],
    ]);
    // Every body changes (a jump): the field goes out whole.
    t.set({ bodies: [body("9", 0), body("8", 0)], tick: 1 });
    const q = await t.next(4);
    expect(q.bodiesDelta).toBeUndefined();
    expect(((q.payload as Record<string, unknown>).bodies as unknown[]).length).toBe(2);
  });

  it("serves a candidate's habitat detail that the pushes leave out", async () => {
    const detail = { stats: [{ id: "s" }], atmosphereClimateStats: [], compositionGroups: [] };
    const bodies = [
      {
        state: { key: "7:1", bodyName: "B 1" },
        matches: [
          {
            entry: { id: "tubus_1" },
            exomasteryDetail: detail,
            exomasteryVarietyHints: [{ h: 1 }],
            otherMatchDetailCards: [{ id: "c" }],
          },
        ],
      },
    ];
    const t = await start({ bodies });
    const first = await t.next(1);
    const pushed = ((first.payload as { bodies: { matches: Record<string, unknown>[] }[] }).bodies[0]!.matches[0])!;
    expect(pushed.exomasteryDetail).toBeUndefined();
    expect(pushed.lazyDetail).toMatchObject({ body: "7:1", habitat: true, otherCards: 1 });
    const ask = (q: string) => fetch(`http://127.0.0.1:${t.port}/api/match-detail?${q}`);
    const ok = await ask("body=7%3A1&species=tubus_1");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      exomasteryDetail: detail,
      exomasteryVarietyHints: [{ h: 1 }],
      otherMatchDetailCards: [{ id: "c" }],
    });
    expect((await ask("body=7%3A1&species=other")).status).toBe(404);
    expect((await ask("body=7%3A1")).status).toBe(400);
  });
});

describe("socket robustness (combined plan 1.3)", () => {
  it("survives a malformed frame instead of exiting the process", async () => {
    const t = await start({ n: 0 });
    await t.next(1);
    const net = await import("node:net");
    // A raw client: a valid upgrade, then bytes that are not a WebSocket frame (bad Wi-Fi, a scanner).
    await new Promise<void>((resolve) => {
      const sock = net.connect(t.port, "127.0.0.1", () => {
        sock.write(
          "GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
        );
        setTimeout(() => sock.write(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x00, 0x01])), 50);
        setTimeout(() => {
          sock.destroy();
          resolve();
        }, 200);
      });
      sock.on("error", () => resolve());
    });
    // Still serving, and the other socket still gets pushes.
    t.set({ n: 1 });
    const p = await t.next(2);
    expect((p.payload as Record<string, unknown>).n).toBe(1);
    const rev = await fetch(`http://127.0.0.1:${t.port}/api/state/rev`);
    expect(rev.ok).toBe(true);
  });

  it("gives a socket that connected between pushes a whole frame, so a field that changed back is not stale", async () => {
    const t = await start({ journalSystems: big("A"), n: 0 });
    await t.next(1);
    t.set({ journalSystems: big("A"), n: 1 }); // the push baseline: list A
    await t.next(2);
    // Between pushes the list becomes B and a second socket connects, receiving B.
    let snapB = { journalSystems: big("B"), n: 1 };
    t.setQuiet(snapB);
    await new Promise((r) => setTimeout(r, 1100));
    const late = new WebSocket(`ws://127.0.0.1:${t.port}/ws`);
    const lateMsgs: Record<string, unknown>[] = [];
    late.on("message", (d) => lateMsgs.push(JSON.parse(String(d))));
    closersPush(() => late.close());
    // The server's snapshot is B while the late socket connects (after the 1 s snapshot reuse).
    t.setQuiet(snapB);
    await new Promise((r) => late.once("open", r));
    for (let i = 0; i < 100 && lateMsgs.length < 1; i++) await new Promise((r) => setTimeout(r, 10));
    expect(((lateMsgs[0]!.payload as Record<string, unknown>).journalSystems as { starSystem: string }[])[0]!.starSystem).toBe("B 0");
    // Back to A before the next push: a delta would say "journalSystems unchanged" (same as the last push).
    snapB = { journalSystems: big("A"), n: 2 };
    t.set(snapB);
    for (let i = 0; i < 100 && lateMsgs.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    const p = lateMsgs[1]!;
    expect(p.unchanged).toBeUndefined();
    expect(((p.payload as Record<string, unknown>).journalSystems as { starSystem: string }[])[0]!.starSystem).toBe("A 0");
  });
});

function closersPush(fn: () => void) {
  closers.unshift(async () => fn());
}
