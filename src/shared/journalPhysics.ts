/** Standard gravity (m/s²) used by Elite for journal → Earth-g conversion. */
export const EARTH_G_MS2 = 9.80665;

/** Distance light travels in one second (m); journal `SemiMajorAxis` is in metres → divide by this for LS. */
export const LIGHT_SECOND_METERS = 299_792_458;

/** The astronomical unit (IAU 2012), and the Sun's radius (IAU 2015 nominal) — the journal's metres. */
export const AU_METERS = 149_597_870_700;
export const SOLAR_RADIUS_METERS = 695_700_000;
/**
 * Light-seconds in an AU, exactly (499.00478…). Two files carried their own — 499.004784 and 499.005 —
 * and one light-second in 2,000 is enough to move an edge (code review B18, 2026-09-27).
 */
export const LS_PER_AU = AU_METERS / LIGHT_SECOND_METERS;

/**
 * For sources whose pressure unit is unknown (a spreadsheet column): at or above this it is read as
 * pascals, below it as atmospheres. Never for `SurfacePressure` — see {@link journalPressureToAtm}.
 */
export const MIXED_PRESSURE_PA_THRESHOLD = 40;

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

/**
 * `SurfacePressure` in pascals → atmospheres.
 *
 * Inside the app `SurfacePressure` is always pascals, the journal's unit: EDSM and Spansh (which
 * send atmospheres) are converted on the way in. It used to guess — under 40 read as atmospheres —
 * and an airless moon with a trace 17.875 Pa showed as 17.875 atm (owner, Tegnae IJ-A b58-0 ABC 2 a,
 * 2026-09-27), and was matched against species as a 17-atmosphere world.
 */
export function journalPressureToAtm(pa: number): number {
  if (!Number.isFinite(pa)) return pa;
  return pa / ATM_TO_PA;
}

/** A pressure of unknown unit (see {@link MIXED_PRESSURE_PA_THRESHOLD}) → atmospheres. */
export function mixedPressureToAtm(raw: number): number {
  if (!Number.isFinite(raw)) return raw;
  return raw >= MIXED_PRESSURE_PA_THRESHOLD ? raw / ATM_TO_PA : raw;
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
  if (
    !Number.isFinite(localGravityG) ||
    !Number.isFinite(bodySurfaceGravityMs2) ||
    !Number.isFinite(bodyRadiusM)
  ) {
    return null;
  }
  if (!(localGravityG > 0) || !(bodySurfaceGravityMs2 > 0) || !(bodyRadiusM > 0)) return null;
  const referenceG = journalSurfaceGravityToG(bodySurfaceGravityMs2);
  if (!(referenceG > 0)) return null;
  return bodyRadiusM * Math.sqrt(referenceG / localGravityG) - bodyRadiusM;
}
