/**
 * The camera behind the galaxy map.
 *
 * Two fixed views became one camera at two angles, which is the change that makes the angles between
 * them possible. These pin that the two old views still come out exactly as they were, because the
 * whole point is that nothing familiar moved — and that the maths is a rotation rather than a
 * plausible-looking smear.
 */
import { describe, expect, it } from "vitest";
import {
  CAMERA_SIDE,
  CAMERA_TOP,
  axisLabels,
  cameraLabel,
  project,
  type Vec3,
} from "../src/client/galaxyProjection.js";

const P: Vec3 = { x: 3, y: 5, z: 7 };

describe("looking straight down", () => {
  it("is the old top view: x across, z up", () => {
    const { u, v } = project(P, CAMERA_TOP);
    expect(u).toBeCloseTo(3, 9);
    expect(v).toBeCloseTo(7, 9);
  });

  it("ignores height, because height is toward the camera", () => {
    const a = project({ x: 1, y: -900, z: 2 }, CAMERA_TOP);
    const b = project({ x: 1, y: 900, z: 2 }, CAMERA_TOP);
    expect(a.u).toBeCloseTo(b.u, 9);
    expect(a.v).toBeCloseTo(b.v, 9);
  });
});

describe("edge-on", () => {
  it("is the old side view when pitch is zero: x across, y up", () => {
    const { u, v } = project(P, { yaw: 0, pitch: 0 });
    expect(u).toBeCloseTo(3, 9);
    expect(v).toBeCloseTo(5, 9);
  });

  it("ships tilted off dead flat, or the galaxy draws as a line", () => {
    // 100,000 ly across and 2,000 thick: at pitch 0 everything lands on one row.
    expect(CAMERA_SIDE.pitch).toBeGreaterThan(0);
    const near = project({ x: 0, y: 0, z: -20000 }, CAMERA_SIDE);
    const far = project({ x: 0, y: 0, z: 20000 }, CAMERA_SIDE);
    expect(Math.abs(far.v - near.v)).toBeGreaterThan(1000);
  });
});

describe("spinning the galaxy", () => {
  it("turns x into z after a quarter turn", () => {
    const { u } = project({ x: 0, y: 0, z: 10 }, { yaw: 90, pitch: 0 });
    expect(u).toBeCloseTo(10, 9);
  });

  it("preserves distance from the axis, because it is a rotation", () => {
    // A rotation cannot stretch anything. If this drifts, the projection is a shear.
    const p = { x: 30, y: 0, z: 40 };
    for (const yaw of [0, 17, 45, 90, 180, 270, 359]) {
      const a = project(p, { yaw, pitch: 0 });
      const b = project(p, { yaw, pitch: 90 });
      expect(Math.hypot(a.u, b.v)).toBeCloseTo(50, 6);
    }
  });

  it("comes back to where it started after a full turn", () => {
    const a = project(P, { yaw: 0, pitch: 30 });
    const b = project(P, { yaw: 360, pitch: 30 });
    expect(b.u).toBeCloseTo(a.u, 6);
    expect(b.v).toBeCloseTo(a.v, 6);
  });
});

describe("saying where the camera is", () => {
  it("does not claim an orientation the view does not have", () => {
    expect(axisLabels(CAMERA_TOP)).toEqual(["X →", "Z ↑"]);
    expect(axisLabels({ yaw: 0, pitch: 0 })).toEqual(["X →", "Y ↑"]);
    // Tilted: neither label alone is true, and saying "Z ↑" here would be a small lie.
    expect(axisLabels({ yaw: 20, pitch: 40 })[1]).toBe("Y / Z ↑");
  });

  it("names the two familiar views in words", () => {
    expect(cameraLabel(CAMERA_TOP)).toMatch(/straight down/i);
    expect(cameraLabel({ yaw: 0, pitch: 0 })).toMatch(/edge-on/i);
    expect(cameraLabel({ yaw: 33, pitch: 44 })).toMatch(/33/);
  });
});
