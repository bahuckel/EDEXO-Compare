/**
 * The 3D map's pure parts: region outlines and anchors (shared/regionBorders.ts), label placement,
 * renderer classification, and the idle release of the map's server memory (galaxyMemory.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeRegionGrid, regionOutlines } from "../src/shared/regionBorders.js";
import { placeLabels } from "../src/client/galaxy3d/labelPlacement.js";
import { classifyRenderer } from "../src/client/galaxy3d/capabilities.js";
import { REGION_MAP_LY_PER_PIXEL, REGION_MAP_X0, REGION_MAP_Z0 } from "../src/shared/regionMap.js";
import type { RegionMapData } from "../src/shared/regionMap.js";

/** A 4 × 4 map: region 1 on the left half, region 2 on the right half of the bottom two rows. */
const MAP: RegionMapData = {
  regions: [null, "Left", "Right"],
  regionmap: [
    [
      [2, 1],
      [2, 2],
    ],
    [
      [2, 1],
      [2, 2],
    ],
    [[2, 1], [2, 0]],
    [[4, 0]],
  ],
};

describe("region outlines", () => {
  it("decodes the runs", () => {
    expect([...decodeRegionGrid(MAP, 4)]).toEqual([1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0]);
  });

  it("draws every edge where the region changes, merged along rows and columns", () => {
    const { segments } = regionOutlines(MAP, 4);
    const L = REGION_MAP_LY_PER_PIXEL;
    const segs: string[] = [];
    for (let i = 0; i < segments.length; i += 4) {
      const p = [...segments.subarray(i, i + 4)].map((v, k) =>
        Math.round((v - (k % 2 === 0 ? REGION_MAP_X0 : REGION_MAP_Z0)) / L),
      );
      segs.push(p.join(","));
    }
    // In pixel units: bottom edge of both regions (z 0), top of Right (z 2, x 2–4), top of Left
    // (z 3, x 0–2), galaxy edge at x 0 (z 0–3), Left|Right at x 2 (z 0–2), Left's right edge on the
    // third row (x 2, z 2–3), Right's right edge (x 4, z 0–2).
    expect(segs.sort()).toEqual(
      ["0,0,4,0", "2,2,4,2", "0,3,2,3", "0,0,0,3", "2,0,2,3", "4,0,4,2"].sort(),
    );
  });

  it("anchors each named region inside itself, biggest first", () => {
    const { anchors } = regionOutlines(MAP, 4);
    expect(anchors.map((a) => a.name)).toEqual(["Left", "Right"]);
    const px = (x: number) => Math.floor((x - REGION_MAP_X0) / REGION_MAP_LY_PER_PIXEL);
    const pz = (z: number) => Math.floor((z - REGION_MAP_Z0) / REGION_MAP_LY_PER_PIXEL);
    const grid = decodeRegionGrid(MAP, 4);
    for (const a of anchors) expect(grid[pz(a.z) * 4 + px(a.x)]).toBe(a.index);
  });
});

describe("label placement", () => {
  const vp = { width: 800, height: 600 };
  it("places the more important of two overlapping labels and skips off-screen ones", () => {
    const placed = placeLabels(
      [
        { id: "small", x: 105, y: 100, w: 80, h: 18, priority: 1 },
        { id: "big", x: 100, y: 100, w: 80, h: 18, priority: 9 },
        { id: "far", x: 400, y: 300, w: 80, h: 18, priority: 5 },
        { id: "off", x: -300, y: 100, w: 80, h: 18, priority: 99 },
      ],
      vp,
    );
    expect(placed.map((p) => p.id)).toEqual(["big", "far"]);
    expect(placed[0]).toEqual({ id: "big", left: 60, top: 91 });
  });
});

