/**
 * How far the sample radar draws, in metres.
 *
 * 500 m was the owner's number and a good one: the widest genus separation in the game is 500 m, so
 * a radar of that radius always contains the ring being cleared, and anything further out becomes a
 * rim arrow with its distance beside it rather than a dot pretending to be close.
 *
 * It stopped being the only sensible number when he raised Elite's `LODDistanceScale` to 6 and
 * plants started rendering out to about a kilometre. The scanner already reached 750 m. A radar
 * fixed at 500 m is then narrower than both the tool and the eye — a plant he can see, and could
 * scan, sits outside the circle.
 *
 * Widening it does not lose the genus ring, it only draws it smaller. That is a trade worth having
 * a control for rather than a constant.
 */

export const RADAR_RADIUS_DEFAULT_M = 500;
/** Below the 500 m genus separation the ring stops fitting, but a close-in view is still legible. */
export const RADAR_RADIUS_MIN_M = 250;
/** Past this the marks crowd the middle and the radar stops answering "where do I walk". */
export const RADAR_RADIUS_MAX_M = 2000;

/**
 * Clamp and round.
 *
 * Narrow coercion for the same reason as the poll rates: `Number(null)`, `Number([])` and
 * `Number("")` are all 0, so a bare `Number(raw)` would turn a missing field into the minimum.
 */
export function clampRadarRadiusM(raw: unknown): number {
  let n: number;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string" && raw.trim() !== "") n = Number(raw);
  else return RADAR_RADIUS_DEFAULT_M;
  if (!Number.isFinite(n)) return RADAR_RADIUS_DEFAULT_M;
  return Math.min(RADAR_RADIUS_MAX_M, Math.max(RADAR_RADIUS_MIN_M, Math.round(n)));
}

/** What `/api/status` carries so the launcher's input cannot offer a value the server would clamp. */
export type RadarRadiusDTO = {
  radiusM: number;
  minM: number;
  maxM: number;
  defaultM: number;
};

export function radarRadiusDto(radiusM: number): RadarRadiusDTO {
  return {
    radiusM,
    minM: RADAR_RADIUS_MIN_M,
    maxM: RADAR_RADIUS_MAX_M,
    defaultM: RADAR_RADIUS_DEFAULT_M,
  };
}
