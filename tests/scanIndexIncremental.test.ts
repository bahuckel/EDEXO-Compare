/**
 * The per-system scan and moon-parent indexes are patched on each write instead of rebuilt (plan F,
 * 2026-10-01: a cold start replayed the journals in a quadratic loop, 24 s of a frozen app). A patched
 * index must read exactly like one rebuilt from the maps: same records, same order, after scans,
 * rescans, moons, barycentres, a sale, a rescan after the sale, and a death.
 */
import { describe, expect, it } from "vitest";
import type { JournalLine } from "../src/shared/types.js";
import { GameStateStore } from "../src/server/gameState.js";

const T = "2026-10-01T02:00:00Z";
const SYS = [
  { addr: 1001, name: "Index Test AA-A a1" },
  { addr: 1002, name: "Index Test AA-A a2" },
  { addr: 1003, name: "Index Test AA-A a3" },
];

const jump = (s: (typeof SYS)[number]): JournalLine =>
  ({ timestamp: T, event: "FSDJump", StarSystem: s.name, SystemAddress: s.addr, StarPos: [s.addr, 0, 0] }) as unknown as JournalLine;

function scan(s: (typeof SYS)[number], bodyId: number, parents: unknown[], extra: Record<string, unknown> = {}): JournalLine {
  return {
    timestamp: T,
    event: "Scan",
    ScanType: "Detailed",
    BodyName: `${s.name} ${bodyId}`,
    BodyID: bodyId,
    Parents: parents,
    StarSystem: s.name,
    SystemAddress: s.addr,
    PlanetClass: "Icy body",
    Landable: true,
    SurfaceTemperature: 50 + bodyId,
    SurfaceGravity: 0.1,
    Radius: 700000,
    ...extra,
  } as unknown as JournalLine;
}

const bary = (s: (typeof SYS)[number], bodyId: number): JournalLine =>
  ({ timestamp: T, event: "ScanBaryCentre", StarSystem: s.name, SystemAddress: s.addr, BodyID: bodyId, SemiMajorAxis: 1e9 }) as unknown as JournalLine;

const sell = (s: (typeof SYS)[number]): JournalLine =>
  ({ timestamp: T, event: "MultiSellExplorationData", Discovered: [{ SystemName: s.name, NumBodies: 5 }], BaseValue: 1, Bonus: 0, TotalEarnings: 1 }) as unknown as JournalLine;

function script(): JournalLine[] {
  const [a, b, c] = SYS;
  return [
    jump(a!),
    scan(a!, 0, []),
    scan(a!, 3, [{ Star: 0 }]),
    scan(a!, 4, [{ Planet: 3 }, { Star: 0 }]),
    scan(a!, 5, [{ Planet: 3 }, { Star: 0 }]),
    bary(a!, 7),
    scan(a!, 4, [{ Planet: 3 }, { Star: 0 }], { SurfaceTemperature: 99 }), // rescan in place
    jump(b!),
    scan(b!, 1, []),
    scan(b!, 2, [{ Planet: 1 }, { Star: 0 }]),
    scan(b!, 6, [{ Planet: 1 }, { Star: 0 }]),
    sell(a!), // a's rows move to the sold archive
    jump(a!),
    scan(a!, 5, [{ Planet: 3 }, { Star: 0 }], { SurfaceTemperature: 70 }), // back to live after the sale
    jump(c!),
    scan(c!, 0, []),
    scan(c!, 2, [{ Planet: 1 }, { Star: 0 }]),
    { timestamp: T, event: "Died" } as unknown as JournalLine,
    scan(c!, 3, [{ Planet: 1 }, { Star: 0 }]),
  ];
}

/** What a rebuild over the maps gives: records grouped by system in insertion order. */
function grouped(m: Map<string, { systemAddress: number }>, addr: number) {
  return [...m.values()].filter((r) => r.systemAddress === addr);
}

function orbitParents(store: GameStateStore, addr: number): [number, number][] {
  return [...store.orbitParentPlanetByBody]
    .filter(([k]) => k.startsWith(`${addr}:`))
    .map(([k, p]) => [Number(k.split(":")[1]), p] as [number, number])
    .sort((x, y) => x[0] - y[0]);
}

function expectIndexMatchesMaps(store: GameStateStore): void {
  for (const s of SYS) {
    expect(store.liveScansInSystem(s.addr)).toEqual(grouped(store.explorationScans, s.addr));
    expect(store.soldScansInSystem(s.addr)).toEqual(grouped(store.soldExplorationScans, s.addr));
    expect([...store.orbitParentsInSystem(s.addr)].sort((x, y) => x[0] - y[0])).toEqual(orbitParents(store, s.addr));
  }
}

describe("incremental scan index", () => {
  it("reads like a rebuild after every line when kept fresh (the patch path)", () => {
    const store = new GameStateStore();
    const liveA: number[][] = [];
    for (const line of script()) {
      store.liveScansInSystem(SYS[0]!.addr); // keep both indexes fresh so the next write patches
      store.orbitParentsInSystem(SYS[0]!.addr);
      store.apply(line);
      expectIndexMatchesMaps(store);
      liveA.push(store.liveScansInSystem(SYS[0]!.addr).map((r) => r.bodyId));
    }
    // The script did reach the interesting states: rescan in place, the sale, back to live, the death.
    // Four bodies and the barycentre (stored under a synthetic id), the rescan kept in place.
    expect(liveA[6]!.slice(0, 4)).toEqual([0, 3, 4, 5]);
    expect(liveA[6]).toHaveLength(5);
    expect(liveA[11]).toEqual([]);
    expect(liveA[13]).toEqual([5]);
    expect(liveA.at(-1)).toEqual([]);
    // Body 5 left the archive when rescanned and came back at the death: last, as in the map.
    expect(store.soldScansInSystem(SYS[0]!.addr).map((r) => r.bodyId)).toEqual([0, 3, 4, liveA[6]![4], 5]);
  });

  it("gives the same answers with no reads in between (the rebuild path)", () => {
    const patched = new GameStateStore();
    const rebuilt = new GameStateStore();
    for (const line of script()) {
      patched.liveScansInSystem(SYS[0]!.addr);
      patched.apply(line);
      rebuilt.apply(line);
    }
    for (const s of SYS) {
      expect(patched.liveScansInSystem(s.addr)).toEqual(rebuilt.liveScansInSystem(s.addr));
      expect(patched.soldScansInSystem(s.addr)).toEqual(rebuilt.soldScansInSystem(s.addr));
      expect([...patched.orbitParentsInSystem(s.addr)]).toEqual([...rebuilt.orbitParentsInSystem(s.addr)]);
    }
  });

  it("hands out a new list for a changed system and keeps the old one intact", () => {
    const store = new GameStateStore();
    const [a] = SYS;
    store.apply(jump(a!));
    store.apply(scan(a!, 0, []));
    const before = store.liveScansInSystem(a!.addr);
    store.apply(scan(a!, 3, [{ Star: 0 }]));
    expect(before.map((r) => r.bodyId)).toEqual([0]);
    expect(store.liveScansInSystem(a!.addr).map((r) => r.bodyId)).toEqual([0, 3]);
  });
});
