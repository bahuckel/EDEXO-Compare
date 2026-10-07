/**
 * Green gas giants by the cloud ladder — CMDR Arcanic's "The Mystery Property: Revealed" (2026), from
 * CMDR Regza's finding that bulk density is the property the green ones share (owner, 2026-10-05).
 * Aligned to his own code on https://ed-ggg.github.io/edggg/densitydemo.html (owner, 2026-10-07: "align
 * it to his code"): the float path, the step limits, the cracks and the nudge ranges are his.
 *
 * Every gas giant gets seven cloud layers ("rungs"), evenly spaced in temperature from its surface
 * temperature up to a top that its density decides, capped by a ceiling. Each class colours its
 * clouds by temperature band; a rung that lands exactly on a band border ("crack", "door") is given
 * no colour and stays the default green.
 *
 *   density = MassEM × 5.97219e24 / (4/3 · π · r³)                      kg/m³, r in metres
 *   reach   = (density/1300 · T)^1.2 · (1/180) · (130000/density)        = 722.2 · (T/1300)^1.2 · density^0.2
 *   top     = min(T + reach, ceiling(T))
 *   step    = (top − T) · (1/7), held to the class's limits (class II–V)
 *   rung k  = f32(step · k + T),  k = 0 … 6
 *
 * Everything is 64-bit until the rung, which is rounded to a 32-bit float once, as he does. That puts
 * all 37 catalogued GGGs that cannot be nudged exactly on a crack (with their Spansh values), and
 * reproduces his always-green tables value by value (176.666626 K is not green: it misses by a step).
 *
 * Some giants get a random nudge of their temperature before the ladder is built (his ranges in
 * `nudgeOf`): below a class's lower bound nothing can be said; between it and the upper bound a
 * crack hit still holds if the nudge left the planet alone ("maybe").
 */

const f = Math.fround;

/** Earth's mass in kg, as in the formula. */
const EARTH_KG = 5.97219e24;

/** Ceiling of the ladder: from this surface temperature up, this ceiling. */
const CEILINGS: readonly [number, number][] = [
  [0, 100],
  [75, 340],
  [330, 700],
  [680, 1200],
  [900, 1500],
  [1400, 5000],
];

export type LadderClass =
  "I" | "II" | "III" | "IV" | "V" | "ammonia" | "water" | "waterGiant" | "heliumRich" | "helium";

/** Band borders ("cracks", "doors"), in K: class I and ammonia-based life, and all other gas and water giants. */
const CRACKS_COLD: readonly number[] = [115, 250, 270, 370, 700, 900, 1400];
const CRACKS: readonly number[] = [114, 210, 270, 370, 700, 900, 1400];

export function cracksOf(cls: LadderClass): readonly number[] {
  return cls === "I" || cls === "ammonia" ? CRACKS_COLD : CRACKS;
}

/** Smallest and largest step between rungs, in K. */
const STEP_LIMITS: Partial<Record<LadderClass, readonly [number, number]>> = {
  II: [5, 20],
  III: [30, 100],
  IV: [50, 100],
  V: [250, 1000],
};

/** Nudge ranges of class II–V: up to the first value always nudged, below the second maybe. */
const NUDGE: Partial<Record<LadderClass, readonly [number, number]>> = {
  II: [250, 280],
  III: [365, 415],
  IV: [500, 700],
  V: [1000, 1500],
};

/** The journal's PlanetClass → the ladder's class; null for a body that is not a gas or water giant. */
export function ladderClassOf(planetClass: string | null | undefined): LadderClass | null {
  switch ((planetClass ?? "").trim()) {
    case "Sudarsky class I gas giant":
      return "I";
    case "Sudarsky class II gas giant":
      return "II";
    case "Sudarsky class III gas giant":
      return "III";
    case "Sudarsky class IV gas giant":
      return "IV";
    case "Sudarsky class V gas giant":
      return "V";
    case "Gas giant with ammonia based life":
      return "ammonia";
    case "Gas giant with water based life":
      return "water";
    case "Water giant":
      return "waterGiant";
    case "Helium rich gas giant":
      return "heliumRich";
    case "Helium gas giant":
      return "helium";
    default:
      return null;
  }
}

function ceilingOf(t: number): number {
  let c = 10000;
  for (const [from, ceiling] of CEILINGS) {
    if (t >= from) c = ceiling;
    else break;
  }
  return c;
}

