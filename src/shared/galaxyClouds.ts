/**
 * The Milky Way, drawn rather than photographed (owner, 2026-10-04: "recreate the PNG with clouds…
 * then remove the PNG"). A model in light years around Sagittarius A*: a warm bulge and bar, an
 * exponential disc, and the arms — each one a centre line traced off the old picture (where it starts,
 * how it winds, how bright it is along the way), dressed in value-noise clouds, a dust lane on its
 * inner edge and pink star-forming knots. Every arm runs on past its traced end as fainter, thinner,
 * darker cloud, so nothing stops at a hard edge (owner, 2026-10-04: "7 arms, not 4… the ends should
 * be fainter, darker, more transparent clouds").
 *
 * Rendered once into an RGB image in the frame the old photograph used (its core pixel and scale), so
 * both maps place it as they placed the photo. Pure and deterministic: the same picture on every
 * machine, made in a worker in a few hundred milliseconds, nothing per frame.
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

/**
 * The arms, as traced: `t0` is the galactic angle of the first point in degrees (0 = +x, counting
 * towards +z, i.e. anticlockwise seen from above; it runs past 360 on arms that wind more than once
 * around), then one point every 4°. `r` is the distance from the core in hundreds of light years,
 * `s` the arm's strength there, 0–9. `from` (degrees, hundreds of ly) is where an arm leaves the bar:
 * it is drawn from there to its first traced point.
 */
interface ArmSpec {
  from?: [number, number];
  t0: number;
  r: string;
  s: string;
}

const ARM_TABLE: ArmSpec[] = [
  {
    t0: 278,
    r: "137 137 137 136 136 136 137 137 138 139 140 141 141 142 144 145 147 148 150 151 152 154 155 157 159 162 164 167 169 171 173 174 175 176 176 177 178 178 179 179 179 179 181 182 185 188 191 194 198 202 207 213 220 227 235 243 252 260 269 279 289 300 311 321 330 337 344 351 358 365 374 383 393 403 412 420 425 427 427 428 428 429 429 430 431 434 438 444 450 456 462 468 473 478 481 485",
    s: "233322333333222210013344556788644431124664223445554444333565435544564323211122222344321123565422",
  },
  {
    from: [240, 70],
    t0: 306,
    r: "88 89 90 92 93 95 96 97 97 98 99 99 100 100 101 101 102 103 104 105 105 106 106 105 104 104 104 104 106 107 109 112 115 117 120 122 124 125 127 129 130 131 132 132 132 133 133 134 135 137 138 140 141 143 145 147 150 155 160 166 172 178 184 190 195 201 206 212 217 222 227 232 236 240 242 244 245 246 246 247 249 251 254 258 262 267 272 278 283 289 294 300 305 309 314 318 322 324 327 328 330 331 333 335 338 342 346 350 353 356 360 365 371 378 385 392 398 404 410 414 418 421 424 428 433 438 444 450 455 459 462 464 465",
    s: "2222222222333333333333332223333333333333332222222210012222344322344445566643111344334766678887653348797733444589743321122333222211111",
  },
  {
    from: [60, 70],
    t0: 212,
    r: "157 159 161 163 165 167 169 171 173 175 177 179 182 185 187 190 191 193 194 194 195 196 198 201 203 206 208 211 213 215 216 217 216 217 218 221 227 233 238 243 246 248 251 254 259 263 269 276 282 289 295 299 302 304 305 306 307 308 309 310 312 313 315 318 323 331 342 356 372 388 402 414 424 432 439 443 446 447 448 450 452 455 459 464 468 471",
    s: "22233333322233333234554456566643455432356765565444443113454432333211125663323222233322",
  },
  {
    t0: 135,
    r: "173 176 179 183 189 196 205 215 225 235 244 253 262 270 278 285 292 298 303 307 311 315 319 323 327 331 336 340 345 350 355 360 364 369 374 378 383 388 394 399 404 408 413 419 426 434 443 451 458 464 468 471 474",
    s: "33333333445443433233557555688633899897658985765324443",
  },
  {
    t0: 8,
    r: "246 247 249 251 254 258 262 266 269 272 275 277 279 281 284 289 293 298 303 308 312 315 319 324 331 339 348 358 368 378 387 394",
    s: "56755565444443335454432223221123",
  },
  {
    t0: 198,
    r: "268 273 278 284 290 296 301 305 308 310 310 310 310 309 308 308 308 309 310 313 317 320 324 327 330",
    s: "2233455643000000013454433",
  },
];

/** Degrees an arm is drawn on before its first traced point, fading in. */
const LEAD_DEG = 24;
/** Degrees an arm runs on past its last traced point, thinning out into faint cloud. */
const TAIL_DEG = 70;

