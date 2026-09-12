/**
 * The temperature range a landable body actually spans, which the journal never states.
 *
 * ## Why it is needed
 *
 * `Scan` carries one `SurfaceTemperature` for a whole planet. The game's own body panel shows a
 * range — `SURFACE TEMP: 271K-529K` — and that range appears **only for landable bodies**, because
 * it describes conditions you could stand in. Nothing in any journal event carries it: the commander
 * checked every event his journals hold for that body and the number is in none of them.
 *
 * It matters because the single figure is not the middle of the range and is wrong everywhere a
 * plant actually grows. On Smoje MF-C c14-0 A 2 the catalogued value is 406.7 K, the suit reads
 * 529 K at the sub-stellar point, and the true span is 271–529 K.
 *
 * ## How the constants were found
 *
 * Measured against sixteen ranges read off the game's own panel across two systems, two stars and
 * four planet classes. Every one is reproduced to within 0.7 K.
 *
 *   max = √2 · Teq · K · G        min = max / 1.9548
 *
 * - `√2` is the sub-stellar point: a surface re-radiating the full flux it receives sits at
 *   `2^(1/4)` above the evenly-redistributed equilibrium, and `Teq` here is the even case.
 * - `1.9548` is the day-to-night span. It held at 1.9477–1.9643 over all sixteen bodies, and did
 *   **not** move with tidal locking, eccentricity, axial tilt, rotation period, mass or radius —
 *   every one of those was tested and none of them feed it.
 * - `K` is reflectivity, and it turns on the **planet class, not the composition**. A 100 % metal
 *   body, an 86 % rock body and a 67/33 rock-metal body all give K = 0.8976, 0.8969, 0.8978. Only
 *   icy bodies differ. A composition-weighted albedo was tried first and looked right purely because
 *   every body in the first system shared one composition.
 * - `G` is greenhouse, and it scales with **pressure**, not just gas. One value per gas put carbon
 *   dioxide 17 % out on a thin body while fitting a thick one.
 *
 * ## What it will not do
 *
 * Ammonia, water, methane, argon, neon and nitrogen atmospheres are uncalibrated, and carbon dioxide
 * is only measured between 317 and 4,387 Pa. Those return null. A number guessed from an
 * uncalibrated gas would look exactly like a measured one, and the whole value of this is that the
 * reader can trust it.
 */
import type { ExplorationScanRecord } from "../shared/types.js";

/** Metres in an astronomical unit, and in a solar radius — journal `Radius` is metres. */
const AU_M = 149_597_870_700;
const SOLAR_RADIUS_M = 695_700_000;
const SOLAR_RADIUS_AU = SOLAR_RADIUS_M / AU_M;
/** Journal `DistanceFromArrivalLs` → AU. */
const LS_PER_AU = 499.005;

/** Reflectivity, by planet class. Composition plays no part — see the header. */
export const REFLECTIVITY_ICY = 0.7982;
export const REFLECTIVITY_SOLID = 0.8975;
/** Hottest point over coldest, measured at 1.9477–1.9643 across sixteen bodies. */
export const DAY_NIGHT_SPAN = 1.9548;

export interface SurfaceTemperatureRange {
  minK: number;
  maxK: number;
}

/**
 * Greenhouse multiplier, or null when this atmosphere has never been measured.
 *
 * The carbon dioxide exponent came out at 0.4000 from two independent pressures, which is round
 * enough to look like the game's own number rather than a curve bent through two points.
 */
function greenhouseFactor(atmosphereType: string | undefined, pressurePa: number): number | null {
  const atm = (atmosphereType ?? "").trim().toLowerCase();
  if (atm === "" || atm === "none") return 1;
  if (atm === "sulphurdioxide") return 1.0043;
  if (atm === "carbondioxide") return 1 + 0.008622 * Math.pow(Math.max(pressurePa, 0), 0.4);
  return null;
}

