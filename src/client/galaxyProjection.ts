/**
 * Where a point in the galaxy lands on the map, at whatever angle the commander is looking from.
 *
 * The map had two fixed projections — looking down, and edge-on — implemented as two different pairs
 * of axis pickers. They are not two things. They are one camera at two angles, and writing them as
 * one is what makes the angles in between possible: edge-on is where the galaxy overlaps itself
 * worst, and the way out is to be able to tilt off it.
 *
 * Two controls, both in degrees:
 *
 *   yaw    spins the galaxy about its vertical axis. Nothing overlaps at every yaw, so a cluster
 *          hidden behind another at one angle separates at the next.
 *   pitch  0° looks along the plane (the old side view), 90° looks straight down on it (the old top
 *          view). Anything between is the view neither of them could give.
 *
 * Coordinates in, coordinates out — light years or sector cells, this does not care, as long as one
 * call site is consistent. It is deliberately pure and has no idea a screen exists; zoom, pan and
 * pixel fitting are the caller's business.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Camera {
  /** Degrees about the galactic vertical. 0 keeps x pointing right. */
  yaw: number;
  /** Degrees. 0 is edge-on, 90 is looking straight down. */
  pitch: number;
}

/** The old "Top (X / Z)" view, exactly. */
export const CAMERA_TOP: Camera = { yaw: 0, pitch: 90 };

/**
 * The old "Side (X / Y)" view, tilted a little off dead edge-on.
 *
 * Dead flat is where a galaxy 100 000 ly across and 2 000 ly thick draws as a line, which is what
 * the commander was looking at. Twelve degrees is enough to separate near from far without pretending
 * to be a perspective view.
 */
export const CAMERA_SIDE: Camera = { yaw: 0, pitch: 12 };

const RAD = Math.PI / 180;

/**
 * Project a point to plot coordinates.
 *
 * `u` grows right, `v` grows **up** — the caller flips it for SVG, which is the one place that
 * convention belongs. Returning screen-down here would bake a rendering detail into the geometry and
 * make the maths impossible to check against a piece of paper.
 */
export function project(p: Vec3, cam: Camera): { u: number; v: number; depth: number } {
  const cy = Math.cos(cam.yaw * RAD);
  const sy = Math.sin(cam.yaw * RAD);
  // Spin about the vertical axis first: this is the galaxy turning, not the camera orbiting.
  const x = p.x * cy + p.z * sy;
  const z = -p.x * sy + p.z * cy;

  const cp = Math.cos(cam.pitch * RAD);
  const sp = Math.sin(cam.pitch * RAD);
  return {
    u: x,
    v: p.y * cp + z * sp,
    // How far from the camera, for drawing order. Nearer points should land on top of farther ones.
    depth: z * cp - p.y * sp,
  };
}

/** Axis captions for a camera, so the labels never claim an orientation the view does not have. */
export function axisLabels(cam: Camera): [string, string] {
  const flat = Math.abs(cam.pitch) < 5;
  const down = Math.abs(cam.pitch) > 85;
  if (down) return ["X →", "Z ↑"];
  if (flat) return ["X →", "Y ↑"];
  return ["X →", "Y / Z ↑"];
}

/** A short description of where the camera is, for the caption under a plot. */
export function cameraLabel(cam: Camera): string {
  const yaw = Math.round(cam.yaw);
  const pitch = Math.round(cam.pitch);
  if (pitch >= 85 && yaw === 0) return "Looking straight down";
  if (pitch <= 5 && yaw === 0) return "Edge-on";
  return `Yaw ${yaw}° · Pitch ${pitch}°`;
}