interface Arm {
  /** Angle of index 0, degrees. */
  start: number;
  /** ln(r) and strength (0–1) at one-degree steps, lead-in and tail included (the fading is applied when drawn). */
  lnr: Float64Array;
  str: Float64Array;
  /** Index of the first traced point and of the last; outside them the arm fades. */
  i0: number;
  i1: number;
  /** Strength kept at the very start: an arm that leaves the bar starts half lit, others from nothing. */
  base: number;
}

function buildArm(spec: ArmSpec): Arm {
  const rk = spec.r.split(" ").map((v) => Math.log(Number(v) * 100));
  const sk = [...spec.s].map((c) => Number(c) / 9);
  const traced = (rk.length - 1) * 4;
  const lead = spec.from ? spec.t0 - spec.from[0] : LEAD_DEG;
  const len = lead + traced + TAIL_DEG + 1;
  const lnr = new Float64Array(len);
  const str = new Float64Array(len);
  for (let d = 0; d <= traced; d++) {
    const k = Math.min(rk.length - 2, Math.floor(d / 4));
    const f = d / 4 - k;
    lnr[lead + d] = rk[k]! * (1 - f) + rk[k + 1]! * f;
    str[lead + d] = sk[k]! * (1 - f) + sk[k + 1]! * f;
  }
  // Run on along the arm's own winding at either end, its pitch kept within what spirals do.
  const slope = (a: number, b: number) => Math.min(0.42, Math.max(0.12, (lnr[b]! - lnr[a]!) / (((b - a) * Math.PI) / 180)));
  const leadSlope = slope(lead, lead + 16);
  const tailSlope = slope(lead + traced - 24, lead + traced);
  const s0 = str[lead]!;
  const s1 = str[lead + traced]!;
  for (let d = 1; d <= lead; d++) {
    lnr[lead - d] = spec.from
      ? lnr[lead]! + (Math.log(spec.from[1] * 100) - lnr[lead]!) * (d / lead)
      : lnr[lead]! - leadSlope * ((d * Math.PI) / 180);
    str[lead - d] = s0;
  }
  for (let d = 1; d <= TAIL_DEG; d++) {
    const i = lead + traced + d;
    lnr[i] = lnr[lead + traced]! + tailSlope * ((d * Math.PI) / 180);
    str[i] = Math.max(s1, 0.35);
  }
  return { start: spec.t0 - lead, lnr, str, i0: lead, i1: lead + traced, base: spec.from ? 0.5 : 0 };
}

let armsCache: Arm[] | null = null;
const arms = () => (armsCache ??= ARM_TABLE.map(buildArm));

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

const SEED = 7;
const BAR_ANGLE = 1.05;