/** Bulk density in kg/m³ from the journal's MassEM and Radius (metres). */
export function gasGiantDensity(massEM: number, radiusM: number): number {
  return (massEM * EARTH_KG) / ((4 / 3) * Math.PI * radiusM ** 3);
}

/** How far up the clouds reach above the surface, in K (the "depth"), as his code computes it. */
export function ladderDepth(tempK: number, density: number): number {
  return Math.pow((density / 1300) * f(tempK), 1.2) * (1 / 180) * (130000 / density);
}

/**
 * Whether the shown temperature can be nudged: `always` (nothing can be said), `maybe` (a crack hit
 * holds if the nudge left it alone) or `none`. His `nudgeOf`.
 */
export function nudgeOf(cls: LadderClass, tempK: number): "none" | "maybe" | "always" {
  const t = f(tempK);
  const n = NUDGE[cls];
  if (n) return t >= n[1] ? "none" : t > n[0] ? "maybe" : "always";
  if (t > 80 && t < 110 + 0.1 * t) return t > 100 ? "maybe" : "always";
  return "none";
}

/** True where the shown temperature may not be the ladder's (`maybe` or `always`). */
export function inNudgeRange(cls: LadderClass, tempK: number): boolean {
  return nudgeOf(cls, tempK) !== "none";
}

interface Ladder {
  rungs: number[];
  /** The rungs before their 32-bit rounding. */
  raw: number[];
  /** The density set the step: the clouds stop short of the ceiling and the step is not held to a limit. */
  densityDecided: boolean;
  /** The step was raised to the class's smallest step: then no density can change it. */
  heldAtMin: boolean;
}

/** His `ladder`; without a density the clouds are assumed to reach the ceiling. */
function buildLadder(cls: LadderClass, tempK: number, density: number | null): Ladder {
  const t = f(tempK);
  const ceil = ceilingOf(t);
  const top = density != null ? ladderDepth(t, density) + t : Infinity;
  let step = ((ceil < top ? ceil : top) - t) * (1 / 7);
  const free = step;
  const lim = STEP_LIMITS[cls];
  if (lim) step = Math.max(Math.min(step, lim[1]), lim[0]);
  const bottom = ceil < t ? ceil : t;
  const raw: number[] = [];
  for (let k = 0; k < 7; k++) raw.push(step * k + bottom);
  return {
    rungs: raw.map(f),
    raw,
    densityDecided: top < ceil && step === free,
    heldAtMin: !!lim && free < lim[0],
  };
}

export interface LadderVerdict {
  /** The rung on a crack (1 = the surface) and the crack's temperature. */
  rung: number;
  door: number;
  /** `ceiling`: temperature alone decides (certain); `density`: the density's float path matters (likely). */
  basis: "ceiling" | "density";
  /** How far the rung is from the crack, in float steps at the crack: 0 is exact. */
  offUlp: number;
  /** `maybe`: the planet can be nudged; the hit holds only if the nudge left it alone. */
  nudge: "none" | "maybe";
  /**
   * A near miss only: how far the rung stays from rounding onto the crack, in float steps at the
   * crack, at the best true mass and radius the journal's rounding allows (0: it can land on it).
   */
  reachUlp?: number;
}

/** Float steps a density-decided rung may miss by and still count ("on the edge", his 2). */
const DENSITY_TOLERANCE_ULP = 2;

/**
 * A near miss counts only when the journal's rounding of mass and radius can close it (owner,
 * 2026-10-07): the game works from exact values (gravity, g·R²/M, is one constant across 2.5 M giants
 * to 1 part in 10 million) and the journal keeps them as 32-bit floats, so the true mass and radius lie
 * within half a float step of the shown ones. A little slack for the rest of the float path: catalogued
 * Boekh AO-H b27-33 1 stays 0.035 float steps short.
 */
export const REACH_SLACK_ULP = 0.05;

/** The 32-bit float spacing around x (half of it on each side is what rounding hides). */
function spacing(x: number): number {
  const a = new Float32Array([x]);
  const u = new Uint32Array(a.buffer);
  const v = a[0]!;
  u[0]! += 1;
  return a[0]! - v;
}

