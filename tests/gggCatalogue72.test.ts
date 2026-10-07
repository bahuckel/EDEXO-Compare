/**
 * All 72 GGGs of the edGGG catalogue (CMDR Arcanic, 2026-10-07), with the scans Spansh holds for them
 * (tests/fixtures/ggg-catalogue-scans.json: [number, body, journal PlanetClass, surface temperature K,
 * MassEM, radius km], from Spansh's system dumps on 2026-10-07):
 * - every one is marked by its name, with its catalogue number;
 * - under no name, the cloud ladder alone (aligned to his code) finds every one it can judge.
 */
import { describe, expect, it } from "vitest";
import scans from "./fixtures/ggg-catalogue-scans.json" with { type: "json" };
import { GGG_CATALOGUE } from "../src/shared/gggCatalogue.js";
import { ladderClassOf, ladderGreen, nudgeOf } from "../src/shared/gggLadder.js";
import { classifyGreenGiant, greenGiantLabel } from "../src/shared/greenGasGiant.js";

type Scan = [number, string, string, number, number, number];
const ROWS = scans as Scan[];
const input = ([, , planetClass, t, massEM, rkm]: Scan) => ({
  planetClass,
  surfaceTemperatureK: t,
  massEM,
  radiusM: rkm * 1000,
});
const ladder = (s: Scan) => {
  const i = input(s);
  return ladderGreen({
    planetClass: i.planetClass,
    tempK: i.surfaceTemperatureK,
    massEM: i.massEM,
    radiusM: i.radiusM,
  });
};

/** His "maybe" nudge ranges: these four were moved by the nudge, so their own temperature misses. */
const NUDGED_MAYBE = [10, 16, 50, 58];
/** Always nudged (class II below 250 K, class III below 365 K, any giant at 80–100 K): only a visit tells. */
const NUDGED_ALWAYS = [
  11, 18, 20, 22, 23, 24, 25, 27, 28, 33, 34, 44, 46, 51, 52, 53, 54, 55, 63, 65, 66, 69, 70,
];
/** In a maybe range and on a crack ("can escape the nudge"), or one float step off it. */
const MAYBE_EXACT = [38, 40, 41];
const MAYBE_ONE_OFF = [19, 29, 43];

describe("the 72 GGGs of the edGGG catalogue", () => {
  it("are all here, each with Spansh's scan", () => {
    expect(GGG_CATALOGUE).toHaveLength(72);
    expect(ROWS.map((r) => r[0])).toEqual(GGG_CATALOGUE.map((r) => r[0]));
    for (const [n, body, cls] of ROWS) {
      const cat = GGG_CATALOGUE.find((r) => r[0] === n)!;
      expect([body, cls]).toEqual([cat[1], cat[2]]);
    }
  });

  it.each(ROWS)("#%i %s is marked green by its name", (n, body, ...rest) => {
    const v = classifyGreenGiant({ ...input([n, body, ...rest] as Scan), bodyName: body });
    expect(v).toMatchObject({ level: "catalogued", gggNumber: n });
    expect(greenGiantLabel(v!)).toBe(`Green gas giant #${n}`);
  });

  it("are found by the cloud ladder alone wherever it can judge: all 39 out of the nudge ranges exactly", () => {
    const judged = ROWS.filter((s) => nudgeOf(ladderClassOf(s[2])!, s[3]) === "none");
    expect(judged).toHaveLength(39);
    for (const s of judged) expect(ladder(s), `#${s[0]} ${s[1]}`).toMatchObject({ offUlp: 0, nudge: "none" });
    // … and the verdict calls each likely, under no name.
    for (const s of judged) expect(classifyGreenGiant(input(s))?.level, `#${s[0]}`).toBe("likely");
  });

  it("in his maybe ranges: three exactly on a crack, three a float step off, four moved by the nudge", () => {
    const byN = new Map(ROWS.map((s) => [s[0], s]));
    for (const n of MAYBE_EXACT)
      expect(ladder(byN.get(n)!), `#${n}`).toMatchObject({ offUlp: 0, nudge: "maybe" });
    for (const n of MAYBE_ONE_OFF)
      expect(ladder(byN.get(n)!), `#${n}`).toMatchObject({ offUlp: 1, nudge: "maybe" });
    for (const n of NUDGED_MAYBE) {
      expect(nudgeOf(ladderClassOf(byN.get(n)![2])!, byN.get(n)![3]), `#${n}`).toBe("maybe");
      expect(ladder(byN.get(n)!), `#${n}`).toBeNull();
    }
    for (const n of NUDGED_ALWAYS)
      expect(nudgeOf(ladderClassOf(byN.get(n)![2])!, byN.get(n)![3]), `#${n}`).toBe("always");
    expect(MAYBE_EXACT.length + MAYBE_ONE_OFF.length + NUDGED_MAYBE.length + NUDGED_ALWAYS.length + 39).toBe(
      72,
    );
  });
});
