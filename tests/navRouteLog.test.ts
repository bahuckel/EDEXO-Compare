/**
 * The NavRoute star finder's log (owner, 2026-10-04): every plotted route kept with its star classes,
 * one list of systems, and EDSM asked politely about the ones the commander chooses.
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkNavRouteSystemsOnEdsm,
  lastNavRoute,
  navRouteLog,
  recordNavRoute,
  resetNavRouteLogForTests,
} from "../src/server/navRouteLog.js";
import type { NavRouteWaypointDTO } from "../src/server/navRouteFuel.js";

let dir: string;
let before: string | undefined;
beforeEach(() => {
  before = process.env.EDEXO_USER_DATA_DIR;
  dir = mkdtempSync(path.join(os.tmpdir(), "edexo-navlog-"));
  process.env.EDEXO_USER_DATA_DIR = dir;
  resetNavRouteLogForTests();
});
afterEach(() => {
  if (before === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = before;
  resetNavRouteLogForTests();
  rmSync(dir, { recursive: true, force: true });
});

const wp = (a: number, name: string, starClass: string): NavRouteWaypointDTO => ({
  systemAddress: a,
  starSystem: name,
  starPos: [a, 0, 0],
  starClass,
});

describe("the NavRoute log", () => {
  it("keeps a new route once, and merges systems seen on several", () => {
    const r1 = [wp(1, "Sol", "G"), wp(2, "Neut A", "N"), wp(3, "Wolf B", "W")];
    expect(recordNavRoute(r1, "2026-10-04T10:00:00Z")).toBe(true);
    expect(recordNavRoute(r1, "2026-10-04T10:01:00Z")).toBe(false);
    expect(recordNavRoute([wp(3, "Wolf B", "W"), wp(4, "Hole C", "H")], "2026-10-04T11:00:00Z")).toBe(true);
    const log = navRouteLog();
    expect(log.routes.map((r) => [r.from, r.to, r.count])).toEqual([
      ["Sol", "Wolf B", 3],
      ["Wolf B", "Hole C", 2],
    ]);
    const wolf = log.systems.find((s) => s.address === 3)!;
    expect(wolf).toMatchObject({ starClass: "W", routes: 2, firstSeen: "2026-10-04T10:00:00Z", lastSeen: "2026-10-04T11:00:00Z" });
    expect(lastNavRoute().map((s) => s.name)).toEqual(["Wolf B", "Hole C"]);
  });

  it("asks EDSM forty names at a time, and remembers which it knows", async () => {
    const route = Array.from({ length: 45 }, (_, i) => wp(100 + i, `Sys ${i}`, i % 2 ? "N" : "M"));
    recordNavRoute(route);
    const asked: string[][] = [];
    const fetchImpl = (async (url: string) => {
      const names = new URL(url).searchParams.getAll("systemName[]");
      asked.push(names);
      // EDSM knows the even ones.
      const known = names.filter((n) => Number(n.split(" ")[1]) % 2 === 0).map((name) => ({ name }));
      return new Response(JSON.stringify(known), { status: 200 });
    }) as unknown as typeof fetch;
    await checkNavRouteSystemsOnEdsm(route.map((w) => w.systemAddress), fetchImpl, 0);
    expect(asked.map((a) => a.length)).toEqual([40, 5]);
    const by = (n: string) => navRouteLog().systems.find((s) => s.name === n)!;
    expect(by("Sys 2").edsm).toBe(true);
    expect(by("Sys 3").edsm).toBe(false);
    expect(navRouteLog().checking).toBeNull();
    // Asked again: nothing left to ask.
    asked.length = 0;
    await checkNavRouteSystemsOnEdsm(route.map((w) => w.systemAddress), fetchImpl, 0);
    expect(asked).toEqual([]);
  });
});
