/**
 * The full jump range as flown (shared/jumpRange.ts; owner, 2026-10-08): boosted jumps and
 * economical-route hops left out, a new ship or a refit starts over.
 */
import { describe, expect, it } from "vitest";
import {
  emptyJumpRange,
  fullJumpRange,
  jumpRangeJump,
  jumpRangeLoadout,
  onEconomicalRoute,
} from "../src/shared/jumpRange.js";

const fly = (st: ReturnType<typeof emptyJumpRange>, ...d: number[]) =>
  d.forEach((x) => jumpRangeJump(st, x, undefined));

describe("the full jump range as flown", () => {
  it("is the long end of the plotted jumps, not their average", () => {
    const st = emptyJumpRange();
    jumpRangeLoadout(st, 7, 71.63);
    fly(st, 66.4, 56.6, 63.5);
    expect(fullJumpRange(st)).toBe(66.4);
    fly(st, 66.5, 63.8, 67.3, 62.6, 65.1, 49.8, 38.8);
    expect(fullJumpRange(st)).toBe(67.3);
  });

  it("leaves out a neutron or white dwarf boost and an injection", () => {
    const st = emptyJumpRange();
    fly(st, 66, 67, 68);
    jumpRangeJump(st, 260, 4);
    jumpRangeJump(st, 100, 2);
    expect(fullJumpRange(st)).toBe(68);
  });

  it("keeps the full range through an economical route, however long", () => {
    const st = emptyJumpRange();
    fly(st, 66, 67, 68, 67);
    for (let i = 0; i < 60; i++) fly(st, 3 + (i % 3));
    expect(fullJumpRange(st)).toBe(68);
    expect(onEconomicalRoute(st)).toBe(true);
    fly(st, 66);
    expect(onEconomicalRoute(st)).toBe(false);
  });

  it("works at any range: 23-25 ly the same way", () => {
    const st = emptyJumpRange();
    fly(st, 23, 24, 25, 4, 5, 24);
    expect(fullJumpRange(st)).toBe(25);
  });

  it("starts over for another ship, or a refit that changes the loadout's own range", () => {
    const st = emptyJumpRange();
    jumpRangeLoadout(st, 7, 71.63);
    fly(st, 66, 67, 68);
    jumpRangeLoadout(st, 7, 71.7); // the same ship, fuel or a small change: kept
    expect(fullJumpRange(st)).toBe(68);
    jumpRangeLoadout(st, 7, 60.1); // a refit
    expect(fullJumpRange(st)).toBeNull();
    fly(st, 55, 56, 57);
    jumpRangeLoadout(st, 9, 30); // another ship
    expect(fullJumpRange(st)).toBeNull();
  });
});