describe("renderer classification", () => {
  it("calls software renderers light and real GPUs full", () => {
    expect(classifyRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)")).toBe("light");
    expect(classifyRenderer("llvmpipe (LLVM 17.0.6, 256 bits)")).toBe("light");
    expect(classifyRenderer("ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)")).toBe("light");
    expect(classifyRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("full");
    expect(classifyRenderer("Mesa Intel(R) UHD Graphics 620 (KBL GT2)")).toBe("full");
    expect(classifyRenderer("AMD Radeon Graphics (radeonsi, renoir, LLVM 15.0.7, DRM 3.54)")).toBe("full");
  });
});

describe("galaxy memory", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("releases every registered cache after the idle time, and not before", async () => {
    vi.useFakeTimers();
    vi.stubEnv("EDEXO_GALAXY_IDLE_MS", "1000");
    const m = await import("../src/server/galaxyMemory.js");
    const released: string[] = [];
    m.registerGalaxyCache("a", () => released.push("a"));
    m.registerGalaxyCache("b", () => released.push("b"));
    m.touchGalaxyMemory();
    vi.advanceTimersByTime(900);
    m.touchGalaxyMemory(); // a request resets the clock
    vi.advanceTimersByTime(900);
    expect(released).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(released).toEqual(["a", "b"]);
    expect(m.galaxyMemoryState().releasedCount).toBe(1);
  });
});

describe("groups", () => {
  it("picks the grid from the camera distance", async () => {
    const { levelForDistance, distanceToOpen } = await import("../src/client/galaxy3d/clusters.js");
    expect([110_000, 30_000, 8_000, 1_500, 400].map(levelForDistance)).toEqual([0, 1280, 320, 80, 0]);
    // Opening a group lands inside the next grid down.
    expect(levelForDistance(distanceToOpen(1280))).toBe(320);
    expect(levelForDistance(distanceToOpen(320))).toBe(80);
    expect(levelForDistance(distanceToOpen(80))).toBe(0);
  });

  it("buckets a tile into fixed sub-cubes at its systems' centroids, keeping the best value", async () => {
    const { clustersFromTile } = await import("../src/client/galaxy3d/clusters.js");
    const { cellOf, cellMin, quantiseInCell } = await import("../src/shared/galaxyGrid.js");
    const cell = cellOf(0, 0, 0);
    const m = cellMin(cell);
    const sys = [
      [0, 0, 0],
      [3, 0, 3],
      [200, 10, 0], // another 80 ly cube, same 320 ly cube as the first two
    ];
    const pos = new Int16Array(sys.flatMap(([x, y, z]) => [quantiseInCell(x!, m.x), quantiseInCell(y!, m.y), quantiseInCell(z!, m.z)]));
    const values = new Uint16Array([5, 70, 9]);
    const big = clustersFromTile(cell, pos, values, 320);
    const small = clustersFromTile(cell, pos, values, 80);
    expect(small).toHaveLength(2);
    const near = small.find((g) => g.count === 2)!;
    expect(near.x).toBeCloseTo(1.5, 1);
    expect(near.top).toBe(70);
    // At 320 ly they may share a cube or not depending on where Sol sits inside its sector; either
    // way nothing is lost and counts add up.
    expect(big.reduce((a, g) => a + g.count, 0)).toBe(3);
  });

  it("formats counts and credits the way the labels show them", async () => {
    const { formatCount, formatValue } = await import("../src/client/galaxy3d/clusters.js");
    expect([7, 1234, 45_678, 1_234_567].map(formatCount)).toEqual(["7", "1.2k", "46k", "1.2M"]);
    expect([0, 4, 125, 11_000].map(formatValue)).toEqual(["—", "400 k CR", "12.5 M CR", "1.10 B CR"]);
  });
});

describe("which groups get a ring", () => {
  it("gives a sparse part of the view its own ring even when a dense corner could fill the quota", async () => {
    const { chooseShown } = await import("../src/client/galaxy3d/clusters.js");
    const vp = { width: 1600, height: 900 };
    // Forty big groups packed on the left, two small ones in the middle and on the right.
    const dense = Array.from({ length: 40 }, (_, i) => ({ id: `d${i}`, sx: 40 + (i % 5) * 60, sy: 60 + Math.floor(i / 5) * 100, count: 10_000 - i, top: 1 }));
    const sparse = [
      { id: "middle", sx: 800, sy: 450, count: 40, top: 1 },
      { id: "right", sx: 1400, sy: 300, count: 12, top: 1 },
    ];
    const shown = chooseShown([...dense, ...sparse], vp, 10, false, () => 12);
    const ids = shown.map((g) => g.id);
    expect(ids).toContain("middle");
    expect(ids).toContain("right");
    expect(ids).toHaveLength(10);
    // Never two rings on top of each other.
    for (const a of shown) for (const b of shown) if (a !== b) expect(Math.hypot(a.sx - b.sx, a.sy - b.sy)).toBeGreaterThanOrEqual(50);
  });
});
