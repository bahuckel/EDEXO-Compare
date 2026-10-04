/**
 * Next target (galaxyNext.ts, G5): nearest first, above the value floor, never a system the commander
 * has done (DSS or plants on foot), skipped ones excluded, nothing without a known ship position.
 */
import { describe, expect, it } from "vitest";
import { doneAddresses, nextTarget, ordinalsOf } from "../src/server/galaxyNext.js";
import { GameStateStore } from "../src/server/gameState.js";
import type { BioIndex } from "../src/server/bioIndex.js";
import type { JournalLine } from "../src/shared/types.js";

// id64s sorted, as the index file is.
const SYSTEMS = [
  { id: 100n, name: "Near Cheap", x: 10, y: 0, z: 0, species: 1 },
  { id: 200n, name: "Near Rich", x: 20, y: 0, z: 0, species: 5 },
  { id: 300n, name: "Far Rich", x: 5000, y: 0, z: 0, species: 7 },
  { id: 400n, name: "Mid Rich", x: 300, y: 40, z: 0, species: 3 },
  { id: 500n, name: "Nothing Recorded", x: 1, y: 0, z: 0, species: 0 },
];
const VALUES = new Uint16Array([5, 400, 900, 250, 0]); // 100 k CR units
const index: BioIndex = {
  systemCount: SYSTEMS.length,
  species: [],
  lookup: () => null,
  ordinalOf: (id) => SYSTEMS.findIndex((s) => s.id === id),
  systemsWithAny: () => [],
  forEachRegionSpecies: () => {},
  forEachPoint: (cb) => SYSTEMS.forEach((s, i) => cb(i, s.x, s.y, s.z, 0, s.species)),
  pointAt: (i) => [SYSTEMS[i]!.x, SYSTEMS[i]!.y, SYSTEMS[i]!.z, 0, SYSTEMS[i]!.species],
  nameOf: (i) => SYSTEMS[i]!.name,
  systemAt: (i) => ({ id64: SYSTEMS[i]!.id, name: SYSTEMS[i]!.name, x: 0, y: 0, z: 0, regionId: 0, species: [], tiers: 0, bodyCount: 0 }),
};
const SHIP = { x: 0, y: 0, z: 0 };

function synthetic(pts: { x: number; y: number; z: number }[]): BioIndex {
  return {
    ...index,
    systemCount: pts.length,
    forEachPoint: (cb) => pts.forEach((p, i) => cb(i, p.x, p.y, p.z, 0, 1)),
    pointAt: (i) => [pts[i]!.x, pts[i]!.y, pts[i]!.z, 0, 1],
    nameOf: (i) => `S${i}`,
  };
}

/** The greedy chain the slow way: every hop looks at every system. */
function bruteChain(
  pts: { x: number; y: number; z: number; v: number }[],
  from: { x: number; y: number; z: number },
  floor: number,
  exclude: Set<number>,
  stops: number,
): number[] {
  const out: number[] = [];
  let at = from;
  for (let n = 0; n < stops; n++) {
    let pick = -1;
    let best = Infinity;
    pts.forEach((p, i) => {
      if (p.v < floor || exclude.has(i) || out.includes(i)) return;
      const d = (p.x - at.x) ** 2 + (p.y - at.y) ** 2 + (p.z - at.z) ** 2;
      if (d < best) {
        best = d;
        pick = i;
      }
    });
    if (pick < 0) break;
    out.push(pick);
    at = pts[pick]!;
  }
  return out;
}

