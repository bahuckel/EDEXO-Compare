/**
 * The cloud ladder (src/shared/gggLadder.ts), checked against CMDR Arcanic's "The Mystery Property:
 * Revealed" (2026) and his own code and tables on https://ed-ggg.github.io/edggg/densitydemo.html
 * (aligned 2026-10-07): his always-green temperatures float value by float value, his worked examples
 * and the catalogued GGGs with their Spansh values.
 */
import { describe, expect, it } from "vitest";
import {
  alwaysGreenTemps,
  gasGiantDensity,
  ladderDepth,
  ladderGreen,
  nudgeOf,
} from "../src/shared/gggLadder.js";

const round6 = (xs: number[]) => xs.map((x) => Number(x.toFixed(6)));
const C1 = "Sudarsky class I gas giant";
const C3 = "Sudarsky class III gas giant";
const C4 = "Sudarsky class IV gas giant";
const AMMONIA = "Gas giant with ammonia based life";
const WATER = "Gas giant with water based life";
const green = (planetClass: string, T: number, mass: number | null, rkm: number | null) =>
  ladderGreen({ planetClass, tempK: T, massEM: mass, radiusM: rkm == null ? null : rkm * 1000 });

describe("the cloud ladder", () => {
  it("gives his density and the minimum densities of his tables", () => {
    // Class I in the Naina sector: 18.154175 Earth masses, radius 17,025.02 km → 5,245.2 kg/m³.
    expect(gasGiantDensity(18.154175, 17_025_020)).toBeCloseTo(5245, 0);
    // 130 K needs the ladder at 340 K (depth 210 K): 2,078 kg/m³. 158 K needs 182 K: 315 kg/m³.
    expect(ladderDepth(130, 2079)).toBeGreaterThan(210);
    expect(ladderDepth(130, 2077)).toBeLessThan(210);
    expect(ladderDepth(158, 316)).toBeGreaterThan(182);
    expect(ladderDepth(158, 314)).toBeLessThan(182);
  });

  it("reproduces his always-green temperatures: water-based life", () => {
    // His table: 176.666641 to 176.666702 — and 176.666626 "misses 270 by the smallest step".
    expect(round6(alwaysGreenTemps("water", 150, 250))).toEqual([
      158, 176.666641, 176.666656, 176.666672, 176.666687, 176.666702, 188.333328, 210, 217.499985, 217.5,
      217.500015, 241.999985, 242, 242.000015,
    ]);
    // "Water-based life (also water giants, helium and helium-rich)": the same table.
    expect(alwaysGreenTemps("heliumRich", 150, 250)).toEqual(alwaysGreenTemps("water", 150, 250));
  });

  it("reproduces his always-green temperatures: class I (those reachable at a gas giant's density)", () => {
    const greens = round6(alwaysGreenTemps("I", 110, 330));
    expect(greens).toEqual(expect.arrayContaining([115, 129.999985, 130, 130.000015]));
  });

  it("reproduces his always-green temperatures: class III, on the 30 K steps up to 700 K and 780 K", () => {
    expect(round6(alwaysGreenTemps("III", 330, 800))).toEqual([370, 520, 550, 580, 610, 640, 670, 700, 780]);
  });

  it("class IV: 1149.999878 and 1150 K, and with his 50 K smallest step every 50 K up to 1400 K", () => {
    // His table lists 1149.999878–1150; his code's step limit also makes 1200 … 1350 K green.
    expect(round6(alwaysGreenTemps("IV", 1100, 1450))).toEqual([
      1149.999878, 1150, 1200, 1250, 1300, 1350, 1400,
    ]);
    expect(green(C4, 1150.000122, 2913.518066, 68644.12)).toBeNull();
  });

  it("calls the Naina class I green on rung 5 at 250 K, and the same temperature with too little density not", () => {
    expect(green(C1, 130.000015, 18.154175, 17_025.02)).toEqual({
      rung: 5,
      door: 250,
      basis: "ceiling",
      offUlp: 0,
      nudge: "none",
    });
    // 1,000 kg/m³: the ladder stops short of 340 K and no rung lands on a door.
    const r = Math.cbrt((18.154175 * 5.97219e24) / (1000 * (4 / 3) * Math.PI));
    expect(ladderGreen({ planetClass: C1, tempK: 130.000015, massEM: 18.154175, radiusM: r })).toBeNull();
  });

  it("his worked example: M17 Sector CF-Y c1-23 2, sixth rung exactly on 270 K by density", () => {
    expect(green(C1, 133.998352, 220.366837, 66_635.716)).toEqual({
      rung: 6,
      door: 270,
      basis: "density",
      offUlp: 0,
      nudge: "none",
    });
  });

  it("a crack at the surface is green whatever the density; class II below 250 K always nudged", () => {
    expect(green(WATER, 210, null, null)).toEqual({
      rung: 1,
      door: 210,
      basis: "ceiling",
      offUlp: 0,
      nudge: "none",
    });
    expect(green("Sudarsky class II gas giant", 217.87532, 300, 70_000)).toBeNull();
    // A class III step held at its 30 K smallest is the temperature's alone, scanned mass or not.
    expect(green(C3, 610, null, null)).toMatchObject({ rung: 4, door: 700, basis: "ceiling" });
    // Without a mass, a hit that needs the ceiling is only likely.
    expect(green(WATER, 217.500015, null, null)?.basis).toBe("density");
  });

  // Catalogued density-decided greens, Spansh values (T K, MassEM, radius km): every rung exact.
  it.each([
    ["Eafoff LN-Q d6-0 1", 128.90947, 114.621498, 60187.696, 6, 250],
    ["Pro Flee UY-Q c18-0 2", 129.582138, 130.617767, 64116.9, 6, 250],
    ["Pheia Aewsy LV-Y d11 B 4", 126.062111, 212.034698, 67972.136, 6, 250],
    ["Syrivu AN-M c7-2 3", 125.933167, 159.549011, 65058.884, 7, 270],
  ])("puts a rung of %s exactly on a crack", (_name, T, mass, rkm, rung, door) => {
    expect(green(C1, T, mass, rkm)).toEqual({ rung, door, basis: "density", offUlp: 0, nudge: "none" });
  });

  // His five that "can escape the nudge": in the maybe range, on or next to a crack (Spansh values).
  it.each([
    ["Vegnao PA-S c6-43 3", C1, 113.841248, 306.238953, 72590.296, 7, 250, 0],
    ["Floawns FX-L b36-24 1", AMMONIA, 121.179939, 450.12088, 75688.808, 6, 250, 0],
    ["Synookio EI-J d9-1 7", C1, 119.986717, 21.216078, 20795.606, 6, 270, 1],
    ["Dryooe Groa QX-F c16 A 7", C1, 120.72538, 83.17791, 57642.944, 7, 250, 1],
  ])("puts %s on a crack if the nudge left it alone", (_name, pc, T, mass, rkm, rung, door, off) => {
    expect(green(pc, T, mass, rkm)).toEqual({ rung, door, basis: "density", offUlp: off, nudge: "maybe" });
  });

  it("his nudge ranges: nothing to say below, maybe between, none above", () => {
    expect(nudgeOf("I", 90.14109)).toBe("always");
    expect(nudgeOf("ammonia", 102.23452)).toBe("maybe");
    expect(nudgeOf("water", 100)).toBe("always");
    expect(nudgeOf("I", 122.29538)).toBe("none");
    expect(nudgeOf("I", 77.450478)).toBe("none");
    expect(nudgeOf("II", 250)).toBe("always");
    expect(nudgeOf("II", 279)).toBe("maybe");
    expect(nudgeOf("III", 365)).toBe("always");
    expect(nudgeOf("III", 400)).toBe("maybe");
    expect(nudgeOf("III", 415)).toBe("none");
    expect(nudgeOf("IV", 650)).toBe("maybe");
    expect(nudgeOf("V", 1400)).toBe("maybe");
    // Class III at 370 K (Blaa Hype TF-V d3-144 3, catalogue #41): on the crack unless nudged.
    expect(green(C3, 370, null, null)).toMatchObject({ rung: 1, door: 370, nudge: "maybe" });
    expect(green(C1, 90.14109, 300, 70_000)).toBeNull();
  });
});
