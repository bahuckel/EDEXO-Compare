/**
 * Which boxels to fly for what (src/shared/boxelAdvice.ts): mass codes ranked by what the Spansh dump
 * holds, and every boxel of a sector named and placed from its position.
 */
import { describe, expect, it } from "vitest";
import {
  boxelNameAt,
  boxelPositionOf,
  boxelsPerAxis,
  formatBoxelRate,
  massCodeRate,
  nearestBoxels,
  goldenBoxels,
  goldenInSector,
  goldenTargetsAt,
  rankMassCodes,
} from "../src/shared/boxelAdvice.js";
import { firstSystemOf } from "../src/client/BoxelAdvice.js";

describe("boxel names from positions", () => {
  it("reads the letters and number as the position in base 26", () => {
    expect(boxelNameAt("h", 0)).toBe("AA-A h");
    expect(boxelNameAt("g", 1)).toBe("BA-A g");
    expect(boxelNameAt("d", 17576)).toBe("AA-A d1");
    expect(boxelNameAt("d", boxelPositionOf("LV-Y d11")!)).toBe("LV-Y d11");
    expect(boxelsPerAxis("h")).toBe(1);
    expect(boxelsPerAxis("a")).toBe(128);
  });

  // Spansh's coordinates of real systems: the boxel nearest a system's own position is its boxel.
  it.each([
    ["Blaa Eork EH-S d5-4", "d", { x: 2047.5625, y: -49.03125, z: 1999.625 }, "EH-S d5"],
    ["Cyoilz JM-N b26-0", "b", { x: -4435.375, y: -148.8125, z: -6885.1875 }, "JM-N b26"],
    ["Hyphaups XX-U d2-0", "d", { x: 36829.875, y: 107.5, z: 8210.71875 }, "XX-U d2"],
    ["Hypo Fruia II-A c1-58", "c", { x: -23086.1875, y: 437.9375, z: 24584.59375 }, "II-A c1"],
    // `e3532` is boxel QO-Z e (number 0), system 3532.
    ["Juenae QO-Z e3532", "e", { x: 55.59375, y: -58.5625, z: 25978.0 }, "QO-Z e"],
  ] as const)("places %s in its own boxel", (_name, code, pos, boxel) => {
    expect(nearestBoxels(code, pos, 1)[0]!.boxel).toBe(boxel);
  });

  it("lists AA-A boxels: the sector's corner boxel (in d-h the only one), a few more in a-c", () => {
    const p = { x: 2047.5625, y: -49.03125, z: 1999.625 };
    for (const code of ["h", "g", "f", "e", "d"] as const) {
      const only = nearestBoxels(code, p, 50, "AA-A");
      expect(only.map((b) => b.boxel)).toEqual([`AA-A ${code}`]);
      expect(only[0]!.position).toBe(0);
    }
    const c = nearestBoxels("c", p, 50, "AA-A").map((b) => b.boxel);
    expect(c[0]).toMatch(/^AA-A c\d*$/);
    expect(c.every((b) => /^AA-A c\d*$/.test(b))).toBe(true);
  });
});

describe("mass codes for a target", () => {
  it("ranks them by the dump's rates", () => {
    expect(rankMassCodes("star:H")[0]!.code).toBe("f");
    expect(rankMassCodes("elw")[0]!.code).toBe("d");
    expect(rankMassCodes("bio")[0]!.code).toBe("c");
    expect(rankMassCodes("heRich")[0]!.code).toBe("e");
    expect(massCodeRate("d", "elw")!.rate).toBeCloseTo(1 / 83, 3);
    // A body count has no AA-A split.
    expect(massCodeRate("d", "heRich", "AA-A")).toBeNull();
  });

  it("formats a share, a rare rate and a count per 1,000", () => {
    expect(formatBoxelRate(0.073)).toBe("7.3 %");
    expect(formatBoxelRate(1 / 83)).toBe("1.2 %");
    expect(formatBoxelRate(1 / 1245)).toBe("1 in 1,245");
    expect(formatBoxelRate(13.4, true)).toBe("13 per 1,000");
  });
});

describe("exobiology by boxel (EDAstro's codex file)", () => {
  it("ranks mass codes for a genus and a species", () => {
    expect(rankMassCodes("g:Anemone")[0]!.code).toBe("e");
    expect(
      rankMassCodes("g:Stratum")
        .map((r) => r.code)
        .slice(0, 2)
        .sort(),
    ).toEqual(["c", "d"]);
    expect(rankMassCodes("sp:Stratum Tectonicas").length).toBeGreaterThan(3);
  });

  it("names the golden positions in the commander's sector: Bark Mounds near the sector's origin corner", () => {
    const g = goldenBoxels("sp:Bark Mounds");
    expect(g.length).toBeGreaterThan(5);
    expect(g.every((x) => x.code === "d" && x.rate > 4 * x.rest)).toBe(true);
    expect(g.map((x) => x.boxel)).toContain("DL-Y d");
    // Placed in Assairts from a ship inside it: the boxel's centre is in the same sector.
    const s = goldenInSector(g[0]!, { x: 1000, y: 0, z: 30000 });
    expect(s.ly).toBeLessThan(2300);
  });

  it("saves a boxel by its system 0", () => {
    expect(firstSystemOf("Assairts", "DL-Y d")).toBe("Assairts DL-Y d0");
    expect(firstSystemOf("Assairts", "HR-W d1")).toBe("Assairts HR-W d1-0");
  });
});

describe("golden places a second source confirms", () => {
  it("marks DL-Y d (any sector) for Bark Mounds, confirmed by the Spansh bio export, and an ordinary boxel for nothing", () => {
    const at = goldenTargetsAt("DL-Y d");
    expect(at.find((g) => g.target === "Bark Mounds")).toMatchObject({ confirmed: true });
    expect(goldenTargetsAt("MR-D c12")).toEqual([]);
    expect(goldenBoxels("sp:Bark Mounds")[0]!.confirmed).toBe(true);
  });
});

describe("golden places for stars, worlds and signals (owner, 2026-10-06)", () => {
  it("lists neutron stars in BW-N e6 and white dwarfs in NE-X d2, with the rate over every boxel", () => {
    const n = goldenBoxels("star:N");
    expect(n.map((g) => g.boxel)).toContain("BW-N e6");
    expect(n.every((g) => g.kind === "galaxy" && g.code === "e" && g.rate >= 1.75 * g.rest)).toBe(true);
    const d = goldenBoxels("star:D").find((g) => g.boxel === "NE-X d2")!;
    expect(d.rate / d.rest).toBeGreaterThan(2.5);
  });

  it("says what a boxel is golden for, by label", () => {
    const at = goldenTargetsAt("AA-A g").map((g) => g.target);
    expect(at).toEqual(expect.arrayContaining(["Geology (geological signals)", "Exobiology (biological signals)"]));
    expect(goldenTargetsAt("BW-N e6").map((g) => g.target)).toContain("Neutron star");
  });
});
