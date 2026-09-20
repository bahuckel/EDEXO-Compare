/**
 * `Parents` is ordered, and the order is the answer.
 *
 * A journal's `Parents` runs nearest-first, so in `[{Null:56},{Star:50},{Null:49},{Star:0}]` the body
 * hangs off barycentre 56, which orbits **star 50**, which in turn orbits barycentre 49 with star 0.
 * Star 50 is the host; star 0 is the host's own ancestor and may be nothing like it.
 *
 * Both resolvers used to ignore that order. `resolveHostStarBodyId` fell back to the *smallest* star
 * id, which is the system primary rather than the host, and `hostStarBodyIdsForExobiology` kept every
 * star the chain named rather than the nearest one.
 *
 * This was found by checking our answer against Spansh's independent `hostStarBodyId` over the whole
 * corpus — 17,487 bodies whose parent chains match exactly. Agreement was 99.51 %, and **every one of
 * the 86 disagreements was this bug**: 70 of shape `Null>Star>Star`, 11 of `Null>Star>Null>Star`.
 * After the fix the two derivations agree on all 17,487, and the multi-star host sets fall from 3,252
 * bodies to 1,987 — the 1,265 removed being ordered chains, not ambiguous ones.
 *
 * What is deliberately *not* changed: a chain naming no star at all. That is the shape that put an
 * M-dwarf host on Electricae pluma in a neutron-star system, it is genuinely ambiguous, and it still
 * resolves through the body's designation (`barycentreHostStars.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { hostStarBodyIdsForExobiology, resolveHostStarBodyId } from "../src/server/orbitUtils.js";
import type { ExplorationScanRecord } from "../src/shared/types.js";

const SYSTEM = "HIP 104435";

function rec(
  bodyId: number,
  bodyName: string,
  over: Partial<ExplorationScanRecord> = {},
): ExplorationScanRecord {
  return {
    systemAddress: 1,
    bodyId,
    bodyName: `${SYSTEM} ${bodyName}`,
    starSystem: SYSTEM,
    updatedAt: "2026-09-20T00:00:00Z",
    ...over,
  } as ExplorationScanRecord;
}

/**
 * The real body from the disagreement list, reduced.
 *
 * `HIP 104435 7 e` with `[{Null:56},{Star:50},{Null:49},{Star:0}]`: we answered star 0, Spansh
 * answered star 50, and Spansh was right.
 */
const moon = rec(77, "7 e", { parents: [{ Null: 56 }, { Star: 50 }, { Null: 49 }, { Star: 0 }] });
const byId = new Map<number, ExplorationScanRecord>([
  [0, rec(0, "A", { starType: "M" })],
  [50, rec(50, "B", { starType: "K" })],
  [77, moon],
]);

describe("a chain that names more than one star", () => {
  it("takes the nearest star, not the lowest body id", () => {
    expect(resolveHostStarBodyId(moon, byId)).toBe(50);
  });

  it("returns only the host in the set, not its ancestors", () => {
    // Star 0 sits above star 50 in the chain. Offering both claims the body might be lit by either.
    expect(hostStarBodyIdsForExobiology(moon, byId)).toEqual([50]);
  });

  it("holds when the ancestor has the higher id, so the old rule would have been right by luck", () => {
    /*
      The sabotage check. If the fallback went back to `Math.min`, the case above would fail and this
      one would still pass — so a test that only used the real body could be satisfied by the wrong
      rule half the time. Here the nearest star is the *lower* id and the ancestor the higher one.
    */
    const other = rec(88, "9 b", { parents: [{ Null: 60 }, { Star: 3 }, { Null: 59 }, { Star: 40 }] });
    const map = new Map<number, ExplorationScanRecord>([
      [3, rec(3, "C", { starType: "F" })],
      [40, rec(40, "D", { starType: "A" })],
      [88, other],
    ]);
    expect(resolveHostStarBodyId(other, map)).toBe(3);
    expect(hostStarBodyIdsForExobiology(other, map)).toEqual([3]);
  });
});

describe("what the ordering fix must not disturb", () => {
  it("still walks straight to a star named first", () => {
    const direct = rec(12, "2", { parents: [{ Star: 7 }] });
    const map = new Map<number, ExplorationScanRecord>([
      [7, rec(7, "A", { starType: "G" })],
      [12, direct],
    ]);
    expect(resolveHostStarBodyId(direct, map)).toBe(7);
    expect(hostStarBodyIdsForExobiology(direct, map)).toEqual([7]);
  });

  it("still hops through a planet to reach its star", () => {
    const planet = rec(20, "3", { parents: [{ Star: 9 }] });
    const satellite = rec(21, "3 a", { parents: [{ Planet: 20 }, { Star: 9 }] });
    const map = new Map<number, ExplorationScanRecord>([
      [9, rec(9, "A", { starType: "M" })],
      [20, planet],
      [21, satellite],
    ]);
    expect(resolveHostStarBodyId(satellite, map)).toBe(9);
  });

  it("still says nothing when the chain names no star", () => {
    // The pluma shape. Left to the designation logic, which `barycentreHostStars.test.ts` covers.
    const orphan = rec(30, "4 a", { parents: [{ Null: 5 }, { Null: 1 }] });
    const map = new Map<number, ExplorationScanRecord>([[30, orphan]]);
    expect(resolveHostStarBodyId(orphan, map)).toBeNull();
  });
});
