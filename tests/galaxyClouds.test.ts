/**
 * The drawn Milky Way (owner, 2026-10-04): the same picture every time, bright at the core, arms
 * between, black beyond the disc.
 */
import { describe, expect, it } from "vitest";
import { renderGalaxyClouds } from "../src/shared/galaxyClouds.js";

const frame = { width: 160, height: 120, coreX: 80, coreY: 60, lyPerPx: 900 };
const lum = (px: Uint8ClampedArray, x: number, y: number) => {
  const i = (y * frame.width + x) * 4;
  return px[i]! + px[i + 1]! + px[i + 2]!;
};

describe("renderGalaxyClouds", () => {
  it("is deterministic and opaque", () => {
    const a = renderGalaxyClouds(frame);
    const b = renderGalaxyClouds(frame);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255);
  });

  it("is brightest at the core and black far outside the disc", () => {
    const px = renderGalaxyClouds(frame);
    const core = lum(px, 80, 60);
    expect(core).toBeGreaterThan(600);
    expect(core).toBeGreaterThan(lum(px, 80 + 30, 60)); // 27,000 ly out
    expect(lum(px, 0, 0)).toBe(0); // ~90,000 ly from the core
  });
});
