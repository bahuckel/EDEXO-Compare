/**
 * The Milky Way, drawn rather than photographed (owner, 2026-10-04: "recreate the PNG with clouds…
 * then remove the PNG"). A model in light years around Sagittarius A*: an exponential disc, a bulge
 * and a bar, two major and two minor logarithmic spiral arms, value-noise clouds along them, dust lanes
 * on their inner edges and pink star-forming knots. Rendered once into an RGB image in the frame the
 * old photograph used (its core pixel and scale), so both maps place it as they placed the photo.
 *
 * Pure and deterministic: the same picture on every machine, made in a worker in a few hundred
 * milliseconds, nothing per frame.
 */

export interface CloudFrame {
  width: number;
  height: number;
  /** Where Sagittarius A* falls in the image, in pixels. */
  coreX: number;
  coreY: number;
  /** Light years per pixel. */
  lyPerPx: number;
}

export interface CloudParams {
  /** Arm pitch angle, degrees. */
  pitchDeg: number;
  /** Where the first major arm starts, radians (rotates the whole pattern). */
  phase: number;
  /** +1 or -1: the way the arms wind. */
  wind: number;
  /** Bar angle, radians. */
  barAngle: number;
  seed: number;
}

export const DEFAULT_CLOUD_PARAMS: CloudParams = { pitchDeg: 21, phase: 1.72, wind: 1, barAngle: 0.45, seed: 7 };

// ------------------------------------------------------------------ value noise
function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function noise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(x, y, seed + o * 101);
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** The picture, RGBA (opaque, black where there is nothing). */
export function renderGalaxyClouds(frame: CloudFrame, p: CloudParams = DEFAULT_CLOUD_PARAMS): Uint8ClampedArray {
  const { width, height, coreX, coreY, lyPerPx } = frame;
  const out = new Uint8ClampedArray(width * height * 4);
  const k = p.wind / Math.tan((p.pitchDeg * Math.PI) / 180);
  const cb = Math.cos(p.barAngle);
  const sb = Math.sin(p.barAngle);
  for (let py = 0; py < height; py++) {
    // Image y grows downwards; galaxy z grows "up" (towards the core from Sol, and beyond).
    const dz = -(py - coreY) * lyPerPx;
    for (let px = 0; px < width; px++) {
      const dx = (px - coreX) * lyPerPx;
      const r = Math.hypot(dx, dz);
      const i = (py * width + px) * 4;
      if (r > 62_000) {
        out[i + 3] = 255;
        continue;
      }
      const th = Math.atan2(dz, dx);
      // Logarithmic spiral phase: constant along an arm.
      const phi = th - k * Math.log(Math.max(r, 400) / 4_000) - p.phase;
      const armZone = smooth(2_500, 7_000, r) * (1 - smooth(42_000, 54_000, r));
      const major = Math.pow(0.5 + 0.5 * Math.cos(2 * phi), 4.5);
      const minor = 0.75 * Math.pow(0.5 + 0.5 * Math.cos(2 * phi - Math.PI / 2 - 0.35), 5.5);
      const lane = Math.pow(0.5 + 0.5 * Math.cos(2 * phi + 0.75), 9);

      const nx = dx / 3_800;
      const nz = dz / 3_800;
      const clouds = fbm(nx, nz, p.seed, 5);
      const puff = Math.pow(clouds, 2.0) * 2.3;
      const fine = fbm(nx * 4.3, nz * 4.3, p.seed + 17, 3);
      const knots = Math.pow(Math.max(0, fine - 0.6) * 2.6, 3);
      const stars = Math.pow(Math.max(0, fbm(nx * 22, nz * 22, p.seed + 41, 2) - 0.72) * 3.4, 4);

      const disc = Math.exp(-r / 14_000) * (1 - smooth(44_000, 58_000, r));
      const inner = Math.exp(-r / 9_500);
      const bulge = Math.exp(-((r / 3_200) ** 2));
      const u = dx * cb + dz * sb;
      const v = -dx * sb + dz * cb;
      const bar = Math.exp(-((u / 7_000) ** 2 + (v / 2_000) ** 2));
      const arms = (major + minor) * armZone * (0.3 + puff);
      const dust = 1 - 0.55 * lane * armZone * (0.4 + clouds);
      // Warm inside, blue-white outside: the arms change colour with the radius.
      const blue = smooth(16_000, 40_000, r);

      const glow = 1.6 * bulge + 0.8 * bar + 1.15 * inner * (0.4 + puff) + 0.12 * disc * (0.3 + clouds);
      const a = arms * disc * 2.9;
      let rr = glow * 1.0 + a * (1.0 - 0.38 * blue);
      let gg = glow * 0.84 + a * (0.9 - 0.1 * blue);
      let bb = glow * 0.62 + a * (0.75 + 0.3 * blue);
      const pink = knots * (major + minor) * armZone * disc * 5;
      rr += pink + stars * disc * 0.8;
      gg += 0.45 * pink + stars * disc * 0.8;
      bb += 0.7 * pink + stars * disc * 0.9;
      rr *= dust;
      gg *= dust * 0.96;
      bb *= dust * 0.92;
      out[i] = 255 * (1 - Math.exp(-rr * 1.6));
      out[i + 1] = 255 * (1 - Math.exp(-gg * 1.6));
      out[i + 2] = 255 * (1 - Math.exp(-bb * 1.6));
      out[i + 3] = 255;
    }
  }
  return out;
}
