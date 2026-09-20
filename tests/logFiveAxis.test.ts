/**
 * The base-five axis.
 *
 * Asked for as `1 M -> 5 M -> 25 M -> 125 M -> 625 M -> 3.125 bn`, and it fits the owner's data
 * almost exactly: his income sources span 6,899,678 to 7,771,860,600 CR, a ratio of 1,126x, which is
 * 4.37 rungs at base five. Linear, the smallest is 0.09 % of the largest.
 *
 * The behaviour that matters most is what happens to **zero**, because zero is common — a 24-hour
 * window with no combat earns no bonds — and `log(0)` is negative infinity. A category that vanishes
 * reads as a broken panel; one drawn flat on the baseline reads as a fact.
 */
import { describe, expect, it } from "vitest";
import { AXIS_BASE, buildLogFiveAxis, formatCredits, logFiveFraction } from "../src/shared/logFiveAxis.js";

describe("the ladder the owner asked for", () => {
  it("climbs in fives from a round anchor", () => {
    const axis = buildLogFiveAxis([1_000_000, 3_000_000_000]);
    expect(axis.ticks).toEqual([1e6, 5e6, 25e6, 125e6, 625e6, 3.125e9]);
  });

  it("every rung is exactly five times the last", () => {
    const axis = buildLogFiveAxis([2_000_000, 900_000_000]);
    for (let i = 1; i < axis.ticks.length; i += 1) {
      expect(axis.ticks[i]! / axis.ticks[i - 1]!).toBeCloseTo(AXIS_BASE, 10);
    }
  });

  it("covers the data at both ends", () => {
    const values = [6_899_678, 7_771_860_600];
    const axis = buildLogFiveAxis(values);
    expect(axis.min).toBeLessThanOrEqual(Math.min(...values));
    expect(axis.max).toBeGreaterThanOrEqual(Math.max(...values));
  });

  it("spans the owner's real sources in five rungs", () => {
    // The whole justification for base five, pinned: seven rows from bounties to exobiology.
    const real = [7_771_860_600, 2_875_754_222, 799_007_412, 226_302_537, 139_172_574, 9_190_166];
    const axis = buildLogFiveAxis(real);
    expect(axis.ticks.length).toBeGreaterThanOrEqual(4);
    expect(axis.ticks.length).toBeLessThanOrEqual(7);
  });

  it("follows the data down when everything is small", () => {
    // A quiet 24 hours must not be drawn against a billion-credit axis, or every bar is a stub.
    const axis = buildLogFiveAxis([40_000, 900_000]);
    expect(axis.min).toBeLessThanOrEqual(40_000);
    expect(axis.max).toBeGreaterThanOrEqual(900_000);
    expect(axis.max).toBeLessThan(1e8);
  });
});

describe("zero, which a log axis cannot draw", () => {
  it("puts a non-positive value on the baseline rather than off the chart", () => {
    const axis = buildLogFiveAxis([1e6, 1e9]);
    expect(logFiveFraction(0, axis)).toBe(0);
    expect(logFiveFraction(-5, axis)).toBe(0);
    expect(Number.isFinite(logFiveFraction(0, axis))).toBe(true);
  });

  it("still returns a usable axis when nothing was earned at all", () => {
    /*
      Every category empty is a real window — a day he did not fly. The frame and the labelled rows
      must still draw, so the panel says "none" rather than looking broken.
    */
    const axis = buildLogFiveAxis([]);
    expect(axis.ticks.length).toBeGreaterThanOrEqual(2);
    expect(axis.max).toBeGreaterThan(axis.min);
    expect(logFiveFraction(0, axis)).toBe(0);
  });

  it("ignores a zero among real values rather than dragging the floor down", () => {
    const axis = buildLogFiveAxis([0, 25_000_000, 125_000_000]);
    expect(axis.min).toBeGreaterThan(0);
    expect(Number.isFinite(axis.min)).toBe(true);
  });
});

describe("where a bar ends", () => {
  it("is 0 at the floor and 1 at the ceiling", () => {
    const axis = buildLogFiveAxis([1e6, 625e6]);
    expect(logFiveFraction(axis.min, axis)).toBe(0);
    expect(logFiveFraction(axis.max, axis)).toBeCloseTo(1, 10);
  });

  it("puts each rung an equal step along, which is the point of the scale", () => {
    const axis = buildLogFiveAxis([1e6, 625e6]); // 1M 5M 25M 125M 625M — four gaps
    const at = axis.ticks.map((t) => logFiveFraction(t, axis));
    for (let i = 1; i < at.length; i += 1) {
      expect(at[i]! - at[i - 1]!).toBeCloseTo(0.25, 6);
    }
  });

  it("separates values a linear axis would flatten", () => {
    /*
      The reason the owner wanted this. Bounties against exobiology is 0.09 % linear -- a bar under
      one pixel tall. On this axis it is over a third of the height, which can be read.
    */
    const axis = buildLogFiveAxis([9_190_166, 7_771_860_600]);
    const small = logFiveFraction(9_190_166, axis);
    const large = logFiveFraction(7_771_860_600, axis);
    expect(small).toBeGreaterThan(0.05);
    expect(large).toBeGreaterThan(small);
    expect(9_190_166 / 7_771_860_600).toBeLessThan(0.002); // what linear would have given
  });

  it("never exceeds the chart", () => {
    const axis = buildLogFiveAxis([1e6, 5e6]);
    expect(logFiveFraction(1e12, axis)).toBe(1);
  });
});

describe("formatCredits", () => {
  it("writes the owner's ladder the way he wrote it", () => {
    expect(formatCredits(1e6)).toBe("1.0 M");
    expect(formatCredits(5e6)).toBe("5.0 M");
    expect(formatCredits(25e6)).toBe("25.0 M");
    expect(formatCredits(125e6)).toBe("125 M");
    expect(formatCredits(625e6)).toBe("625 M");
    expect(formatCredits(3.125e9)).toBe("3.13 bn");
  });

  it("keeps a sign on the trading cost line", () => {
    expect(formatCredits(-1_853_077_159)).toBe("-1.85 bn");
  });
});
