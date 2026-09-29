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
});