describe("Next target", () => {
  it("takes the nearest system that clears the floor, and lists the next ones in order", () => {
    const r = nextTarget(index, VALUES, SHIP, 200, new Set());
    expect(r.target).toMatchObject({ name: "Near Rich", valueCr: 40_000_000, species: 5, distanceLy: 20 });
    expect(r.next.map((n) => n.name)).toEqual(["Mid Rich", "Far Rich"]);
    expect(r.qualifying).toBe(3);
  });

  it("with no floor, still never offers a system with nothing recorded", () => {
    expect(nextTarget(index, VALUES, SHIP, 0, new Set()).target?.name).toBe("Near Cheap");
  });

  it("skips what is excluded (done or skipped) and says so when nothing is left", () => {
    expect(nextTarget(index, VALUES, SHIP, 200, new Set([1])).target?.name).toBe("Mid Rich");
    const none = nextTarget(index, VALUES, SHIP, 200, new Set([1, 2, 3]));
    expect(none.target).toBeNull();
    expect(none.qualifying).toBe(0);
  });

  it("picks nothing without a ship position", () => {
    expect(nextTarget(index, VALUES, null, 0, new Set())).toMatchObject({ from: null, target: null });
  });

  it("plans a greedy chain from the ship with each leg, and the totals", () => {
    const plan = nextTarget(index, VALUES, SHIP, 200, new Set(), 6, 5).plan!;
    expect(plan.stops.map((s) => s.name)).toEqual(["Near Rich", "Mid Rich", "Far Rich"]);
    expect(plan.stops[0]).toMatchObject({ legLy: 20, distanceLy: 20 });
    expect(plan.stops[1]!.legLy).toBeCloseTo(Math.hypot(280, 40), 6);
    expect(plan.stops[2]!.legLy).toBeCloseTo(Math.hypot(4700, 40), 6);
    expect(plan.totalLy).toBeCloseTo(20 + Math.hypot(280, 40) + Math.hypot(4700, 40), 6);
    expect(plan.totalValueCr).toBe((400 + 250 + 900) * 100_000);
    expect(nextTarget(index, VALUES, SHIP, 200, new Set()).plan).toBeUndefined();
  });

  it("the plan's stops are exactly the greedy chain's even when a hop leaves the nearest few hundred kept", () => {
    // 450 systems on a shell 10–11 ly around the ship (more than the pool keeps), 60 far off, one
    // excluded: the second hop reaches past the pool's radius and must take a full pass.
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pts: { x: number; y: number; z: number; v: number }[] = [];
    for (let i = 0; i < 510; i++) {
      const far = i >= 450;
      const r = far ? 900 + rnd() * 200 : 10 + rnd();
      const a = rnd() * Math.PI * 2;
      const b = Math.acos(2 * rnd() - 1);
      pts.push({ x: r * Math.sin(b) * Math.cos(a), y: r * Math.cos(b), z: r * Math.sin(b) * Math.sin(a), v: 1 + Math.floor(rnd() * 600) });
    }
    const big = synthetic(pts);
    const values = new Uint16Array(pts.map((p) => p.v));
    for (const floor of [0, 150, 450]) {
      const r = nextTarget(big, values, SHIP, floor, new Set([3]), 6, 8);
      const chain = bruteChain(pts, SHIP, Math.max(1, floor), new Set([3]), 8);
      // The stops are the greedy chain's; 2-opt only changes the order, never for a longer route (5.8).
      expect(r.plan!.stops.map((s) => s.ordinal).sort((x, y) => x - y)).toEqual([...chain].sort((x, y) => x - y));
      expect(r.plan!.totalLy).toBeLessThanOrEqual(r.plan!.greedyLy + 1e-9);
      const legs = r.plan!.stops.reduce((t, s) => t + s.legLy, 0);
      expect(legs).toBeCloseTo(r.plan!.totalLy, 6);
      if (floor === 0) expect(r.plan!.fullPasses).toBeGreaterThan(0);
    }
  });

  it("orders the stops by 2-opt, and with loop comes back to the ship", () => {
    // On a line from the ship: the greedy chain goes 10 → 25 → 40 (the nearest each time) and is
    // already best open; looped, the return leg is added and counted.
    const line = synthetic([
      { x: 10, y: 0, z: 0 },
      { x: 25, y: 0, z: 0 },
      { x: 40, y: 0, z: 0 },
    ]);
    const v = new Uint16Array([300, 300, 300]);
    const ship = { x: 0, y: 0, z: 0 };
    const open = nextTarget(line, v, ship, 200, new Set(), 6, 3).plan!;
    expect(open.stops.map((s) => s.x)).toEqual([10, 25, 40]);
    expect(open).toMatchObject({ loop: false, totalLy: 40, greedyLy: 40 });
    expect(open.returnLy).toBeUndefined();
    const looped = nextTarget(line, v, ship, 200, new Set(), 6, 3, true).plan!;
    expect(looped).toMatchObject({ loop: true, totalLy: 80, returnLy: 40 });

    // A chain that doubles back: from the ship at 0 the nearest is 3, then 9 (6 away) beats -3.5 (6.5),
    // then all the way back: 3 + 6 + 12.5 = 21.5 ly. 2-opt goes -3.5 → 3 → 9: 3.5 + 6.5 + 6 = 16 ly.
    const zig = synthetic([
      { x: 3, y: 0, z: 0 },
      { x: -3.5, y: 0, z: 0 },
      { x: 9, y: 0, z: 0 },
    ]);
    const plan = nextTarget(zig, v, ship, 200, new Set(), 6, 3).plan!;
    expect(plan.greedyLy).toBeCloseTo(21.5, 9);
    expect(plan.totalLy).toBeCloseTo(16, 9);
    expect(plan.stops.map((s) => s.x)).toEqual([-3.5, 3, 9]);
    expect(plan.stops.map((s) => s.legLy)).toEqual([3.5, 6.5, 6]);
  });

  it("counts a DSS or a foot scan as done, and a mere visit only as visited", () => {
    const st = new GameStateStore();
    const jump = (name: string, addr: number) =>
      st.apply({ timestamp: "2026-05-05T05:09:05Z", event: "FSDJump", StarSystem: name, SystemAddress: addr, StarPos: [0, 0, 0] } as unknown as JournalLine);
    jump("Near Rich", 200);
    st.apply({ timestamp: "2026-05-05T05:10:00Z", event: "SAAScanComplete", BodyName: "Near Rich 1", BodyID: 1, SystemAddress: 200 } as unknown as JournalLine);
    jump("Mid Rich", 400);
    const done = doneAddresses(st);
    expect([...done.analysed]).toEqual([200]);
    expect([...done.visited].sort()).toEqual([200, 400]);
    expect([...ordinalsOf(index, done.analysed)]).toEqual([1]);
    // Analysed skipped by default: the rich neighbour is out, the visited-only one is still offered.
    expect(nextTarget(index, VALUES, SHIP, 200, ordinalsOf(index, done.analysed)).target?.name).toBe("Mid Rich");
    expect(nextTarget(index, VALUES, SHIP, 200, ordinalsOf(index, done.visited)).target?.name).toBe("Far Rich");
  });
});
