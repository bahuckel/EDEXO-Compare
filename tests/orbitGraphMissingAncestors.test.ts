/**
 * A parent chain that names a body we hold no record of (2026-09-28). Two real shapes emptied the
 * whole system map by closing a loop through the primary star, so no body was left to be a root:
 *
 *  - HIP 87621 6 b: {Planet 39}, {Null 38}, {Null 32}, {Star 0} — planet 39 never scanned;
 *  - HIP 37068 7 d: {Null 50}, {Star 45}, {Null 44}, {Star 0} — companion star 45 never scanned.
 *
 * The missing link is stepped over and the body hangs on the next ancestor we have.
 */
import { describe, expect, it } from "vitest";
import {
  allIdsInOrbitGraph,
  buildOrbitChildMapFromJournalChains,
  rootBodyIdsFromOrbitGraph,
} from "../src/server/systemMapOrbitGraph.js";
import { barycentreSyntheticBodyId } from "../src/server/orbitUtils.js";
import type { ExplorationScanRecord } from "../src/shared/types.js";

const SYS = "Test System";
const rec = (bodyId: number, over: Partial<ExplorationScanRecord> = {}): ExplorationScanRecord =>
  ({
    systemAddress: 1,
    bodyId,
    bodyName: `${SYS} ${bodyId}`,
    starSystem: SYS,
    ...over,
  }) as ExplorationScanRecord;
const star = rec(0, { bodyName: SYS, starType: "F", bodyType: "Star", distanceFromArrivalLs: 0 });

function graph(recs: ExplorationScanRecord[]) {
  const byId = new Map(recs.map((r) => [r.bodyId, r]));
  const oc = buildOrbitChildMapFromJournalChains(recs, byId, SYS);
  return { oc, roots: rootBodyIdsFromOrbitGraph(allIdsInOrbitGraph(recs, oc), oc) };
}

describe("parent chains with a missing ancestor", () => {
  it("steps over an unscanned planet instead of looping the star into a barycentre", () => {
    const { oc, roots } = graph([
      star,
      rec(43, { parents: [{ Planet: 39 }, { Null: 38 }, { Null: 32 }, { Star: 0 }] }),
      rec(46, { parents: [{ Null: 38 }, { Null: 32 }, { Star: 0 }] }),
    ]);
    expect(roots).toEqual([0]);
    expect(oc.get(43)).toBe(barycentreSyntheticBodyId(38));
    expect(oc.has(0)).toBe(false);
  });

  it("steps over an unscanned companion star in the middle of a chain", () => {
    const { oc, roots } = graph([
      star,
      rec(51, { parents: [{ Null: 50 }, { Star: 45 }, { Null: 44 }, { Star: 0 }] }),
    ]);
    expect(roots).toEqual([0]);
    expect(oc.get(barycentreSyntheticBodyId(50))).toBe(barycentreSyntheticBodyId(44));
    expect(oc.get(barycentreSyntheticBodyId(44))).toBe(0);
  });

  it("never lets the primary become its own parent", () => {
    const { oc, roots } = graph([star, rec(62, { parents: [{ Planet: 61 }, { Star: 0 }] })]);
    expect(oc.get(62)).toBe(0);
    expect(oc.has(0)).toBe(false);
    expect(roots).toContain(0);
  });
});
