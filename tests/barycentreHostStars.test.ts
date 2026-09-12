/**
 * Which stars light a body that orbits a barycentre.
 *
 * The parents chain names no star for these, so the body's own designation is the only thing that
 * separates `AB 1` from `ABC 1`. Taking every star in the system instead is a wild over-reach — a
 * system can carry ten — and picking one of them is worse still: that is how an M-dwarf observation
 * reached Electricae pluma from a neutron-star system.
 */
import { describe, expect, it } from "vitest";
import { hostStarBodyIdsForExobiology, starLettersFromDesignation } from "../src/server/orbitUtils.js";
import { candidateMorphColorShortLabelForHosts } from "../src/shared/candidateSpawnHints.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { getProjectRoot } from "../src/server/paths.js";
import type { ExplorationScanRecord } from "../src/shared/types.js";

const SYSTEM = "Smoje AM-L d8-2";
const rec = (bodyId: number, bodyName: string, over: Partial<ExplorationScanRecord> = {}) =>
  ({
    systemAddress: 1,
    bodyId,
    bodyName: `${SYSTEM} ${bodyName}`,
    starSystem: SYSTEM,
    updatedAt: "2026-09-12T00:00:00Z",
    ...over,
  }) as ExplorationScanRecord;

// A, B, C are the system's three stars; the planets hang off barycentres and name no star.
const STARS = [
  rec(2, "A", { starType: "F" }),
  rec(3, "B", { starType: "M" }),
  rec(4, "C", { starType: "K" }),
];
const index = (extra: ExplorationScanRecord[]) => {
  const m = new Map<number, ExplorationScanRecord>();
  for (const r of [...STARS, ...extra]) m.set(r.bodyId, r);
  return m;
};

describe("the stars a designation names", () => {
  it.each([
    ["ABC 2 a", ["A", "B", "C"]],
    ["AB 1", ["A", "B"]],
    ["BC 5", ["B", "C"]],
    ["BCD 3", ["B", "C", "D"]],
    ["ABCDEF 1", ["A", "B", "C", "D", "E", "F"]],
    ["C 1", ["C"]],
    ["4", []],
  ])("%s", (name, want) => {
    expect(starLettersFromDesignation(rec(99, name))).toEqual(want);
  });

  it("does not read letters out of the system's own name", () => {
    // "AM-L" sits in the system name and must never be mistaken for a star designation.
    expect(starLettersFromDesignation(rec(99, "2 a"))).toEqual([]);
  });
});

describe("host stars for a body with no star in its chain", () => {
  const body = (name: string) => rec(20, name, { parents: [{ Null: 0 }] });

  it("takes only the stars the designation names", () => {
    const ids = hostStarBodyIdsForExobiology(body("AB 1"), index([body("AB 1")]));
    expect(ids.sort()).toEqual([2, 3]);
  });

  it("takes all three for a triple barycentre", () => {
    const ids = hostStarBodyIdsForExobiology(body("ABC 2"), index([body("ABC 2")]));
    expect(ids.sort()).toEqual([2, 3, 4]);
  });

  it("falls back to every star when the name says nothing", () => {
    const ids = hostStarBodyIdsForExobiology(body("4"), index([body("4")]));
    expect(ids.sort()).toEqual([2, 3, 4]);
  });
});

describe("the colour when the host is a set of stars", () => {
  const db = loadSpeciesDatabaseFromTree(getProjectRoot());
  const aurasus = db.species.find((s) => s.id === "bacterium_bacterium_aurasus")!;

  it("names one colour when every possible host agrees", () => {
    const one = candidateMorphColorShortLabelForHosts(aurasus, ["F"]);
    expect(candidateMorphColorShortLabelForHosts(aurasus, ["F", "F"])).toBe(one);
  });

  it("names both when the hosts disagree, rather than giving up", () => {
    const label = candidateMorphColorShortLabelForHosts(aurasus, ["F", "M"]);
    const f = candidateMorphColorShortLabelForHosts(aurasus, ["F"]);
    const m = candidateMorphColorShortLabelForHosts(aurasus, ["M"]);
    if (f !== m && f !== "(unknown)" && m !== "(unknown)") {
      expect(label).toContain(" or ");
      expect(label).toContain(f);
      expect(label).toContain(m);
    }
  });

  it("stays unknown when any possible host is unknown", () => {
    // The body may well be orbiting that one, so the answer is not known.
    expect(candidateMorphColorShortLabelForHosts(aurasus, ["F", "ZZZ"])).toBe("(unknown)");
  });

  it("says unknown when there are no hosts at all", () => {
    expect(candidateMorphColorShortLabelForHosts(aurasus, [])).toBe("(unknown)");
  });
});
