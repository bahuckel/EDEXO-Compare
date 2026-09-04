import { describe, expect, it } from "vitest";
import {
  bodyScanValueCredits,
  planetClassK,
  referenceFssAt1EarthMass,
  starClassK,
  starScanValueCredits,
} from "../src/server/explorationValue.js";

/**
 * A port of MattG's exploration formulae. The golden numbers below are the ones the app has been
 * showing and that match in-game payouts (an ELW at 1 EM: ~283 k honked-and-scanned, ~2.7 M when
 * you are first discoverer *and* first mapper).
 */
describe("starClassK", () => {
  it("separates neutron/black hole, white dwarf and everything else", () => {
    expect(starClassK("N")).toBe(22628);
    expect(starClassK("H")).toBe(22628);
    expect(starClassK("DA")).toBe(14057);
    expect(starClassK("G")).toBe(1200);
    expect(starClassK(undefined)).toBe(1200);
    expect(starClassK("")).toBe(1200);
  });

  it("is case-insensitive on the leading letter", () => {
    expect(starClassK("n")).toBe(starClassK("N"));
    expect(starClassK("da")).toBe(starClassK("DA"));
  });
});

describe("planetClassK", () => {
  it("gives an Earthlike its terraform bonus but no min-range discount", () => {
    expect(planetClassK("Earthlike body", false)).toEqual({ k: 64831, kt: 116295, tm: 1 });
  });

  it("collapses the min-range multiplier for an already-terraformed Earthlike", () => {
    expect(planetClassK("Earthlike body", true).tm).toBe(0);
  });

  it("only pays the terraform bonus on a terraformable HMC", () => {
    expect(planetClassK("High metal content body", false)).toEqual({ k: 9654, kt: 0, tm: 1 });
    expect(planetClassK("High metal content body", true)).toEqual({ k: 9654, kt: 100677, tm: 0.9 });
  });

  it("treats unknown classes as the 300-credit floor class", () => {
    expect(planetClassK("Icy body", false).k).toBe(300);
    expect(planetClassK(undefined, false).k).toBe(300);
    expect(planetClassK("Icy body", true).kt).toBe(93328);
  });
});

describe("starScanValueCredits", () => {
  it("scales with stellar mass and pays the honk a third", () => {
    const g = starScanValueCredits(1, "G", false);
    expect(g).toEqual({ value: 1218, honkThird: 406 });
    expect(starScanValueCredits(2, "G", false).value).toBeGreaterThan(g.value);
  });

  it("multiplies a first discovery by 2.6", () => {
    const plain = starScanValueCredits(1, "D", false);
    const first = starScanValueCredits(1, "D", true);
    expect(first.value).toBe(37100);
    // Rounding happens once, at the end, so this is 2.6× to within a credit — not of the
    // already-rounded plain value.
    expect(first.value / plain.value).toBeCloseTo(2.6, 4);
  });
});

describe("bodyScanValueCredits", () => {
  it("matches the known Earthlike payouts at 1 Earth mass", () => {
    expect(bodyScanValueCredits("Earthlike body", false, 1, false, false)).toEqual({
      fss: 283629,
      dssMapped: 945428,
      honkThird: 94543,
      fssMinRange: 283629,
      dssMinRange: 945428,
    });
    expect(bodyScanValueCredits("Earthlike body", false, 1, true, true).dssMapped).toBe(2728228);
  });

  it("pays first discoverer + first mapper more than first mapper alone", () => {
    const both = bodyScanValueCredits("Earthlike body", false, 1, true, true).dssMapped;
    const mapperOnly = bodyScanValueCredits("Earthlike body", false, 1, false, true).dssMapped;
    const neither = bodyScanValueCredits("Earthlike body", false, 1, false, false).dssMapped;
    expect(both).toBeGreaterThan(mapperOnly);
    expect(mapperOnly).toBeGreaterThan(neither);
  });

  it("floors every payout at 500 credits", () => {
    const worthless = bodyScanValueCredits("Icy body", false, 0.01, false, false);
    expect(worthless.fss).toBe(500);
    expect(worthless.honkThird).toBe(500);
  });

  it("reports a lower min-range than headline value only where the class discounts it", () => {
    const tfHmc = bodyScanValueCredits("High metal content body", true, 1, false, false);
    expect(tfHmc.fssMinRange).toBeLessThan(tfHmc.fss);

    const plainHmc = bodyScanValueCredits("High metal content body", false, 1, false, false);
    expect(plainHmc.fssMinRange).toBe(plainHmc.fss);
  });

  it("adds the Odyssey bonus to mapped values only", () => {
    const withBonus = bodyScanValueCredits("Water world", false, 1, false, true, true);
    const without = bodyScanValueCredits("Water world", false, 1, false, true, false);
    expect(withBonus.dssMapped).toBeGreaterThan(without.dssMapped);
    expect(withBonus.fss).toBe(without.fss);
  });

  it("pays a probe-efficient DSS more than an inefficient one", () => {
    const efficient = bodyScanValueCredits("Water world", false, 1, false, true, false, true);
    const wasteful = bodyScanValueCredits("Water world", false, 1, false, true, false, false);
    expect(efficient.dssMapped).toBeGreaterThan(wasteful.dssMapped);
    expect(efficient.fss).toBe(wasteful.fss);
  });

  it("grows with mass", () => {
    const light = bodyScanValueCredits("Water world", false, 0.5, false, false).fss;
    const heavy = bodyScanValueCredits("Water world", false, 5, false, false).fss;
    expect(heavy).toBeGreaterThan(light);
  });
});

describe("referenceFssAt1EarthMass", () => {
  it("is the plain FSS value at 1 EM, used for the map's above-typical marker", () => {
    expect(referenceFssAt1EarthMass("Earthlike body", false)).toBe(
      bodyScanValueCredits("Earthlike body", false, 1, false, false, false, false).fss,
    );
  });
});
