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
 * Every step here goes through `Math.fround`, and it reproduces his tables of always-green
 * temperatures value by value (tests/gggLadder.test.ts).
 *
 * Two strengths of answer:
 * - `ceiling`: the ladder reaches its ceiling, so the density does not matter beyond reaching it —
 *   the rungs depend on the temperature alone, and the float match is exact.
 * - `density`: the top is T + depth, so the rungs depend on the density too; the game's exact float
 *   path for the power functions is not known, so a rung within a few float steps of a door counts,
 *   and the answer is "likely", not certain.
 *
 * Doors are known for class I and ammonia-based life (115, 250, 270 K), water-based life (210, 270 K),
 * class III (370, 700, 900 K) and class IV (900, 1400 K). Class II and the cold class III range get a
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

/** How far up the clouds reach, in K (the "depth" of the ladder). */
export function ladderDepth(tempK: number, density: number): number {
  return f(
    f(f(f(5) / f(9)) * f(1300)) *
      f(f(Math.pow(f(f(tempK) / f(1300)), f(1.2))) * f(Math.pow(f(density), f(0.2)))),
  );
}

export interface LadderVerdict {
  /** The rung on a door (1 = the surface) and the door's temperature. */
  rung: number;
  door: number;
  /** `ceiling`: temperature alone decides (certain); `density`: the density's float path matters (likely). */
  basis: "ceiling" | "density";
}

/** Float steps of the door's magnitude a density-decided rung may miss by and still count. */
const DENSITY_TOLERANCE_ULP = 3;

function ulp(x: number): number {
  // 32-bit float spacing at x: 2^(exponent − 23).
  return 2 ** (Math.floor(Math.log2(Math.abs(x))) - 23);
}

/**
 * The ladder's verdict for one gas giant, or null when no rung lands on a door (or the class has no
 * known doors, or the inputs are missing).
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
  let step = f(f(top - t) / f(7));
  if (cls === "III") step = Math.min(f(100), Math.max(f(30), step));
  for (let i = 0; i < 7; i++) {
    const rung = f(t + f(step * f(i)));
    for (const door of GGG_DOORS[cls]) {
      const exact = rung === f(door);
      const near = Math.abs(rung - door) <= DENSITY_TOLERANCE_ULP * ulp(door);
      if (atCeiling ? !exact : !(i === 0 ? exact : near)) continue;
      const certain = i === 0 || (atCeiling && reach != null);
      return { rung: i + 1, door, basis: certain ? "ceiling" : "density" };
    }
  }
  return null;
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
    let step = f(f(ceiling - t) / f(7));
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
