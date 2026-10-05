/**
 * Green gas giants by the cloud ladder — CMDR Arcanic's "The Mystery Property: Revealed" (2026), from
 * CMDR Regza's finding that bulk density is the property the green ones share (owner, 2026-10-05).
 *
 * Every gas giant gets seven cloud layers ("rungs"), evenly spaced in temperature from its surface
 * temperature up to a top that its density decides, capped by a ceiling. Each class colours its
 * clouds by temperature zone; a rung that lands exactly on a zone border ("door") is given no colour —
 * the game tests `>` where `>=` was meant — and stays the default green.
 *
 *   density = MassEM × 5.97219e24 / (4/3 · π · r³)            kg/m³, r in metres
 *   depth   = (5/9 · 1300) · (T / 1300)^1.2 · density^0.2      K
 *   top     = min(T + depth, ceiling(T))
 *   step    = (top − T) / 7          (class III: held between 30 and 100 K)
 *   rung i  = T + i · step,  i = 0 … 6
 *
 * "Exactly" is exact in 32-bit floats, as the game computes and stores them: that is why a green
 * temperature is one float value or a handful of neighbours (130.000015, 217.4999847 … 217.5000153).
 * Every value here is rounded with `Math.fround`; the depth's powers and the step's division are done
 * in 64-bit before rounding. That reproduces his tables of always-green temperatures value by value
 * and puts 15 of the 18 catalogued density-decided greens it can judge exactly on a door, the other
 * three within two float steps (tests/gggLadder.test.ts); doing those two in 32-bit misses more.
 *
 * Two strengths of answer:
 * - `ceiling`: the ladder reaches its ceiling, so the density does not matter beyond reaching it —
 *   the rungs depend on the temperature alone, and the float match is exact.
 * - `density`: the top is T + depth, so the rungs depend on the density too; the game's exact float
 *   path for the power functions is not known, so a rung within a few float steps of a door counts,
 *   and the answer is "likely", not certain.
 *
 * Doors are known for class I and ammonia-based life (115, 250, 270 K), water-based life (210, 270 K),
 * class III (370, 700, 900 K) and class IV (900, 1400 K). Class II, cold class III (below 415 K) and
 * cold class I / ammonia-based life (80–113 K: the ten catalogued greens there, 83.9–109.9 K, miss
 * every door, while the six at 113.8–122.3 K and one at 77.5 K land on one; checked 2026-10-05) get a
 * "nudge" of their temperature before the ladder is built that nobody can predict yet; helium-rich and
 * class V giants are unconfirmed. Those get no answer.
 */

const f = Math.fround;

/** Earth's mass in kg, as in the formula. */
const EARTH_KG = 5.97219e24;

/** Ceiling of the ladder by surface temperature band. */
const CEILINGS: readonly [number, number][] = [
  [75, 100],
  [330, 340],
  [680, 700],
  [900, 1200],
  [1400, 1500],
  [Infinity, 5000],
];

export type LadderClass = "I" | "ammonia" | "water" | "III" | "IV";

/** Zone borders ("doors") per class, in K. */
export const GGG_DOORS: Readonly<Record<LadderClass, readonly number[]>> = {
  I: [115, 250, 270],
  ammonia: [115, 250, 270],
  water: [210, 270],
  III: [370, 700, 900],
  IV: [900, 1400],
};

/** The journal's PlanetClass → the ladder's class; null for a class without known doors. */
export function ladderClassOf(planetClass: string | null | undefined): LadderClass | null {
  switch ((planetClass ?? "").trim()) {
    case "Sudarsky class I gas giant":
      return "I";
    case "Gas giant with ammonia based life":
      return "ammonia";
    case "Gas giant with water based life":
    case "Water giant":
      return "water";
    case "Sudarsky class III gas giant":
      return "III";
    case "Sudarsky class IV gas giant":
      return "IV";
    default:
      return null;
  }
}

function ceilingOf(t: number): number {
  for (const [below, c] of CEILINGS) if (t < below) return c;
  return 5000;
}

