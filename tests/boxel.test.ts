/**
 * Boxels (src/shared/boxel.ts, src/server/boxel.ts; guild tester report, 2026-09-30).
 */
import { describe, expect, it } from "vitest";
import { boxelIndexOf, parseBoxel } from "../src/shared/boxel.js";
import { boxelSystems } from "../src/server/boxel.js";

describe("boxel names", () => {
  it("a system name gives its boxel and number", () => {
    expect(parseBoxel("Eol Prou AB-C d1-23")).toEqual({
      sector: "Eol Prou",
      boxel: "AB-C d1",
      massCode: "d",
      prefix: "Eol Prou AB-C d1-",
      index: 23,
    });
    // Boxel 0 leaves its number out.
    expect(parseBoxel("Bleethuia QV-L b16")).toMatchObject({ boxel: "QV-L b", prefix: "Bleethuia QV-L b", index: 16 });
    // The boxel itself, with a trailing dash.
    expect(parseBoxel("Eol Prou AB-C d1-")).toMatchObject({ prefix: "Eol Prou AB-C d1-", index: 0 });
    expect(parseBoxel("HIP 87621")).toBeNull();
    expect(parseBoxel("Sol")).toBeNull();
  });

  it("a name is in the boxel only with just a number after the prefix", () => {
    expect(boxelIndexOf("Eol Prou AB-C d1-7", "Eol Prou AB-C d1-")).toBe(7);
    expect(boxelIndexOf("Eol Prou AB-C d12-7", "Eol Prou AB-C d1-")).toBeNull();
    expect(boxelIndexOf("Bleethuia QV-L b16", "Bleethuia QV-L b")).toBe(16);
    expect(boxelIndexOf("Bleethuia QV-L b1-6", "Bleethuia QV-L b")).toBeNull();
  });
});

describe("the listing", () => {
  it("lists -0 to the end, marks what you flew, and names the next one", () => {
    const d = boxelSystems({
      query: "Eol Prou AB-C d1-2",
      end: null,
      index: null,
      visited: ["Eol Prou AB-C d1-0", "Eol Prou AB-C d1-2", "Eol Prou AB-C d1-5", "Eol Prou AB-C d12-9", "Sol"],
      speciesName: (id) => id,
    })!;
    expect(d.rows.map((r) => [r.n, r.visited])).toEqual([
      [0, true],
      [1, false],
      [2, true],
      [3, false],
      [4, false],
      [5, true],
    ]);
    expect(d.nextUnvisited).toBe("Eol Prou AB-C d1-1");
    expect(d).toMatchObject({ visitedCount: 3, knownCount: 0, cubeLy: 80, noIndex: true });
    // A known end number stretches the list.
    expect(boxelSystems({ query: "Eol Prou AB-C d1-2", end: 9, index: null, visited: [], speciesName: (i) => i })!.rows).toHaveLength(10);
  });
});
