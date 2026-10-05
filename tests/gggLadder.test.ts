/**
 * The cloud ladder (src/shared/gggLadder.ts), checked against CMDR Arcanic's "The Mystery Property:
 * Revealed" (2026): his tables of every always-green temperature, float value by float value, and his
 * worked examples.
 */
import { describe, expect, it } from "vitest";
import { alwaysGreenTemps, gasGiantDensity, ladderDepth, ladderGreen } from "../src/shared/gggLadder.js";

const f = Math.fround;
const round6 = (xs: number[]) => xs.map((x) => Number(x.toFixed(6)));

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
    expect(round6(alwaysGreenTemps("water", 150, 250))).toEqual([
      158, 176.666626, 176.666641, 176.666656, 176.666672, 176.666687, 176.666702, 188.333328, 210,
      217.499985, 217.5, 217.500015, 241.999985, 242, 242.000015,
    ]);
    // One value more than his list (176.666626, one float step below it): the catalogue's five GGGs at
    // 176.667 K sit on his five, so whether 176.666626 is green is open until one is found there.
  });

  it("reproduces his always-green temperatures: class I (those reachable at a gas giant's density)", () => {
    const greens = round6(alwaysGreenTemps("I", 110, 330));
    expect(greens).toEqual(expect.arrayContaining([115, 129.999985, 130, 130.000015]));
  });

  it("reproduces his always-green temperatures: class III, on the 30 K steps up to 700 K and 780 K", () => {
    const greens = round6(alwaysGreenTemps("III", 330, 800));
    expect(greens).toEqual([370, 520, 550, 580, 610, 640, 670, 700, 780]);
  });

  it("calls the Naina class I green on rung 5 at 250 K, and the same temperature with too little density not", () => {
    const naina = ladderGreen({
      planetClass: "Sudarsky class I gas giant",
      tempK: 130.000015,
      massEM: 18.154175,
      radiusM: 17_025_020,
    });
    expect(naina).toEqual({ rung: 5, door: 250, basis: "ceiling" });
    // 1,000 kg/m³: the ladder stops short of 340 K and no rung lands on a door.
    const r = Math.cbrt((18.154175 * 5.97219e24) / (1000 * (4 / 3) * Math.PI));
    expect(
      ladderGreen({
        planetClass: "Sudarsky class I gas giant",
        tempK: 130.000015,
        massEM: 18.154175,
        radiusM: r,
      }),
    ).toBeNull();
  });

  it("says a door at the surface is green whatever the density, and gives no answer for class II", () => {
    expect(
      ladderGreen({
        planetClass: "Gas giant with water based life",
        tempK: 210,
        massEM: null,
        radiusM: null,
      }),
    ).toEqual({
      rung: 1,
      door: 210,
      basis: "ceiling",
    });
    expect(
      ladderGreen({
        planetClass: "Sudarsky class II gas giant",
        tempK: 217.87532,
        massEM: 300,
        radiusM: 7e7,
      }),
    ).toBeNull();
    // Without a mass and radius a ceiling hit is only likely.
    expect(
      ladderGreen({ planetClass: "Sudarsky class III gas giant", tempK: f(610), massEM: null, radiusM: null })
        ?.basis,
    ).toBe("density");
  });

  // Catalogued density-decided greens, Spansh values (T K, MassEM, radius km): with the powers
  // and the step division in 64-bit a rung lands exactly on 250 K; all-32-bit misses Pheia Aewsy by a float step.
  it.each([
    ["Eafoff LN-Q d6-0 1", 128.90947, 114.621498, 60187.696],
    ["Pro Flee UY-Q c18-0 2", 129.582138, 130.617767, 64116.9],
    ["Pheia Aewsy LV-Y d11 B 4", 126.062111, 212.034698, 67972.136],
  ])("puts a rung of %s exactly on a door", (_name, T, mass, rkm) => {
    const t = f(T);
    const top = f(t + ladderDepth(t, gasGiantDensity(mass, rkm * 1000)));
    expect(top).toBeLessThan(340);
    const step = f((top - t) / 7);
    const rungs = Array.from({ length: 7 }, (_, i) => f(t + f(step * f(i))));
    expect(rungs).toContain(250);
    expect(
      ladderGreen({ planetClass: "Sudarsky class I gas giant", tempK: T, massEM: mass, radiusM: rkm * 1000 }),
    ).toEqual(expect.objectContaining({ door: 250, basis: "density" }));
  });
});
