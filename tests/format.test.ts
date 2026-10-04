/**
 * The one place numbers and units are written (plan 3.4a): the screens must agree.
 */
import { describe, expect, it } from "vitest";
import {
  fmtCrExact,
  fmtCrRangeExact,
  fmtCrShort,
  fmtLs,
  fmtLsExact,
  fmtLy,
  fmtLyAway,
  fmtPct,
} from "../src/shared/format.js";

describe("credits", () => {
  it("short scale: k only from 100,000, B for billions", () => {
    expect(fmtCrShort(12_345)).toBe("12,345");
    expect(fmtCrShort(612_000)).toBe("612 k");
    expect(fmtCrShort(7_940_000)).toBe("7.94 M");
    expect(fmtCrShort(1_200_000_000)).toBe("1.20 B");
    expect(fmtCrShort(null)).toBe("—");
  });

  it("exact figures are whole and grouped", () => {
    expect(fmtCrExact(1_234_567.6)).toBe("1,234,568 CR");
    expect(fmtCrRangeExact(1_000, 2_000)).toBe("1,000 – 2,000 CR");
    expect(fmtCrRangeExact(5, 5)).toBe("5 CR");
  });
});

describe("distances", () => {
  it("Ls with a capital L", () => {
    expect(fmtLs(4.23)).toBe("4.2 Ls");
    expect(fmtLs(318.4, true)).toBe("~318 Ls");
    expect(fmtLs(12_400)).toBe("12.4k Ls");
    expect(fmtLsExact(0)).toBe("0 Ls");
    expect(fmtLsExact(1234.567)).toBe("1,234.57 Ls");
  });

  it("ly: a jump to a decimal, a distance whole, the galaxy in kly", () => {
    expect(fmtLy(8.43)).toBe("8.4 ly");
    expect(fmtLy(1234.4)).toBe("1,234 ly");
    expect(fmtLy(23_456)).toBe("23.5 kly");
    expect(fmtLy(null)).toBe("—");
    expect(fmtLyAway(0.2)).toBe("here");
    expect(fmtLyAway(42)).toBe("42.0 ly");
  });
});

describe("percent", () => {
  it("no space, and <1% for a share that is not nothing", () => {
    expect(fmtPct(12.4)).toBe("12%");
    expect(fmtPct(0.4)).toBe("<1%");
    expect(fmtPct(0)).toBe("0%");
    expect(fmtPct(0.42, 2)).toBe("0.42%");
  });
});