/**
 * How far a density-decided rung stays from rounding onto `door`, in float steps at the door, over
 * every true mass and radius that round to the shown ones (0: some of them put it on the door). The
 * rung grows with the density, so the two ends of the density range bound it.
 */
export function roundingReach(
  cls: LadderClass,
  tempK: number,
  massEM: number,
  radiusM: number,
  rung: number,
  door: number,
): number {
  const m = f(massEM);
  const r = f(radiusM);
  const dm = spacing(m) / 2;
  const dr = spacing(r) / 2;
  const lo = buildLadder(cls, tempK, gasGiantDensity(m - dm, r + dr)).raw[rung - 1]!;
  const hi = buildLadder(cls, tempK, gasGiantDensity(m + dm, r - dr)).raw[rung - 1]!;
  // Values that round onto the door: half a float step either side (no door is a power of two).
  const onDoorFrom = door - ulp(door) / 2;
  const onDoorTo = door + ulp(door) / 2;
  if (hi >= onDoorFrom && lo <= onDoorTo) return 0;
  const gap = hi < onDoorFrom ? onDoorFrom - hi : lo - onDoorTo;
  return gap / ulp(door);
}

/** His `nextUp`: the 32-bit float spacing just above x. */
function ulp(x: number): number {
  const a = new Float32Array([x]);
  new Uint32Array(a.buffer)[0]! += 1;
  return a[0]! - x;
}

/**
 * The ladder's verdict for one gas giant, or null when no rung lands on a crack (or the planet is
 * always nudged, or the inputs are missing). Exact hits are his "green"; a density-decided rung one or
 * two float steps off is his "on the edge", kept with its `offUlp` for a lower score.
 */
export function ladderGreen(opts: {
  planetClass: string | null | undefined;
  tempK: number | null | undefined;
  massEM: number | null | undefined;
  radiusM: number | null | undefined;
}): LadderVerdict | null {
  const cls = ladderClassOf(opts.planetClass);
  const T = opts.tempK;
  if (!cls || T == null || !Number.isFinite(T) || T <= 0) return null;
  const nudge = nudgeOf(cls, T);
  if (nudge === "always") return null;
  const density =
    opts.massEM != null && opts.radiusM != null && opts.massEM > 0 && opts.radiusM > 0
      ? gasGiantDensity(opts.massEM, opts.radiusM)
      : null;
  const L = buildLadder(cls, T, density);
  let best: LadderVerdict | null = null;
  L.rungs.forEach((r, k) => {
    for (const door of cracksOf(cls)) {
      const offUlp = Math.abs(r - door) / ulp(door);
      if (offUlp !== 0 && !(k > 0 && density != null && L.densityDecided && offUlp <= DENSITY_TOLERANCE_ULP))
        continue;
      if (best && best.offUlp <= offUlp) continue;
      // Certain when no density can move the rung: the surface, a scanned density that reaches the
      // ceiling, or a step held at its smallest. Without a mass the ceiling is only assumed.
      const certain = k === 0 || L.heldAtMin || (density != null && !L.densityDecided);
      let reachUlp: number | undefined;
      if (offUlp !== 0) {
        reachUlp = roundingReach(cls, T, opts.massEM!, opts.radiusM!, k + 1, door);
        if (reachUlp > REACH_SLACK_ULP) continue;
      }
      best = {
        rung: k + 1,
        door,
        basis: certain ? "ceiling" : "density",
        offUlp,
        nudge,
        ...(reachUlp != null ? { reachUlp } : {}),
      };
    }
  });
  return best;
}

/**
 * Every float temperature in [lo, hi] a class turns green at whatever its density, once the ladder
 * reaches its ceiling — his "every always-green surface temperature" tables. For tests and research.
 */
export function alwaysGreenTemps(cls: LadderClass, lo: number, hi: number): number[] {
  const out: number[] = [];
  const buf = new DataView(new ArrayBuffer(4));
  buf.setFloat32(0, lo);
  let bits = buf.getInt32(0);
  buf.setFloat32(0, hi);
  const end = buf.getInt32(0);
  const cracks = cracksOf(cls);
  for (; bits <= end; bits++) {
    buf.setInt32(0, bits);
    const t = buf.getFloat32(0);
    if (buildLadder(cls, t, null).rungs.some((r) => cracks.includes(r))) out.push(t);
  }
  return out;
}
