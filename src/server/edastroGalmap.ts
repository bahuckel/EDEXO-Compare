/**
 * EDAstro's galaxy-map marker feed — the one source that knows where a network carrier is *now*.
 *
 * `fleetcarriers.csv` is rebuilt daily from EDDN and is the app's base layer. The map at
 * edastro.com/galmap is fed separately, and for the curated networks it is **much fresher**. The
 * owner caught this: `OASIS Vera Rubin [N8Q-72B]` jumped, and on 2026-09-20
 *
 * ```
 * fleetcarriers.csv   Lyed XJ-I d9-0          seen 2026-09-18 02:29:46
 * Spansh              Lyed XJ-I d9-0          seen 2026-09-18 02:29:46   (same EDDN event)
 * galmap OASIS layer  EORGH HYPA RR-U C19-0   <- correct
 * ```
 *
 * ### What it is, and the care it deserves
 *
 * `/galmap/POI0.json` … `POI3.json`, about 1.67 MB together, versioned by `/galmap/POI-timestamp`.
 * **This is the undocumented feed behind their map, not a published API** like the CSV files, so it
 * is read gently: once per session, on the commander's own button press, never on a timer.
 *
 * **Nothing is written to disk.** The owner's rule, and a good one: a format change upstream can
 * then cost at most one session's lookups, and restarting the app returns to the CSV that has not
 * moved. This module holds its index in memory and dies with the process.
 *
 * ### The shape, and why parsing it is the risky part
 *
 * Each marker is a positional array — `[solDistance, x, y, z, label, type]` — whose label is prose
 * meant for a popup, not for a parser:
 *
 * ```
 * OASIS Vera Rubin [N8Q-72B]
 * EORGH HYPA RR-U C19-0
 * Oasis Carrier
 * Services: Vista Genomics, Universal Cartography, Refuel, ...
 * ```
 *
 * So every reader here fails to *nothing* rather than to a guess: an unparseable marker is skipped,
 * and a feed that yields no carriers at all is treated as a failed fetch. A wrong system name on this
 * panel is a commander flying a few thousand light years to the wrong place.
 *
 * ### Clusters have no position
 *
 * 213 markers are "Multiple Fleet Carriers" pins holding **767 carriers between them**, placed at a
 * cluster centre rather than at any one carrier's system. Those carry a system name and no
 * coordinates, and the panel shows no distance for them rather than a distance that is wrong.
 * The other 1,841 markers are single carriers whose coordinates are their own.
 */

const GALMAP_BASE = "https://edastro.com/galmap";
const GALMAP_FILES = ["POI0.json", "POI1.json", "POI2.json", "POI3.json"] as const;

/** Marker types that describe a fleet carrier. Anything else in the feed is scenery. */
const CARRIER_TYPES = new Set([
  "carrier",
  "DSSAcarrier",
  "DSSAundeploy",
  "IGAUcarrier",
  "STARgreen",
  "STARyellow",
  "OASIScarrier",
  "PIONEERcarrier",
]);

/** Which network a marker type belongs to, for the row's badge. `carrier` is nobody's. */
const NETWORK_BY_TYPE: Readonly<Record<string, string>> = {
  DSSAcarrier: "DSSA",
  DSSAundeploy: "DSSA",
  IGAUcarrier: "IGAU",
  STARgreen: "STAR",
  STARyellow: "STAR",
  OASIScarrier: "OASIS",
  PIONEERcarrier: "Pioneer",
};

export interface GalmapCarrier {
  callsign: string;
  name: string;
  system: string;
  /** Null for the 767 carriers that live in a cluster marker; their pin is not their system. */
  x: number | null;
  y: number | null;
  z: number | null;
  /** "OASIS", "DSSA", … or null for an ordinary recently-moved carrier. */
  network: string | null;
}

/** `Some Name [ABC-123]`, the one reliable landmark in the label. */
const CALLSIGN_IN_LABEL = /^(.*?)\s*\[([A-Z0-9]{3,4}-[A-Z0-9]{3})\]/;

/**
 * Pull every carrier out of one marker.
 *
 * Two shapes. A single marker puts the name and callsign on line 0 and the system on line 1. A
 * cluster opens with "Multiple Fleet Carriers" and then repeats `Name [CALLSIGN] -- System` blocks.
 */
