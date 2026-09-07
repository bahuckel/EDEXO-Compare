/**
 * Spansh exobiology route exports, in either format the site offers.
 *
 * These are the most trustworthy input the corpus takes: every row is a **species somebody actually
 * found on a named body**, not a genus signal and not a prediction. EDDN gives volume, the galaxy
 * dump gives conditions, and this gives ground truth — so it stays worth feeding by hand even after
 * the galaxy database lands.
 *
 * ## The JSON is strictly better than the CSV, and it is not close
 *
 * Spansh offers both. The CSV carries eight columns and no identifiers:
 *
 * ```
 * System Name, Body Name, Body Subtype, Distance To Arrival, Landmark Subtype, Value, Count, Jumps
 * ```
 *
 * The JSON carries the same landmarks **plus** the two things the corpus has repeatedly had to go
 * and fetch: the system's `id64` and coordinates, and the body's `id64`. Measured on the owner's two
 * route exports, the JSON supplies coordinates for **100 %** of systems and a body id64 for 100 % of
 * bodies, where the CSV supplies neither and every one would need an EDSM lookup to place.
 *
 * The body id64 is worth more than it looks. `bodyId64 == systemId64 + (bodyId << 55)` — verified
 * across 17,830 Spansh and 38,489 EDSM bodies at 100 % — so the in-system `BodyID` falls out by
 * arithmetic, with no request to anyone. On the sample above, body `432361629686703657` in system
 * `16065459136041` is body 12, and that is the number the journal uses.
 *
 * Both id64 fields arrive **as JSON strings**, so they survive `JSON.parse` intact. The sibling
 * `id` field is a bare number past 2^53 and is silently rounded by any parser; it is ignored here
 * for that reason.
 *
 * ## What this module does not do
 *
 * It parses and nothing else. Writing to the corpus needs `sql.js`, which is a devDependency and is
 * absent from the packaged app — so the server can read one of these files and describe it, but only
 * the feeder CLI can ingest it.
 */

import { genusFromLandmark, parseSpanshExobiologyCsv, type SpanshExoRow } from "./csvImport.js";

/** A system's identity and position, present only in the JSON export. */
export interface SpanshRouteSystem {
  name: string;
  id64: string | null;
  x: number;
  y: number;
  z: number;
}

/** A body's identity, present only in the JSON export. */
export interface SpanshRouteBody {
  systemName: string;
  bodyName: string;
  bodyId64: string | null;
  /** Derived from the id64 pair by the shift rule; null when either id64 is missing. */
  bodyId: number | null;
}

export interface SpanshRouteFile {
  format: "csv" | "json";
  rows: SpanshExoRow[];
  /** Empty for CSV. */
  systems: SpanshRouteSystem[];
  /** Empty for CSV. */
  bodies: SpanshRouteBody[];
  /** Route metadata, when the file carries it. */
  source: string | null;
  destination: string | null;
  createdAt: string | null;
  /** Anything odd but survivable, for the reader rather than for control flow. */
  warnings: string[];
}

/**
 * In-system `BodyID` from the two id64s.
 *
 * Returns null rather than a guess when either id is missing or the arithmetic does not land on a
 * plausible body — a negative or absurd index means the two ids are not from the same system, and
 * inventing one would put a body in the wrong place.
 */
export function bodyIdFromId64Pair(systemId64: string, bodyId64: string): number | null {
  try {
    const delta = BigInt(bodyId64) - BigInt(systemId64);
    if (delta < 0n) return null;
    const id = delta >> 55n;
    // Journal BodyIDs are small; the largest systems have a few hundred bodies.
    return id > 4096n ? null : Number(id);
  } catch {
    return null;
  }
}

interface RawJsonBody {
  name?: unknown;
  id64?: unknown;
  subtype?: unknown;
  distance_to_arrival?: unknown;
  landmarks?: unknown;
}

