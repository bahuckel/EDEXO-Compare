/**
 * Green gas giant candidates the cloud ladder finds in the Spansh galaxy dump (38.2 M gas giants;
 * docs/perf/ggg_candidates.py + ggg_layer.py, 2026-10-05) that the edGGG catalogue does not list yet,
 * for the galaxy map. Only those the verdict scores 1.5 or more by the ladder itself: an exact float
 * match, or one float step off in his "maybe" nudge range. Narrowed on 2026-10-07 when the ladder was
 * aligned to CMDR Arcanic's own code (densitydemo.html): of the 13, ten fell below that (one float
 * step off out of a nudge range, of which none of the 13 on the dump is catalogued), or off the
 * ladder. The app scores them
 * with shared/greenGasGiant.ts like any scan. The model is CMDR Arcanic's ("The Mystery Property:
 * Revealed"), from CMDR Regza's density finding. Cyoilz JM-N b26-0 1, the third, was found green on
 * 1 Oct 3312 and is catalogue #72 since 2026-10-07.
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

export const GGG_CANDIDATES: readonly GggCandidateRow[] = [
  [
    "Leami SL-W c18-375 8",
    "Leami SL-W c18-375",
    "Gas giant with ammonia based life",
    119.724983,
    346.083435,
    70950224,
    2209.5625,
    -67.96875,
    20244.5625,
  ],
  [
    "Blaa Eork EH-S d5-4 7",
    "Blaa Eork EH-S d5-4",
    "Gas giant with ammonia based life",
    116.959549,
    228.807571,
    57220672,
    2047.5625,
    -49.03125,
    1999.625,
  ],
];
