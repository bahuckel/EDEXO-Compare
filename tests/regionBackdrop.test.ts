/**
 * The galaxy backdrop's geometry.
 *
 * The pixel-to-galaxy transform is the part that can be wrong while looking right: an off-by-one or
 * a flipped axis still produces a plausible smear behind the markers, and the first time the region
 * map was integrated at all it rendered the galaxy upside down for exactly that reason. The
 * conversions are pure, so they can be pinned without a canvas.
 */
import { describe, expect, it } from "vitest";
import {
  LY_PER_REGION_PX,
  REGION_MAP_SIZE,
  regionSpanInCells,
  renderRegionBackdrop,
  xForRegionPx,
  zForRegionPz,
} from "../src/client/regionBackdrop.js";

describe("pixel to galactic coordinates", () => {
  it("uses the game's own 4096/83 sector constant", () => {
    // ~49.3494 ly. Rounding it to 49.35 drifts by nearly 100 ly at the far edge of the map.
    expect(LY_PER_REGION_PX).toBeCloseTo(49.3494, 4);
    expect(LY_PER_REGION_PX).toBe(4096 / 83);
  });

  it("reverses the offsets the vendored map was built with", () => {
    expect(xForRegionPx(0)).toBe(-49985);
    expect(zForRegionPz(0)).toBe(-24105);
  });

  it("places Sol inside the grid", () => {
    // Sol is the origin, so it must land in the middle of the map rather than off an edge.
    const solPx = (0 + 49985) / LY_PER_REGION_PX;
    const solPz = (0 + 24105) / LY_PER_REGION_PX;
    expect(solPx).toBeGreaterThan(0);
    expect(solPx).toBeLessThan(REGION_MAP_SIZE);
    expect(solPz).toBeGreaterThan(0);
    expect(solPz).toBeLessThan(REGION_MAP_SIZE);
  });

  it("puts the galactic core at a higher z than Sol", () => {
    // Sagittarius A* sits near z = +25,900. The map draws increasing z upward, so the core must come
    // out above Sol — the property the row flip exists to preserve.
    expect(zForRegionPz(1000)).toBeGreaterThan(zForRegionPz(0));
  });

  it("round-trips a pixel back to itself", () => {
    for (const px of [0, 1, 500, 2047]) {
      expect(Math.round((xForRegionPx(px) + 49985) / LY_PER_REGION_PX)).toBe(px);
    }
  });
});

describe("placing the grid against the sector map", () => {
  it("shares an origin with the sector grid, so only the scale differs", () => {
    // SECTOR_ORIGIN is (-49985, -40985, -24105) and the region map's own offsets are the same two
    // numbers on x and z. Equal corners mean a pixel becomes a cell index by scale alone.
    expect(xForRegionPx(0)).toBe(-49985);
    expect(zForRegionPz(0)).toBe(-24105);
  });

  it("spans about 79 sector cells", () => {
    // 2048 px x 49.3494 ly / 1280 ly. If this drifts, the backdrop and the markers stop agreeing.
    expect(regionSpanInCells(1280)).toBeCloseTo(78.96, 2);
  });
});

describe("rendering without a canvas", () => {
  it("returns null rather than throwing", () => {
    // vitest runs this file in node, so there is no document. A missing backdrop must leave the map
    // working, because the markers are the point and the galaxy behind them is decoration.
    expect(renderRegionBackdrop({ regions: [], regionmap: [] })).toBeNull();
  });
});

describe("plotting a system that knows where it is", () => {
  it("does not round it into a 1280 ly cell first", async () => {
    // The edge-on map drew every system as two or three stacked rows, because flooring y leaves four
    // possible values across the whole galaxy. Systems with real coordinates must keep them.
    const { sectorCellFractional, sectorCellFromCoords } = await import("../src/shared/sectorName.js");
    // Both inside one cell: 600 ly apart in the galaxy, identical on the map.
    const a = sectorCellFromCoords(0, 0, 0);
    const b = sectorCellFromCoords(0, 600, 0);
    expect(a.y).toBe(b.y);

    const fa = sectorCellFractional(0, 0, 0);
    const fb = sectorCellFractional(0, 600, 0);
    expect(fb.y - fa.y).toBeCloseTo(600 / 1280, 6);
  });

  it("stays in the same space as the floored form, so the two overlay", async () => {
    const { sectorCellFractional, sectorCellFromCoords } = await import("../src/shared/sectorName.js");
    for (const p of [
      [0, 0, 0],
      [-9530.5, -910.28, 19808.125],
      [25.2, -20.9, 25899.97],
    ] as const) {
      const f = sectorCellFractional(...p);
      const c = sectorCellFromCoords(...p);
      expect(Math.floor(f.x)).toBe(c.x);
      expect(Math.floor(f.y)).toBe(c.y);
      expect(Math.floor(f.z)).toBe(c.z);
    }
  });
});