export function parseGalmapMarker(marker: unknown): GalmapCarrier[] {
  if (!Array.isArray(marker) || marker.length < 6) return [];
  const type = String(marker[5] ?? "");
  if (!CARRIER_TYPES.has(type)) return [];
  const label = typeof marker[4] === "string" ? marker[4] : "";
  if (!label) return [];
  const network = NETWORK_BY_TYPE[type] ?? null;

  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const lines = label.split("\n").map((l) => l.trim());
  if (/^Multiple Fleet Carriers/i.test(lines[0] ?? "")) {
    // Cluster: `Name [CALLSIGN] -- System` per carrier, at a shared pin that is nobody's position.
    const out: GalmapCarrier[] = [];
    for (const line of lines) {
      const split = line.split(" -- ");
      if (split.length < 2) continue;
      const m = CALLSIGN_IN_LABEL.exec(split[0]!.trim());
      if (!m) continue;
      out.push({
        callsign: m[2]!,
        name: (m[1] ?? "").trim(),
        system: split.slice(1).join(" -- ").trim(),
        x: null,
        y: null,
        z: null,
        network,
      });
    }
    return out;
  }

  const m = CALLSIGN_IN_LABEL.exec(lines[0] ?? "");
  if (!m) return [];
  const system = (lines[1] ?? "").trim();
  // A marker with no system line says nothing this panel can use.
  if (!system) return [];
  return [
    {
      callsign: m[2]!,
      name: (m[1] ?? "").trim(),
      system,
      x: num(marker[1]),
      y: num(marker[2]),
      z: num(marker[3]),
      network,
    },
  ];
}

/**
 * Fold one marker into the index.
 *
 * **A networked entry beats a plain one, whatever the file order.** A carrier appears on both its
 * network layer and the "recent carriers" layer, and the two disagree: N8Q-72B was on the OASIS
 * layer in POI1 with its current system and on the plain layer in POI2 with the system it had left
 * two days earlier. Reading POI2 second and letting it win would throw away the only correct answer
 * in the entire feed — silently, and on the exact case this feature exists for.
 *
 * Between two entries of the same kind the first wins, which keeps the map's own file order.
 */
export function addMarkerToIndex(byCallsign: Map<string, GalmapCarrier>, marker: unknown): void {
  for (const carrier of parseGalmapMarker(marker)) {
    const existing = byCallsign.get(carrier.callsign);
    if (existing && (existing.network !== null || carrier.network === null)) continue;
    byCallsign.set(carrier.callsign, carrier);
  }
}

export interface GalmapIndex {
  byCallsign: Map<string, GalmapCarrier>;
  /** `/galmap/POI-timestamp`, e.g. "20260920-023136". Null when it could not be read. */
  timestamp: string | null;
  fetchedAtMs: number;
}

/**
 * The session's copy. Memory only — never a file.
 *
 * `loading` is held so two rows pressed at once share one fetch rather than pulling 1.67 MB twice.
 */
let index: GalmapIndex | null = null;
let loading: Promise<GalmapIndex | null> | null = null;

export function resetGalmapForTests(): void {
  index = null;
  loading = null;
}

/** What the panel knows without asking for a download. */
export function galmapStatus(): { loaded: boolean; carriers: number; timestamp: string | null } {
  return {
    loaded: index !== null,
    carriers: index?.byCallsign.size ?? 0,
    timestamp: index?.timestamp ?? null,
  };
}

async function fetchGalmapIndex(userAgent: string): Promise<GalmapIndex | null> {
  let timestamp: string | null = null;
  try {
    const res = await fetch(`${GALMAP_BASE}/POI-timestamp`, {
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const text = (await res.text()).trim();
      // A timestamp is a version marker, not data; an HTML error page must not become one.
      if (/^[0-9-]{6,32}$/.test(text)) timestamp = text;
    }
  } catch {
    /* the timestamp is a nicety; the markers are the point */
  }

  const byCallsign = new Map<string, GalmapCarrier>();
  for (const file of GALMAP_FILES) {
    let res: Response;
    try {
      res = await fetch(`${GALMAP_BASE}/${file}${timestamp ? `?${timestamp}` : ""}`, {
        headers: { Accept: "application/json", "User-Agent": userAgent },
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return null;
    }
    const markers = (body as { markers?: unknown })?.markers;
    if (!Array.isArray(markers)) return null;
    for (const marker of markers) addMarkerToIndex(byCallsign, marker);
  }

  // A feed that parses to no carriers at all is a format change or an error page, not an empty map.
  if (byCallsign.size === 0) return null;
  return { byCallsign, timestamp, fetchedAtMs: Date.now() };
}

/**
 * The session's index, fetching it once on first use.
 *
 * Deliberately never refreshed: the commander asked for this to hold for a session and for a restart
 * to fall back to the CSV, so one fetch per run is the whole contract.
 */
export async function getGalmapIndex(userAgent: string): Promise<GalmapIndex | null> {
  if (index) return index;
  if (!loading) {
    loading = fetchGalmapIndex(userAgent).then((result) => {
      if (result) index = result;
      loading = null;
      return result;
    });
  }
  return loading;
}

export async function lookupCarrierOnGalmap(
  callsign: string,
  userAgent: string,
): Promise<GalmapCarrier | null> {
  const idx = await getGalmapIndex(userAgent);
  return idx?.byCallsign.get(callsign.trim().toUpperCase()) ?? null;
}
