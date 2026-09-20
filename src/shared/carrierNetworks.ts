/**
 * Carrier networks that publish no file of their own.
 *
 * EDAstro curates exactly one network list, `DSSAdeployments.csv`, and that one arrives with the
 * carrier download. Everything else has to come from somewhere, and a name prefix is not good
 * enough: matching "OASIS" across the 90,077 carriers finds 106 rows, and matching "STAR" finds 902,
 * almost all of them ordinary carriers with the word in their name.
 *
 * So this roster is a **stated membership list**, given by the owner on 2026-09-20 rather than
 * inferred. The proof that the distinction matters is `W5X-43H`, which EDAstro files as
 * **"U.S.S KORRIBAN III"** with no OASIS anywhere in the name — a name heuristic loses it, and it is
 * a Vista Genomics carrier like the rest.
 *
 * Checked against the 2026-09-19 carrier file when it was written: **11 of 11 present, and all 11
 * carry Vista Genomics, Universal Cartographics, refuel and repair.** Sightings ran 0 to 13 days old,
 * a median of 2 — far fresher than carriers at large, because people visit these.
 *
 * Being a list rather than a feed, it goes stale silently: a carrier leaving the network, or a new
 * one joining, shows up only when somebody edits this file. That is the cost of having it at all,
 * and it is why the panel labels the badge with the network name rather than implying live status.
 */

/** A network whose membership this app carries rather than downloads. */
export interface CarrierNetwork {
  readonly key: string;
  /** What the chip and the badge say. */
  readonly label: string;
  readonly hint: string;
  /** Callsign -> the network's own name for the carrier. */
  readonly members: Readonly<Record<string, string>>;
}

/**
 * OASIS, as the owner listed it.
 *
 * Names are the network's, not the carrier file's: EDAstro holds these under four different
 * capitalisations ("OASIS Surface Detail", "OASIS WIRRAL", "oasis uss DROMUND KAAS") and one with no
 * prefix at all, so the file's spelling is not a reliable label.
 */
export const OASIS_NETWORK: CarrierNetwork = {
  key: "oasis",
  label: "OASIS",
  hint: "The OASIS network — a stated membership list, not a live feed. All 11 sell Vista Genomics.",
  members: {
    "J9H-0KM": "OASIS Surface Detail",
    "BZW-LVW": "OASIS Star of Earendil",
    "G8Q-9QN": "OASIS Wirral",
    "B0V-N3Z": "OASIS Mary Voytek",
    "THG-65K": "OASIS Tycho Brahe II",
    "N5Z-T4G": "OASIS Dersin's Rest",
    "N3F-WQF": "OASIS Joshua Lederberg",
    "W5X-43H": "OASIS USS Korriban III",
    "WNW-GHV": "OASIS Johannes Kepler",
    "WHK-91L": "OASIS USS Dromund Kaas",
    "N8Q-72B": "OASIS Vera Rubin",
  },
};

export const CARRIER_NETWORKS: readonly CarrierNetwork[] = [OASIS_NETWORK];

/** The network this callsign belongs to, or null. Callsigns are compared upper-case. */
export function networkForCallsign(callsign: string): { network: CarrierNetwork; name: string } | null {
  const key = callsign.trim().toUpperCase();
  for (const network of CARRIER_NETWORKS) {
    const name = network.members[key];
    if (name) return { network, name };
  }
  return null;
}