function parentIdsOfKind(parents: unknown, kind: "Star" | "Planet"): number[] {
  if (!Array.isArray(parents)) return [];
  const out: number[] = [];
  for (const p of parents) {
    if (!p || typeof p !== "object") continue;
    const v = (p as Record<string, unknown>)[kind];
    if (typeof v === "number") out.push(v);
  }
  return out;
}

/**
 * The star that heats a body, and the orbital radius it is heated across.
 *
 * Walking `Parents[0]` body to body is the accurate route, because a body orbiting a barycentre then
 * contributes the semi-major axis of whatever actually circles the star. That walk falls off the
 * chain at a sub-barycentre the game never scanned, so the `Parents` array — which lists the whole
 * hierarchy — is the fallback, and the arrival distance is the last resort.
 */
function heatingOrbit(
  rec: ExplorationScanRecord,
  byBodyId: Map<number, ExplorationScanRecord>,
  arrivalStar: ExplorationScanRecord | null,
): { star: ExplorationScanRecord; au: number } | null {
  let cur: ExplorationScanRecord | null = rec;
  const seen = new Set<number>();
  for (let d = 0; d < 24 && cur; d++) {
    const first = Array.isArray(cur.parents) ? (cur.parents[0] as Record<string, unknown>) : null;
    if (!first) break;
    if (typeof first.Star === "number") {
      const star = byBodyId.get(first.Star);
      const au = (cur.semiMajorAxis ?? 0) / AU_M;
      if (star && au > 0) return { star, au };
      break;
    }
    const nextId = typeof first.Planet === "number" ? first.Planet : (first.Null as number | undefined);
    if (typeof nextId !== "number" || seen.has(nextId)) break;
    seen.add(nextId);
    cur = byBodyId.get(nextId) ?? null;
  }
  const planetId = parentIdsOfKind(rec.parents, "Planet")[0];
  const starId = parentIdsOfKind(rec.parents, "Star")[0];
  if (planetId != null && starId != null) {
    const orbiter = byBodyId.get(planetId);
    const star = byBodyId.get(starId);
    const au = (orbiter?.semiMajorAxis ?? 0) / AU_M;
    if (orbiter && star && au > 0) return { star, au };
  }
  if (arrivalStar && (rec.distanceFromArrivalLs ?? 0) > 0) {
    return { star: arrivalStar, au: (rec.distanceFromArrivalLs ?? 0) / LS_PER_AU };
  }
  return null;
}

/**
 * The range the game would show for this body, or null when it cannot be said honestly.
 *
 * Null for a body that is not landable (the game shows no range for one either), for an
 * uncalibrated atmosphere, and whenever the star or the orbit is unknown.
 */
export function estimateSurfaceTemperatureRange(
  rec: ExplorationScanRecord,
  byBodyId: Map<number, ExplorationScanRecord>,
  arrivalStar: ExplorationScanRecord | null = null,
): SurfaceTemperatureRange | null {
  if (!rec.landable) return null;
  const orbit = heatingOrbit(rec, byBodyId, arrivalStar);
  if (!orbit) return null;
  const starTempK = orbit.star.surfaceTemperature;
  const starRadiusM = orbit.star.radius;
  if (!(starTempK != null && starTempK > 0) || !(starRadiusM != null && starRadiusM > 0)) return null;
  const greenhouse = greenhouseFactor(rec.atmosphereType, rec.surfacePressure ?? 0);
  if (greenhouse == null) return null;

  const starRadiusAu = (starRadiusM / SOLAR_RADIUS_M) * SOLAR_RADIUS_AU;
  const equilibriumK = starTempK * Math.sqrt(starRadiusAu / (2 * orbit.au));
  if (!Number.isFinite(equilibriumK) || equilibriumK <= 0) return null;

  const reflectivity = /icy|ice/i.test(rec.planetClass ?? "") ? REFLECTIVITY_ICY : REFLECTIVITY_SOLID;
  const maxK = Math.SQRT2 * equilibriumK * reflectivity * greenhouse;
  if (!Number.isFinite(maxK) || maxK <= 0) return null;
  return { minK: maxK / DAY_NIGHT_SPAN, maxK };
}
