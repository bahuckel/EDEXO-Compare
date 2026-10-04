/**
 * The drawn Milky Way (owner, 2026-10-04): the same picture every time, bright at the core, arms
 * between, black beyond the disc.
 */
import { describe, expect, it } from "vitest";
import { CLOUD_SPRITE_STRIDE, galaxyCloudSprites, renderGalaxyClouds } from "../src/shared/galaxyClouds.js";

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

describe("galaxyCloudSprites (the 3D clouds, owner 2026-10-04)", () => {
  const big = { width: 300, height: 220, coreX: 150, coreY: 110, lyPerPx: 420 };
  const n = big.width * big.height;
  const clear = new Uint8ClampedArray(n * 4);
  const dust = new Float32Array(n);
  renderGalaxyClouds(big, { clear, dust });
  const sp = galaxyCloudSprites(big, clear, dust, { emission: 4000, dust: 1000 });
  const rows = Array.from({ length: sp.length / CLOUD_SPRITE_STRIDE }, (_, k) => sp.subarray(k * CLOUD_SPRITE_STRIDE, (k + 1) * CLOUD_SPRITE_STRIDE));

  it("is deterministic, finite, light first then dust", () => {
    const again = galaxyCloudSprites(big, clear, dust, { emission: 4000, dust: 1000 });
    expect(Buffer.from(again.buffer).equals(Buffer.from(sp.buffer))).toBe(true);
    expect(rows.every((r) => r.every(Number.isFinite))).toBe(true);
    const light = rows.filter((r) => r[7] === 1);
    const dark = rows.filter((r) => r[7]! < 1);
    expect(light.length).toBe(4000);
    expect(dark.length).toBe(1000);
    expect(rows.findIndex((r) => r[7]! < 1)).toBe(4000);
    expect(dark.every((r) => r[7]! > 0 && r[7]! <= 0.9)).toBe(true);
  });

  it("stands thick at the core and lies thin in the disc", () => {
    const radius = (r: Float32Array) => Math.hypot((r[0]! - big.coreX) * big.lyPerPx, (r[1]! - big.coreY) * big.lyPerPx);
    const spread = (sel: Float32Array[]) => Math.sqrt(sel.reduce((a, r) => a + r[2]! ** 2, 0) / sel.length);
    const light = rows.filter((r) => r[7] === 1);
    const core = light.filter((r) => radius(r) < 4_000);
    const disc = light.filter((r) => radius(r) > 15_000 && radius(r) < 30_000);
    expect(core.length).toBeGreaterThan(30);
    expect(spread(core)).toBeGreaterThan(5 * spread(disc));
  });

  it("puts its light where the drawing is bright", () => {
    // Seen from above the sprites add up to the drawing: compare light near the core with the outer disc.
    const sum = (lo: number, hi: number) =>
      rows
        .filter((r) => r[7] === 1)
        .filter((r) => {
          const d = Math.hypot((r[0]! - big.coreX) * big.lyPerPx, (r[1]! - big.coreY) * big.lyPerPx);
          return d >= lo && d < hi;
        })
        .reduce((a, r) => a + (r[4]! + r[5]! + r[6]!) * (Math.PI / 8) * (r[3]! / big.lyPerPx) ** 2, 0);
    const drawn = (lo: number, hi: number) => {
      let s = 0;
      for (let y = 0; y < big.height; y++)
        for (let x = 0; x < big.width; x++) {
          const d = Math.hypot((x + 0.5 - big.coreX) * big.lyPerPx, (y + 0.5 - big.coreY) * big.lyPerPx);
          if (d >= lo && d < hi) s += (clear[(y * big.width + x) * 4]! + clear[(y * big.width + x) * 4 + 1]! + clear[(y * big.width + x) * 4 + 2]!) / 255;
        }
      return s;
    };
    for (const [lo, hi] of [
      [0, 10_000],
      [10_000, 30_000],
      [30_000, 50_000],
    ] as const) {
      expect(sum(lo, hi) / drawn(lo, hi)).toBeGreaterThan(0.75);
      expect(sum(lo, hi) / drawn(lo, hi)).toBeLessThan(1.33);
    }
  });
});
