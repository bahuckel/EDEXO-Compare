/**
 * Green gas giant candidates the cloud ladder finds in the Spansh galaxy dump that the edGGG catalogue
 * does not list yet, for the galaxy map (docs/perf/ggg_candidates.py + ggg_layer.py). None at present
 * (2026-10-07): with the ladder aligned to CMDR Arcanic's code, the dump's exact hits are all
 * catalogued (Cyoilz JM-N b26-0 1, the last one, is #72), and of its near misses only catalogued ones
 * are within what the journal's rounding of mass and radius can close (shared/gggLadder.ts
 * `roundingReach`). Leami SL-W c18-375 8 and Blaa Eork EH-S d5-4 7 left on that check; the owner
 * found both not green in his tool. The model is CMDR Arcanic's ("The Mystery Property: Revealed"),
 * from CMDR Regza's density finding.
 *
 * [body, system, journal PlanetClass, surface temperature K, MassEM, radius m, x, y, z]
 */
export type GggCandidateRow = readonly [
  string,
  string,
  string,
  number,
  number,
  number,
  number,
  number,
  number,
];

export const GGG_CANDIDATES: readonly GggCandidateRow[] = [];