/** Bulk density in kg/m³ from the journal's MassEM and Radius (metres). */
export function gasGiantDensity(massEM: number, radiusM: number): number {
  return (massEM * EARTH_KG) / ((4 / 3) * Math.PI * radiusM ** 3);
}

/**
 * How far up the clouds reach, in K (the "depth" of the ladder), rounded to a 32-bit float.
 * The powers are taken in 64-bit: with that path 15 of the 18 catalogued density-decided greens out of
 * the nudge ranges land exactly on a door, the rest within two float steps; all-32-bit misses more.
 */
export function ladderDepth(tempK: number, density: number): number {
  return f((5 / 9) * 1300 * (f(tempK) / 1300) ** 1.2 * density ** 0.2);
}

export interface LadderVerdict {
  /** The rung on a door (1 = the surface) and the door's temperature. */
  rung: number;
  door: number;
  /** `ceiling`: temperature alone decides (certain); `density`: the density's float path matters (likely). */
  basis: "ceiling" | "density";
  /** How far the rung is from the door, in float steps at the door: 0 is exact. */
  offUlp: number;
}

/** Float steps of the door's magnitude a density-decided rung may miss by and still count. */
const DENSITY_TOLERANCE_ULP = 3;

function ulp(x: number): number {
  // 32-bit float spacing at x: 2^(exponent − 23).
  return 2 ** (Math.floor(Math.log2(Math.abs(x))) - 23);
}

/** The temperature ranges where the shown temperature is not the ladder's (see the header). */
export function inNudgeRange(cls: LadderClass, tempK: number): boolean {
  if (cls === "I" || cls === "ammonia") return tempK >= 80 && tempK < 113;
  return cls === "III" && tempK < 415;
}

/**
 * The ladder's verdict for one gas giant, or null when no rung lands on a door (or the class has no
 * known doors, the temperature is in a nudge range, or the inputs are missing).
 */
export function ladderGreen(opts: {
  planetClass: string | null | undefined;
  tempK: number | null | undefined;
  massEM: number | null | undefined;
  radiusM: number | null | undefined;
}): LadderVerdict | null {
  const cls = ladderClassOf(opts.planetClass);
  const T = opts.tempK;
  if (!cls || T == null || !Number.isFinite(T) || T <= 0 || inNudgeRange(cls, T)) return null;
  const t = f(T);
  const ceiling = f(ceilingOf(t));
  const density =
    opts.massEM != null && opts.radiusM != null && opts.massEM > 0 && opts.radiusM > 0
      ? gasGiantDensity(opts.massEM, opts.radiusM)
      : null;
  const reach = density != null ? f(t + ladderDepth(t, density)) : null;
  // Without a mass and radius the ceiling is assumed reached: the rungs are then the temperature's,
  // but whether the ladder really gets there is not known, so only the surface rung is certain.
  const atCeiling = reach == null || reach >= ceiling;
  const top = atCeiling ? ceiling : reach!;
  let step = f((top - t) / 7);
  if (cls === "III") step = Math.min(f(100), Math.max(f(30), step));
  let best: LadderVerdict | null = null;
  for (let i = 0; i < 7; i++) {
    const rung = f(t + f(step * f(i)));
    for (const door of GGG_DOORS[cls]) {
      const offUlp = Math.abs(rung - door) / ulp(door);
      const exact = offUlp === 0;
      if (atCeiling || i === 0 ? !exact : offUlp > DENSITY_TOLERANCE_ULP) continue;
      if (best && best.offUlp <= offUlp) continue;
      const certain = i === 0 || (atCeiling && reach != null);
      best = { rung: i + 1, door, basis: certain ? "ceiling" : "density", offUlp };
    }
  }
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
  for (; bits <= end; bits++) {
    buf.setInt32(0, bits);
    const t = buf.getFloat32(0);
    const ceiling = f(ceilingOf(t));
    let step = f((ceiling - t) / 7);
    if (cls === "III") step = Math.min(f(100), Math.max(f(30), step));
    let hit = false;
    for (let i = 0; i < 7 && !hit; i++) {
      const rung = f(t + f(step * f(i)));
      hit = GGG_DOORS[cls].some((d) => rung === f(d));
    }
    if (hit) out.push(t);
  }
  return out;
}