/** The picture, RGBA (opaque, black where there is nothing). */
export function renderGalaxyClouds(frame: CloudFrame): Uint8ClampedArray {
  const { width, height, coreX, coreY, lyPerPx } = frame;
  const out = new Uint8ClampedArray(width * height * 4);
  const list = arms();
  const cb = Math.cos(BAR_ANGLE);
  const sb = Math.sin(BAR_ANGLE);
  for (let py = 0; py < height; py++) {
    // Image y grows downwards; galaxy z grows "up" (towards the core from Sol, and beyond).
    const dz = -(py - coreY) * lyPerPx;
    for (let px = 0; px < width; px++) {
      const dx = (px - coreX) * lyPerPx;
      const r = Math.hypot(dx, dz);
      const i = (py * width + px) * 4;
      out[i + 3] = 255;
      if (r > 64_000) continue;
      let th = (Math.atan2(dz, dx) * 180) / Math.PI;
      if (th < 0) th += 360;
      const lr = Math.log(Math.max(r, 300));

      const nx = dx / 3_800;
      const nz = dz / 3_800;
      const clouds = fbm(nx, nz, SEED, 5);
      const puff = Math.pow(clouds, 2.0) * 2.3;
      const jitter = fbm(dx / 2_300, dz / 2_300, SEED + 5, 3) - 0.5;
      const fine = fbm(nx * 2.6, nz * 2.6, SEED + 17, 3);
      const knots = Math.pow(Math.max(0, fine - 0.62) * 2.8, 2.5);
      const stars = Math.pow(Math.max(0, fbm(nx * 22, nz * 22, SEED + 41, 2) - 0.72) * 3.4, 4);

      // The arms: for each one, every winding that passes this angle.
      let arm = 0;
      let lane = 0;
      let mask = 0;
      let tail = 0;
      for (const a of list) {
        for (let k = -1; k <= 2; k++) {
          const idx = th + 360 * k - a.start;
          if (idx < 0 || idx >= a.lnr.length - 1) continue;
          const j = Math.floor(idx);
          const f = idx - j;
          const al = a.lnr[j]! * (1 - f) + a.lnr[j + 1]! * f;
          const s = a.str[j]! * (1 - f) + a.str[j + 1]! * f;
          // Past the traced end the arm thins out: wider, broken, darker.
          const past = idx > a.i1 ? (idx - a.i1) / TAIL_DEG : 0;
          const env = idx < a.i0 ? a.base + (1 - a.base) * (idx / a.i0) ** 2 : (1 - past) ** 1.5;
          const ra = Math.exp(al);
          const w = (650 + 0.05 * ra) * (1 + 0.6 * past);
          const d = (lr - al) * ra + jitter * w * (1.6 + 2 * past);
          if (Math.abs(d) > 6 * w) continue;
          const prof = Math.exp(-((d / w) ** 2));
          const strength = (0.2 + 0.8 * s) * env;
          arm += strength * prof * (1 - 0.55 * past);
          tail = Math.max(tail, past * prof);
          lane += strength * Math.exp(-(((d + 1.2 * w) / (0.7 * w)) ** 2));
          mask = Math.max(mask, Math.exp(-((d / (2.4 * w)) ** 2)) * Math.min(1, 0.35 + s) * env);
        }
      }

      const disc = Math.exp(-r / 14_000) * (1 - smooth(46_000, 62_000, r));
      // The inner disc is drawn out along the bar.
      const ub = (dx * Math.cos(BAR_ANGLE) + dz * Math.sin(BAR_ANGLE)) / 1.45;
      const vb = -dx * Math.sin(BAR_ANGLE) + dz * Math.cos(BAR_ANGLE);
      const inner = Math.exp(-((Math.hypot(ub, vb) / 13_500) ** 1.8));
      const bulge = Math.exp(-((r / 2_800) ** 2));
      const u = dx * cb + dz * sb;
      const v = -dx * sb + dz * cb;
      const bar = Math.exp(-((u / 8_000) ** 2 + (v / 3_000) ** 2));
      // Between the arms the disc goes dark, more so further out.
      const gap = 1 - smooth(12_000, 30_000, r) * 0.6 * (1 - mask);
      const outerFade = 1 - smooth(40_000, 58_000, r);
      const armLight = arm * (0.35 + puff * (1 - 0.6 * tail)) * (0.4 + 0.6 * Math.exp(-r / 22_000)) * (0.3 + 0.7 * outerFade) * (1 - 0.45 * smooth(28_000, 44_000, r)) * (1 + 0.8 * Math.exp(-(((r - 20_000) / 8_000) ** 2)));
      // Dust is heaviest in the inner disc, where the arms leave the bar.
      const laneGain = 0.5 + 0.6 * (smooth(6_000, 10_000, r) - smooth(18_000, 28_000, r));
      const dust = 1 - Math.min(0.7, laneGain * 0.85 * lane * (0.4 + clouds)) * (1 - smooth(30_000, 45_000, r));
      const blue = smooth(24_000, 42_000, r);

      // Light between the arms too: the old stars of the disc, dimmer where the arms are far.
      const diffuse =
        (1.1 * Math.exp(-r / 12_500) + 0.17 * (smooth(18_000, 26_000, r) - smooth(34_000, 46_000, r))) *
        (1 - smooth(38_000, 56_000, r)) *
        (0.45 + 0.55 * clouds) *
        (0.5 + 0.5 * mask);
      const glow = 0.7 * bulge + 1.6 * bar + 1.25 * inner * (0.5 + 0.8 * puff);
      // The outer disc's own light is bluer: young stars.
      const haze = diffuse + 0.16 * disc * (0.3 + clouds) * gap;
      const a2 = armLight * 1.05;
      let rr = glow * 1.0 + haze * (1.0 - 0.25 * blue) + a2 * (1.0 - 0.3 * blue);
      let gg = glow * 0.86 + haze * (0.86 - 0.02 * blue) + a2 * (0.88 - 0.04 * blue);
      let bb = glow * 0.73 + haze * (0.73 + 0.32 * blue) + a2 * (0.8 + 0.34 * blue);
      const pink = knots * Math.min(1.5, arm) * (1 - tail) * smooth(10_000, 16_000, r) * (1 - smooth(32_000, 40_000, r)) * 1.8;
      const st = stars * (0.2 + mask) * (0.35 + Math.exp(-r / 14_000)) * (1 - smooth(42_000, 56_000, r)) * 1.8;
      // Young clusters strung along the outer arms: white-blue clumps.
      const clusters = Math.pow(Math.max(0, fine - 0.58) * 3, 3) * Math.min(1.2, arm) * (1 - tail) * smooth(22_000, 30_000, r) * outerFade * 1.4;
      rr += pink + st * 0.8 + clusters * 0.85;
      gg += 0.6 * pink + st * 0.8 + clusters * 0.9;
      bb += 0.75 * pink + st * 0.9 + clusters * 1.1;
      // Dust reddens what it dims: brown lanes, not grey.
      rr *= dust;
      gg *= dust ** 1.35;
      bb *= dust ** 1.8;
      out[i] = 255 * (1 - Math.exp(-rr * 1.6));
      out[i + 1] = 255 * (1 - Math.exp(-gg * 1.6));
      out[i + 2] = 255 * (1 - Math.exp(-bb * 1.6));
    }
  }
  return out;
}
