/**
 * The cached formatters say exactly what `toLocaleString` said (code review §E, 2026-09-27).
 */
import { describe, expect, it } from "vitest";
import { formatExomasteryNum } from "../src/server/exomasteryProfile.js";

const old = (n: number): string => {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs === 0) return "0.00";
  if (abs >= 1) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (abs >= 0.01) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
};

describe("formatExomasteryNum", () => {
  it("matches the old output on edge values and 5,000 random ones", () => {
    const vals = [0, -0, 1, -1, 0.01, 0.009999, 1e-7, 123456789.125, -0.5, NaN, Infinity, 2.005, 0.12345678];
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 5000; i++) vals.push((rnd() - 0.5) * 10 ** Math.floor(rnd() * 14 - 6));
    for (const v of vals) expect(formatExomasteryNum(v), String(v)).toBe(old(v));
  });
});
