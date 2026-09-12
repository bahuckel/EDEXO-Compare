/** Standard gravity (m/s²) used by Elite for journal → Earth-g conversion. */
export const EARTH_G_MS2 = 9.80665;

/** Distance light travels in one second (m); journal `SemiMajorAxis` is in metres → divide by this for LS. */
export const LIGHT_SECOND_METERS = 299_792_458;

/** Journal `SurfacePressure`: values above this are treated as pascals; at or below as atmospheres (client + matcher). */
export const JOURNAL_PRESSURE_PA_THRESHOLD = 40;

export const ATM_TO_PA = 101_325;

/** Speculative “thin atmosphere” cutoff for exobiology matching (atm after {@link journalPressureToAtm}); tunable in data. */
export const THIN_ATMOSPHERE_MAX_ATM = 0.1;

/**
 * Journal `Scan` / `PlanetScan` field `SurfaceGravity` is in **m/s²**, not Earth g.
 * Species criteria `surfaceGravity` / `max_gravity` in your JSON are in **Earth g** (e.g. 0.27).
 */
export function journalSurfaceGravityToG(mPerS2: number): number {
  return mPerS2 / EARTH_G_MS2;
}

/** Normalise journal `SurfacePressure` to atmospheres (large values Pa → atm). */
export function journalPressureToAtm(raw: number): number {
  if (!Number.isFinite(raw)) return raw;
  if (raw >= JOURNAL_PRESSURE_PA_THRESHOLD) return raw / ATM_TO_PA;
  return raw;
}

/**
 * Elevation above the body's reference radius, read out of the gravity at the commander's feet.
 *
 * `Status.json` reports `Gravity` in Earth g wherever they are standing, and surface gravity falls
 * as 1/r², so the reading doubles as an altimeter: r = rRef × √(gRef / gLocal). That matters because
 * `Altitude` is **absent while on foot** — this is the only elevation the game offers at the moment
 * of a `ScanOrganic`, and nothing recovers it afterwards.
 *
 * Resolution is better than it sounds. One unit in the last printed digit of `Gravity` is about
 * three metres on a 3,300 km body, which is far finer than any terrain feature.
 *
 * Null when the body's own figures are missing or either gravity is not positive — an elevation
 * invented from absent data would be indistinguishable from a real one in the record.
 */
export function elevationFromGravity(
  localGravityG: number | null | undefined,
  bodySurfaceGravityMs2: number | null | undefined,
  bodyRadiusM: number | null | undefined,
): number | null {
  if (localGravityG == null || bodySurfaceGravityMs2 == null || bodyRadiusM == null) return null;
  if (!Number.isFinite(localGravityG) || !Number.isFinite(bodySurfaceGravityMs2) || !Number.isFinite(bodyRadiusM)) {
    return null;
  }
  if (!(localGravityG > 0) || !(bodySurfaceGravityMs2 > 0) || !(bodyRadiusM > 0)) return null;
  const referenceG = journalSurfaceGravityToG(bodySurfaceGravityMs2);
  if (!(referenceG > 0)) return null;
  return bodyRadiusM * Math.sqrt(referenceG / localGravityG) - bodyRadiusM;
}
