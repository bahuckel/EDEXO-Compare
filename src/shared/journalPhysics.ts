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
