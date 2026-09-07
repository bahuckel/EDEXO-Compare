/**
 * The region map, checked against places whose region is not in dispute.
 *
 * These four systems are the ones any commander could confirm from the galaxy map, which is exactly
 * why they are the test: an implementation that gets Sol and Sagittarius A* right is using the
 * transform correctly, and one that has px and pz swapped or the rows flipped gets them wrong. Both
 * of those mistakes were made and caught while writing this, and each produced a plausible-looking
 * wrong region rather than an error.
 */
import { describe, expect, it } from "vitest";
import {
  loadRegionMap,
  regionForSystem,
  regionIndexForSystem,
  setRegionMapForTests,
} from "../src/server/regionMapData.js";
import {
  REGION_MAP_LY_PER_PIXEL,
  normaliseRegionName,
  regionForCoords,
  sameRegion,
} from "../src/shared/regionMap.js";

const root = process.cwd();

describe("region map data", () => {
  it("ships and parses", () => {
    const m = loadRegionMap(root);
    expect(m).not.toBeNull();
    expect(m?.regionmap).toHaveLength(2048);
    // 42 named regions plus the null at index 0.
    expect(m?.regions).toHaveLength(43);
    expect(m?.regions[0]).toBeNull();
  });

  it("every row spans the full width", () => {
    const m = loadRegionMap(root);
    for (const row of m?.regionmap ?? []) {
      expect(row.reduce((n, [len]) => n + len, 0)).toBe(2048);
    }
  });
});

describe("regionForSystem", () => {
  it.each([
    ["Sol", 0, 0, 0, "Inner Orion Spur"],
    ["Sagittarius A*", 25.21875, -20.90625, 25899.96875, "Galactic Centre"],
    ["Colonia", -9530.5, -910.28125, 19808.125, "Inner Scutum-Centaurus Arm"],
    ["Beagle Point", -1111.5625, -134.21875, 65269.75, "The Abyss"],
  ])("places %s", (_name, x, y, z, expected) => {
    expect(regionForSystem(root, x as number, y as number, z as number)).toBe(expected);
  });

  it("ignores y, because the map is two-dimensional", () => {
    const at = (y: number) => regionForSystem(root, 0, y, 0);
    expect(at(0)).toBe(at(5000));
    expect(at(0)).toBe(at(-5000));
  });

  it("returns null well outside the grid rather than guessing", () => {
    expect(regionForSystem(root, 0, 0, -999_999)).toBeNull();
    expect(regionForSystem(root, -999_999, 0, 0)).toBeNull();
  });

  it("is null, not a throw, when the map is absent", () => {
    // A build that did not ship the file must degrade to "cannot tell", never to a crash.
    //
    // Goes through the seam rather than passing a bogus projectRoot: the map is cached per process,
    // so once it has loaded no later path argument reaches the disk. That is the same contract the
    // spatial catalogue has, and the cache is the thing worth keeping — not the argument.
    const real = loadRegionMap(root);
    try {
      setRegionMapForTests(null);
      expect(regionForSystem(root, 0, 0, 0)).toBeNull();
      expect(regionIndexForSystem(root, 0, 0)).toBeNull();
    } finally {
      setRegionMapForTests(real);
    }
    expect(regionForSystem(root, 0, 0, 0)).toBe("Inner Orion Spur");
  });
});

describe("pixel size", () => {
  it("is about 49 ly, which is the accuracy of any answer here", () => {
    expect(REGION_MAP_LY_PER_PIXEL).toBeCloseTo(49.35, 2);
  });

  it("two points inside one pixel cannot differ", () => {
    const m = loadRegionMap(root)!;
    // Half a pixel from Sol is still Sol's pixel.
    expect(regionForCoords(m, 20, 0, 20)).toBe(regionForCoords(m, 0, 0, 0));
  });
});

describe("normaliseRegionName", () => {
  it("joins the two spellings of Achilles's Altar", () => {
    // 12,641 systems in the codex dump turn on exactly this.
    expect(normaliseRegionName("Achilles' Altar")).toBe(normaliseRegionName("Achilles's Altar"));
    expect(sameRegion("Achilles' Altar", "Achilles's Altar")).toBe(true);
  });

  it("leaves the other possessive regions matching themselves", () => {
    for (const n of ["Ryker's Hope", "Odin's Hold", "Hawking's Gap", "Dryman's Point",
                     "Aquila's Halo", "Kepler's Crest", "Lyra's Song", "Newton's Vault"]) {
      expect(sameRegion(n, n)).toBe(true);
    }
  });

  it("does not merge regions that only look alike", () => {
    expect(sameRegion("Norma Arm", "Norma Expanse")).toBe(false);
    expect(sameRegion("Inner Orion Spur", "Outer Orion Spur")).toBe(false);
    expect(sameRegion("The Abyss", "The Void")).toBe(false);
  });

  it("treats empty and null as matching nothing, including each other", () => {
    expect(sameRegion(null, null)).toBe(false);
    expect(sameRegion("", "")).toBe(false);
    expect(sameRegion("Temple", null)).toBe(false);
  });
});
