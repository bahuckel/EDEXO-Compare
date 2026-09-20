/**
 * Two catalogues, two vocabularies, one filter row.
 *
 * `/gec/json/combined` merges the **Galactic Exploration Catalog** (643 curated entries, human type
 * names like "Sights and Scenery") with the older **Galactic Mapping Project** (2,123 entries,
 * camelCase codes like `planetaryNebula`). Left alone the panel would offer forty-odd chips, half of
 * them saying the same thing twice — "Nebulae" beside `nebula` beside `planetaryNebula`.
 *
 * So both vocabularies map into one short set of groups. Counts below are from the 2026-09-20 feed
 * and are what the mapping was built against:
 *
 * ```
 * GEC  Sights and Scenery 190  Planetary Features 140  Stellar Features 73  Green Gas Giants 61
 *      Nebulae 46  Notable Stellar Phenomena 31  Organic 26  Deep Space Outpost 17
 *      Mystery and Xenology 15  Tourist Beacons 9  Community 9  Inhabited System 7  Glitches 7
 *      Historical 5  Memorials 5  Planetary Circumnavigation 1  (blank) 1
 *
 * GMP  minorPOI 472  planetaryNebula 368  planetFeatures 253  nebula 219  stellarRemnant 158
 *      jumponiumRichSystem 76  starCluster 73  independentOutpost 66  region 64
 *      historicalLocation 61  blackHole 57  mysteryPOI 47  deepSpaceOutpost 41  geyserPOI 33
 *      regional 29  surfacePOI 23  restrictedSectors 22  organicPOI 16  minorRoute 15
 *      pulsar 14  neutronRoute 7  travelRoute 4  historicalRoute 4  settlement 1
 * ```
 *
 * **Organic is the one this app exists for** — GEC's `Organic` (26) and GMP's `organicPOI` (16)
 * together, 53 rows once `type2` matches are counted. A commander looking for somewhere worth
 * landing on wants that chip, and it would have been split in two by the raw vocabularies.
 */

/** A filter group, in the order the panel offers them. */
export type PoiGroup =
  | "organic"
  | "planetary"
  | "stellar"
  | "nebulae"
  | "outposts"
  | "mystery"
  | "scenery"
  | "historical"
  | "routes"
  | "other";

export interface PoiGroupOption {
  readonly key: PoiGroup;
  readonly label: string;
  readonly hint: string;
}

export const POI_GROUP_OPTIONS: readonly PoiGroupOption[] = [
  { key: "organic", label: "Organic", hint: "Biology worth the trip. The reason this panel is here." },
  {
    key: "planetary",
    label: "Planetary",
    hint: "Surface features, geysers, unusual worlds and green gas giants.",
  },
  { key: "stellar", label: "Stellar", hint: "Stars, remnants, black holes, pulsars and stellar phenomena." },
  { key: "nebulae", label: "Nebulae", hint: "Nebulae and planetary nebulae." },
  {
    key: "outposts",
    label: "Outposts",
    hint: "Deep space stations, carriers on station, inhabited systems.",
  },
  { key: "mystery", label: "Mystery", hint: "Xenology, unexplained sites and game glitches." },
  { key: "scenery", label: "Scenery", hint: "Views, tourist beacons, clusters and named regions." },
  {
    key: "historical",
    label: "Historical",
    hint: "Memorials, community sites and places something happened.",
  },
  { key: "routes", label: "Routes", hint: "Travel routes, jumponium-rich systems and restricted space." },
] as const;

/**
 * Raw type -> group, for both vocabularies.
 *
 * Anything absent falls to `other` rather than vanishing: this is somebody else's catalogue and it
 * gains categories without telling us. A POI in an unmapped category must still be findable.
 */
