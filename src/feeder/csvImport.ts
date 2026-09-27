import { parse } from "csv-parse/sync";

export interface SpanshExoRow {
  systemName: string;
  bodyName: string;
  bodySubtype: string;
  distanceToArrival: number | null;
  landmarkSubtype: string;
  value: number | null;
  count: number | null;
  jumps: number | null;
}

function num(v: string): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Genus = first word of landmark; species label = full landmark (e.g. "Stratum Tectonicas"). */
export function genusFromLandmark(landmark: string): string {
  const t = landmark.trim();
  if (!t) return "Unknown";
  return t.split(/\s+/)[0] ?? t;
}

export function parseSpanshExobiologyCsv(text: string): SpanshExoRow[] {
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
  }) as Record<string, string>[];

  const rows: SpanshExoRow[] = [];
  for (const r of records) {
    const systemName = r["System Name"] ?? r["system name"] ?? r["SystemName"] ?? "";
    const bodyName = r["Body Name"] ?? r["body name"] ?? r["BodyName"] ?? "";
    const landmark = r["Landmark Subtype"] ?? r["landmark subtype"] ?? r["LandmarkSubtype"] ?? "";
    if (!systemName || !bodyName || !landmark) continue;
    rows.push({
      systemName: systemName.trim(),
      bodyName: bodyName.trim(),
      bodySubtype: (r["Body Subtype"] ?? r["body subtype"] ?? "").trim(),
      distanceToArrival: num(r["Distance To Arrival"] ?? r["distance to arrival"] ?? ""),
      landmarkSubtype: landmark.trim(),
      value: num(r["Value"] ?? ""),
      count: r["Count"] != null && String(r["Count"]).trim() !== "" ? num(String(r["Count"])) : null,
      jumps: r["Jumps"] != null && String(r["Jumps"]).trim() !== "" ? num(String(r["Jumps"])) : null,
    });
  }
  return rows;
}

export interface SpeciesIndexEntry {
  genus: string;
  speciesLabel: string;
  systems: string[];
  /**
   * Unique (system, body) pairs — deduped.
   *
   * `count` is Spansh's `Count` column, carried verbatim and **uninterpreted** (§54). Nothing derives
   * anything from it; it is preserved because it is the only one of §9.4's three columns that cannot
   * be recovered from elsewhere once an import has discarded it.
   */
  occurrences: {
    systemName: string;
    bodyName: string;
    bodySubtype: string;
    distanceLs: number | null;
    count: number | null;
  }[];
  csvRowCount: number;
}

export function occurrenceKey(systemName: string, bodyName: string): string {
  return `${systemName.trim().toLowerCase()}\0${bodyName.trim().toLowerCase()}`;
}

/** Import stats for UI / API. */
export function countIndexGrowth(
  before: Record<string, SpeciesIndexEntry> | null,
  after: Record<string, SpeciesIndexEntry>,
): { newSpeciesLabels: number; newOccurrences: number } {
  let newSpeciesLabels = 0;
  let newOccurrences = 0;
  const beforeKeys = new Map<string, Set<string>>();

  if (before) {
    for (const [label, e] of Object.entries(before)) {
      const set = new Set<string>();
      for (const o of e.occurrences) set.add(occurrenceKey(o.systemName, o.bodyName));
      beforeKeys.set(label, set);
    }
  }

  for (const [label, e] of Object.entries(after)) {
    const prevSet = beforeKeys.get(label);
    if (!prevSet) {
      newSpeciesLabels += 1;
      newOccurrences += e.occurrences.length;
      continue;
    }
    for (const o of e.occurrences) {
      const k = occurrenceKey(o.systemName, o.bodyName);
      if (!prevSet.has(k)) newOccurrences += 1;
    }
  }

  return { newSpeciesLabels, newOccurrences };
}