interface RawJsonSystem {
  name?: unknown;
  id64?: unknown;
  x?: unknown;
  y?: unknown;
  z?: unknown;
  jumps?: unknown;
  bodies?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function parseJsonExport(text: string): SpanshRouteFile {
  const doc = JSON.parse(text) as {
    result?: unknown;
    parameters?: { source?: unknown; destination?: unknown };
    created_at?: unknown;
  };
  const result = Array.isArray(doc.result) ? (doc.result as RawJsonSystem[]) : null;
  if (!result) throw new Error("Not a Spansh route export — no `result` array.");

  const rows: SpanshExoRow[] = [];
  const systems: SpanshRouteSystem[] = [];
  const bodies: SpanshRouteBody[] = [];
  const warnings: string[] = [];
  let bodiesWithoutLandmarks = 0;

  for (const sys of result) {
    const systemName = str(sys.name);
    if (!systemName) continue;
    const x = numOrNull(sys.x);
    const y = numOrNull(sys.y);
    const z = numOrNull(sys.z);
    const systemId64 = str(sys.id64) || null;
    if (x != null && y != null && z != null) {
      systems.push({ name: systemName, id64: systemId64, x, y, z });
    }
    const jumps = numOrNull(sys.jumps);

    const bodyList = Array.isArray(sys.bodies) ? (sys.bodies as RawJsonBody[]) : [];
    for (const body of bodyList) {
      const bodyName = str(body.name);
      if (!bodyName) continue;
      const bodyId64 = str(body.id64) || null;
      bodies.push({
        systemName,
        bodyName,
        bodyId64,
        bodyId: systemId64 && bodyId64 ? bodyIdFromId64Pair(systemId64, bodyId64) : null,
      });

      const landmarks = Array.isArray(body.landmarks) ? body.landmarks : [];
      if (landmarks.length === 0) {
        bodiesWithoutLandmarks += 1;
        continue;
      }
      const subtype = str(body.subtype);
      const distance = numOrNull(body.distance_to_arrival);
      for (const lm of landmarks as { subtype?: unknown; count?: unknown; value?: unknown }[]) {
        const landmarkSubtype = str(lm.subtype);
        if (!landmarkSubtype) continue;
        rows.push({
          systemName,
          bodyName,
          bodySubtype: subtype,
          distanceToArrival: distance,
          landmarkSubtype,
          value: numOrNull(lm.value),
          count: numOrNull(lm.count),
          jumps,
        });
      }
    }
  }

  if (bodiesWithoutLandmarks > 0) {
    warnings.push(`${bodiesWithoutLandmarks} body/bodies carried no landmarks and were skipped.`);
  }

  return {
    format: "json",
    rows,
    systems,
    bodies,
    source: str(doc.parameters?.source) || null,
    destination: str(doc.parameters?.destination) || null,
    createdAt: str(doc.created_at) || null,
    warnings,
  };
}

/** The CSV header Spansh writes, used to tell a route export from some other CSV. */
function looksLikeExobiologyCsv(text: string): boolean {
  const head = text.slice(0, 2000).toLowerCase();
  return head.includes("system name") && head.includes("landmark subtype");
}

/**
 * Parse either export format.
 *
 * The format is decided by content rather than by file extension, because a file renamed on the way
 * out of a browser is a likelier event than a file whose first non-space character lies about what
 * it is.
 */
export function parseSpanshRouteFile(text: string): SpanshRouteFile {
  // Strip a UTF-8 BOM: a browser download can carry one, and it would hide the leading brace.
  const trimmed = text.replace(/^\uFEFF/, "").trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return parseJsonExport(trimmed);

  if (!looksLikeExobiologyCsv(trimmed)) {
    throw new Error(
      "Unrecognised file — expected a Spansh exobiology route export, as JSON or as CSV with " +
        '"System Name" and "Landmark Subtype" columns.',
    );
  }
  const rows = parseSpanshExobiologyCsv(trimmed);
  const warnings: string[] = [];
  if (rows.length === 0) warnings.push("No usable rows — every line was missing a name or a landmark.");
  else {
    warnings.push(
      "CSV carries no coordinates and no body ids. The JSON export of the same route does, and every " +
        "body it identifies is one that needs no EDSM lookup.",
    );
  }
  return {
    format: "csv",
    rows,
    systems: [],
    bodies: [],
    source: null,
    destination: null,
    createdAt: null,
    warnings,
  };
}

export interface SpanshRouteSummary {
  format: "csv" | "json";
  rows: number;
  systems: number;
  bodies: number;
  species: number;
  genera: number;
  systemsWithCoords: number;
  bodiesWithId: number;
  source: string | null;
  destination: string | null;
  createdAt: string | null;
  topSpecies: { label: string; rows: number }[];
  warnings: string[];
}

/** What the file holds, for the panel that just accepted it. */
export function summariseSpanshRouteFile(file: SpanshRouteFile): SpanshRouteSummary {
  const perSpecies = new Map<string, number>();
  const genera = new Set<string>();
  const systemNames = new Set<string>();
  const bodyKeys = new Set<string>();
  for (const r of file.rows) {
    perSpecies.set(r.landmarkSubtype, (perSpecies.get(r.landmarkSubtype) ?? 0) + 1);
    genera.add(genusFromLandmark(r.landmarkSubtype));
    systemNames.add(r.systemName);
    bodyKeys.add(`${r.systemName} ${r.bodyName}`);
  }
  const topSpecies = [...perSpecies.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([label, rows]) => ({ label, rows }));

  return {
    format: file.format,
    rows: file.rows.length,
    systems: systemNames.size,
    bodies: bodyKeys.size,
    species: perSpecies.size,
    genera: genera.size,
    systemsWithCoords: file.systems.length,
    bodiesWithId: file.bodies.filter((b) => b.bodyId != null).length,
    source: file.source,
    destination: file.destination,
    createdAt: file.createdAt,
    topSpecies,
    warnings: file.warnings,
  };
}

