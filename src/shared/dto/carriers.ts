/**
 * One fleet carrier as EDAstro last saw it.
 *
 * **Two ages, and they answer different questions.** `lastSeenDays` is how old the record is;
 * `dwellDays` is how long the carrier had already sat still at the moment of that sighting, and it
 * is the one that predicts whether it is still there. Measured across the whole file, carriers are
 * bimodal — median dwell 1 day, p90 180 — so a long-parked carrier on a stale record is a better bet
 * than a mover on a fresh one. Both go on the row; neither is presented as a position.
 */
export interface CarrierRowDTO {
  callsign: string;
  /** Often empty: EDAstro only learns the name from events that carry it. */
  name: string;
  system: string;
  systemAddress: number | null;
  region: string;
  /** Null when the app has not seen the commander jump yet, which is a real state on a cold start. */
  distanceLy: number | null;
  lastSeenDays: number | null;
  dwellDays: number | null;
  /** Raw EDAstro service keys; `carrierServices.ts` turns them into names. */
  services: string[];
  /**
   * Set when this carrier is part of the Deep Space Support Array — 101 curated, deliberately parked
   * service carriers. Null for the other ~90,000, which is almost all of them.
   */
  dssa: {
    commander: string;
    /** "Carrier Operational" on all 101 today; surfaced because the column exists to say otherwise. */
    status: string;
    /** Where the network placed it. It has drifted from this on 0 of 101 rows, which is the point. */
    deploymentSystem: string;
  } | null;
  /**
   * A network whose membership this app carries rather than downloads — OASIS today.
   *
   * Separate from `dssa` because the evidence is different in kind: DSSA arrives as a curated file
   * with an operational status, this is a stated list that goes stale silently.
   */
  network: { key: string; label: string; name: string } | null;
}

/** Whether the commander has a carrier file yet, how old it is, and whether the button is armed. */
export interface CarrierDataStatusDTO {
  haveData: boolean;
  rowCount: number;
  /** When we last asked EDAstro — what the cooldown counts. */
  fetchedAtMs: number | null;
  /** `Last-Modified` as EDAstro reported it: how old the data is, rather than the request. */
  sourceLastModified: string | null;
  cooldownMsRemaining: number;
  sourceUrl: string;
  /** How many Deep Space Support Array carriers are on disk; 0 until the first fetch. */
  dssaCount: number;
}

/**
 * One point of interest from EDAstro's combined catalogue.
 *
 * Two catalogues behind it and the thinner one shows: the 2,123 Galactic Mapping Project rows carry
 * no `rating`, no `region` and no `summary`, so those read blank rather than zero. `key` is
 * `source:id` because `id` alone collides on 551 rows.
 */
export interface PoiRowDTO {
  key: string;
  name: string;
  /** The system as the galaxy map spells it. Blank on 94 of 2,766. */
  system: string;
  region: string;
  typeLabel: string;
  group: string;
  organic: boolean;
  distanceLy: number | null;
  /** At most 200 characters. The full description stays on EDAstro's own page — see `url`. */
  summary: string;
  /** 1.07 to 9.3 where the catalogue has one; null for every GMP row. */
  rating: number | null;
  url: string;
  source: string;
}

export interface PoiDataStatusDTO {
  haveData: boolean;
  rowCount: number;
  fetchedAtMs: number | null;
  cooldownMsRemaining: number;
  sourceUrl: string;
}

export interface PoiQueryResultDTO {
  rows: PoiRowDTO[];
  matchCount: number;
  status: PoiDataStatusDTO;
  origin: { x: number; y: number; z: number } | null;
}

/**
 * What Spansh says about one carrier, fetched on a row's own button.
 *
 * A second opinion, not a correction. Measured on 16 carriers: Spansh newer on 9, EDAstro newer on
 * 3, same on 3, absent on 1 — so the panel shows both and overwrites nothing.
 */
export interface CarrierLiveFixDTO {
  callsign: string;
  system: string;
  /** Spansh's last-seen timestamp, ISO, or null when it carries none. */
  updatedAt: string | null;
  /** From the commander, when a position is known. */
  distanceLy: number | null;
  /** True when Spansh names a different system from the cached row — the reason to press the button. */
  differs: boolean;
  /** Stable game id; the name match that found it is fuzzy, this is not. Null from the map feed. */
  marketId: number | null;
  /**
   * Which source answered.
   *
   * `galmap` is EDAstro's own map feed, which is fresher than the daily CSV for carriers it carries
   * and is the only source that saw some jumps at all. `spansh` is the fallback for the ~88,000
   * carriers the map does not track.
   */
  source: "galmap" | "spansh";
  /** The network the map files it under — OASIS, DSSA, IGAU, STAR, Pioneer — or null. */
  network: string | null;
  /** True when the map put it in a cluster pin, so its system is known and its distance is not. */
  positionUnknown?: boolean;
}

export interface CarrierQueryResultDTO {
  rows: CarrierRowDTO[];
  /** Matches before the row limit, so the panel can say "100 of 19,541". */
  matchCount: number;
  status: CarrierDataStatusDTO;
  /** Null when no jump has been seen; the panel then lists without distances. */
  origin: { x: number; y: number; z: number } | null;
}
