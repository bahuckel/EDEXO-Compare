/**
 * The app has to know where in the galaxy the commander is, without opening the galaxy map.
 *
 * A 2 048-row region map shipped for weeks with no caller. Region is one of the strongest signals in
 * exobiology, and the owner's field reports keep landing on it — "Cactoida: region check" — so the
 * answer has to be on every snapshot, not behind a screen.
 */
import { describe, expect, it } from "vitest";
import { getProjectRoot } from "../src/server/paths.js";
import { regionForSystem, regionIndexForSystem } from "../src/server/regionMapData.js";

const root = getProjectRoot();

describe("region for a system", () => {
  const anchors: [string, [number, number, number], string][] = [
    ["Sol", [0, 0, 0], "Inner Orion Spur"],
    ["Sagittarius A*", [25.21875, -20.90625, 25899.96875], "Galactic Centre"],
    ["Colonia", [-9530.5, -910.28125, 19808.125], "Inner Scutum-Centaurus Arm"],
    ["Beagle Point", [-1111.5625, -134.21875, 65269.75], "The Abyss"],
    // Where the owner was when he asked for this.
    ["Blu Thua EM-D d12-25", [598.78125, 151.28125, 2572.5], "Inner Orion Spur"],
  ];
  for (const [name, [x, y, z], region] of anchors) {
    it(`places ${name} in ${region}`, () => {
      expect(regionForSystem(root, x, y, z)).toBe(region);
    });
  }

  it("gives an index for a named region and zero for nowhere", () => {
    expect(regionIndexForSystem(root, 0, 0)).toBeGreaterThan(0);
    // Far outside the galaxy: honestly nowhere rather than region 0 by accident.
    expect(regionIndexForSystem(root, 0, 500_000)).toBe(0);
  });
});