const GROUP_BY_TYPE: Readonly<Record<string, PoiGroup>> = {
  // GEC
  Organic: "organic",
  "Planetary Features": "planetary",
  "Green Gas Giants": "planetary",
  "Stellar Features": "stellar",
  "Notable Stellar Phenomena": "stellar",
  Nebulae: "nebulae",
  "Deep Space Outpost": "outposts",
  "Inhabited System": "outposts",
  "Mystery and Xenology": "mystery",
  Glitches: "mystery",
  "Sights and Scenery": "scenery",
  "Tourist Beacons": "scenery",
  Historical: "historical",
  Memorials: "historical",
  Community: "historical",
  "Planetary Circumnavigation": "routes",
  // GMP
  organicPOI: "organic",
  planetFeatures: "planetary",
  surfacePOI: "planetary",
  geyserPOI: "planetary",
  stellarRemnant: "stellar",
  blackHole: "stellar",
  pulsar: "stellar",
  nebula: "nebulae",
  planetaryNebula: "nebulae",
  deepSpaceOutpost: "outposts",
  independentOutpost: "outposts",
  settlement: "outposts",
  mysteryPOI: "mystery",
  minorPOI: "scenery",
  starCluster: "scenery",
  region: "scenery",
  regional: "scenery",
  historicalLocation: "historical",
  minorRoute: "routes",
  neutronRoute: "routes",
  travelRoute: "routes",
  historicalRoute: "routes",
  jumponiumRichSystem: "routes",
  restrictedSectors: "routes",
};

/** Readable names for the GMP codes. GEC's own type strings are already prose. */
const GMP_LABELS: Readonly<Record<string, string>> = {
  minorPOI: "Point of interest",
  planetaryNebula: "Planetary nebula",
  planetFeatures: "Planetary feature",
  nebula: "Nebula",
  stellarRemnant: "Stellar remnant",
  jumponiumRichSystem: "Jumponium-rich",
  starCluster: "Star cluster",
  independentOutpost: "Independent outpost",
  region: "Region",
  regional: "Region",
  historicalLocation: "Historical site",
  blackHole: "Black hole",
  mysteryPOI: "Mystery",
  deepSpaceOutpost: "Deep space outpost",
  geyserPOI: "Geysers",
  surfacePOI: "Surface site",
  restrictedSectors: "Restricted space",
  organicPOI: "Organic",
  minorRoute: "Route",
  pulsar: "Pulsar",
  neutronRoute: "Neutron route",
  travelRoute: "Travel route",
  historicalRoute: "Historical route",
  settlement: "Settlement",
};

/**
 * Which group a POI belongs to.
 *
 * `type2` is consulted because GEC rows carry a second category and some of them are only organic on
 * that one — the count goes from 42 to 53 once it is read.
 */
export function poiGroup(type: string | null | undefined, type2?: string | null): PoiGroup {
  const primary = GROUP_BY_TYPE[(type ?? "").trim()];
  if (primary) return primary;
  const secondary = GROUP_BY_TYPE[(type2 ?? "").trim()];
  return secondary ?? "other";
}

/**
 * Organic is asked separately from the group, because a POI whose *second* category is Organic is
 * still somewhere to go and look at a plant, even when its first says "Planetary Features".
 */
export function poiIsOrganic(type: string | null | undefined, type2?: string | null): boolean {
  return poiGroup(type, null) === "organic" || poiGroup(type2, null) === "organic";
}

/** What to print in the Type column. Falls back to the raw string, never to an empty cell. */
export function poiTypeLabel(type: string | null | undefined): string {
  const raw = (type ?? "").trim();
  if (!raw) return "Unclassified";
  const mapped = GMP_LABELS[raw];
  if (mapped) return mapped;
  // A GEC type, or a code added upstream since this map was written: show it rather than hide it,
  // splitting camelCase so a new code at least reads as words.
  if (/^[a-z]+[A-Z]/.test(raw)) {
    return raw.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
  }
  return raw;
}

export const POI_GROUP_LABEL: Readonly<Record<PoiGroup, string>> = {
  ...Object.fromEntries(POI_GROUP_OPTIONS.map((o) => [o.key, o.label])),
  other: "Other",
} as Record<PoiGroup, string>;
