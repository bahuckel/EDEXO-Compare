/**
 * A system's main star — the one you arrive at (Phase 6 dedupe: the species matcher and the
 * phenomena model each had their own copy of this rule).
 *
 * The star the game reports at zero distance from arrival — 2,860 of the 4,635 star scans in the
 * owner's logs carry that, and it is the only direct statement of which star the arrival distance is
 * measured from. When the primary was never scanned, the lowest star `BodyID`, which is the primary
 * in practice. That is a guess: callers use it to *accept* something about the main star, never to
 * reject anything.
 */
export interface MainStarCandidate {
  bodyId: number;
  starType?: string | null;
  distanceFromArrivalLs?: number | null;
}

export function mainStarRecord<R extends MainStarCandidate>(recs: Iterable<R>): R | undefined {
  let zero: R | undefined;
  let lowest: R | undefined;
  for (const r of recs) {
    if (!r.starType?.trim()) continue;
    if (!lowest || r.bodyId < lowest.bodyId) lowest = r;
    if (r.distanceFromArrivalLs === 0 && (!zero || r.bodyId < zero.bodyId)) zero = r;
  }
  return zero ?? lowest;
}
