/**
 * The switch under "BODY" (Discord batch O-F): system order, most profitable, alphabetical, closest —
 * and the distances "Closest" reads from `shipProximity`.
 */
import { describe, expect, it } from "vitest";
import { sortBodies } from "../src/client/bodySort.js";
import { buildShipProximity, meanSeparation, orbitDistanceLs } from "../src/server/shipProximity.js";
import type { BodyComputed, ExplorationScanRecord, ShipProximityDTO } from "../src/shared/types.js";

const ADDR = 42;
const SYS = "Test Sys";
const LS = 299_792_458;

function body(
  bodyId: number,
  tabLabel: string,
  opts: { signals?: number; price?: number; analysedGenera?: string[]; arrivalLs?: number } = {},
): BodyComputed {
  const matches = [
    { entry: { genus: "Bacterium" }, priceCredits: opts.price ?? 0, unlikely: false },
    ...(opts.analysedGenera ?? []).map((g) => ({
      entry: { genus: g },
      priceCredits: 0,
      unlikely: false,
      organicAnalysisComplete: true,
    })),
  ];
  return {
    state: {
      key: `${ADDR}:${bodyId}`,
      bodyId,
      starSystem: SYS,
      biologicalSignals: opts.signals ?? 1,
    },
    tabLabel,
    matches,
    exoPayoutRange: null,
    mergedScan: opts.arrivalLs === undefined ? null : { distanceFromArrivalLs: opts.arrivalLs },
  } as unknown as BodyComputed;
}

function rec(
  bodyId: number,
  name: string,
  parents: unknown[],
  smaLs: number | null,
  arrivalLs: number,
  periodS = 1000 + bodyId,
): ExplorationScanRecord {
  return {
    systemAddress: ADDR,
    bodyId,
    bodyName: `${SYS} ${name}`,
    starSystem: SYS,
    updatedAt: "2026-09-26T00:00:00Z",
    parents,
    distanceFromArrivalLs: arrivalLs,
    ...(smaLs === null ? {} : { semiMajorAxis: smaLs * LS, orbitalPeriod: periodS }),
  } as ExplorationScanRecord;
}

const labels = (bs: BodyComputed[]) => bs.map((b) => b.tabLabel);

describe("body sort", () => {
  it("alphabetical is natural: 1 a before 1 b before 2 before 10", () => {
    const bs = [body(1, "10"), body(2, "1 b"), body(3, "2"), body(4, "1 a")];
    expect(labels(sortBodies(bs, "alpha", null))).toEqual(["1 a", "1 b", "2", "10"]);
  });

  it("system order leaves the strip as it was", () => {
    const bs = [body(1, "10"), body(2, "1 b")];
    expect(sortBodies(bs, "system", null)).toBe(bs);
  });

  it("most profitable is pure value order: an analysed body keeps its place", () => {
    // His call (2026-09-26): the analysed dot marks it; sending it to the end hid the next best.
    const done = body(3, "3", { signals: 1, price: 50_000_000, analysedGenera: ["Stratum"] });
    const bs = [body(1, "1", { price: 1_000_000 }), done, body(2, "2", { price: 9_000_000 })];
    expect(labels(sortBodies(bs, "profit", null))).toEqual(["3", "2", "1"]);
  });

  it("closest follows the distances, unknown ones last", () => {
    const prox: ShipProximityDTO = {
      originBodyKey: `${ADDR}:1`,
      originLabel: "A",
      basis: "arrival",
      distanceLsByBodyKey: { [`${ADDR}:2`]: 900, [`${ADDR}:3`]: 12 },
    };
    const bs = [body(2, "2"), body(4, "4"), body(3, "3")];
    expect(labels(sortBodies(bs, "closest", prox))).toEqual(["3", "2", "4"]);
  });
});

describe("ship proximity", () => {
  // Star A (arrival) with planet 2 at 100 Ls and its moons 3 (1 Ls) and 4 (2 Ls); planet 5 at 300 Ls.
  const recs = [
    rec(1, "A", [{ Null: 0 }], null, 0),
    rec(2, "A 2", [{ Star: 1 }, { Null: 0 }], 100, 100),
    rec(3, "A 2 a", [{ Planet: 2 }, { Star: 1 }, { Null: 0 }], 1, 100.5),
    rec(4, "A 2 b", [{ Planet: 2 }, { Star: 1 }, { Null: 0 }], 2, 101),
    rec(5, "A 5", [{ Star: 1 }, { Null: 0 }], 300, 310),
  ];
  const bodies = [
    body(3, "2 a", { arrivalLs: 100.5 }),
    body(4, "2 b", { arrivalLs: 101 }),
    body(5, "5", { arrivalLs: 310 }),
  ];

  it("after a jump it is the game's own distance from the arrival star", () => {
    const p = buildShipProximity(`${ADDR}:1`, ADDR, recs, bodies)!;
    expect(p.basis).toBe("arrival");
    expect(p.originLabel).toBe("A");
    expect(p.distanceLsByBodyKey).toEqual({ [`${ADDR}:3`]: 100.5, [`${ADDR}:4`]: 101, [`${ADDR}:5`]: 310 });
  });

  it("a ship somewhere the journal cannot place (a station) counts as at the arrival star", () => {
    expect(buildShipProximity(`${ADDR}:77`, ADDR, recs, bodies)!.basis).toBe("arrival");
    expect(buildShipProximity(`999:3`, ADDR, recs, bodies)!.basis).toBe("arrival");
  });

  it("landed on a moon, its sibling comes before the next planet", () => {
    const p = buildShipProximity(`${ADDR}:3`, ADDR, recs, bodies)!;
    expect(p.basis).toBe("orbits");
    expect(p.originLabel).toBe("A 2 a");
    const d = p.distanceLsByBodyKey;
    expect(d[`${ADDR}:3`]).toBe(0);
    expect(d[`${ADDR}:4`]).toBeCloseTo(meanSeparation(1, 2), 6);
    expect(d[`${ADDR}:5`]).toBeCloseTo(meanSeparation(100, 300), 6);
    expect(labels(sortBodies(bodies, "closest", p))).toEqual(["2 a", "2 b", "5"]);
  });

  it("two stars of one pair are a + b apart, not an average", () => {
    const pair = [rec(1, "A", [{ Null: 0 }], 10, 0, 5000), rec(2, "B", [{ Null: 0 }], 30, 40, 5000)];
    const parent = new Map([
      [1, 2_010_000_000],
      [2, 2_010_000_000],
    ]);
    expect(orbitDistanceLs(1, 2, new Map(pair.map((r) => [r.bodyId, r])), parent)).toBeCloseTo(40, 6);
  });

  it("an orbit with no radius on the way falls back to the difference of arrival distances", () => {
    const noSma = recs.map((r) => (r.bodyId === 5 ? { ...r, semiMajorAxis: undefined } : r));
    const p = buildShipProximity(`${ADDR}:3`, ADDR, noSma, bodies)!;
    expect(p.distanceLsByBodyKey[`${ADDR}:5`]).toBeCloseTo(310 - 100.5, 6);
  });

  it("the mean separation is exact at the edges", () => {
    expect(meanSeparation(0, 7)).toBe(7);
    expect(meanSeparation(5, 0)).toBe(5);
    // Same circle: 4r/π on average.
    expect(meanSeparation(1, 1)).toBeCloseTo(4 / Math.PI, 3);
  });
});
