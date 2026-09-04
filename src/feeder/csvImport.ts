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
  /** Unique (system, body) pairs — deduped */
  occurrences: { systemName: string; bodyName: string; bodySubtype: string; distanceLs: number | null }[];
  csvRowCount: number;
}

function uniqStrings(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))];
}

export function occurrenceKey(systemName: string, bodyName: string): string {
  return `${systemName.trim().toLowerCase()}\0${bodyName.trim().toLowerCase()}`;
}

export function buildSpeciesIndex(rows: SpanshExoRow[]): Record<string, SpeciesIndexEntry> {
  const bySpecies = new Map<string, SpanshExoRow[]>();
  for (const row of rows) {
    const label = row.landmarkSubtype.trim();
    if (!label) continue;
    const list = bySpecies.get(label) ?? [];
    list.push(row);
    bySpecies.set(label, list);
  }

  const index: Record<string, SpeciesIndexEntry> = {};

  for (const [speciesLabel, list] of bySpecies) {
    const genus = genusFromLandmark(speciesLabel);
    const systems = uniqStrings(list.map((r) => r.systemName));
    const occMap = new Map<
      string,
      { systemName: string; bodyName: string; bodySubtype: string; distanceLs: number | null }
    >();
    for (const r of list) {
      const k = occurrenceKey(r.systemName, r.bodyName);
      if (!occMap.has(k))
        occMap.set(k, {
          systemName: r.systemName,
          bodyName: r.bodyName,
          bodySubtype: r.bodySubtype,
          distanceLs: r.distanceToArrival,
        });
    }
    index[speciesLabel] = {
      genus,
      speciesLabel,
      systems,
      occurrences: [...occMap.values()],
      csvRowCount: list.length,
    };
  }

  return index;
}

/**
 * Unions species and (system, body) occurrences from a new CSV snapshot into an existing index.
 * Duplicate planets keep the first-seen row; `csvRowCount` adds row counts from both sides (includes duplicate CSV lines).
 */
export function mergeSpeciesIndex(
  existing: Record<string, SpeciesIndexEntry> | null,
  delta: Record<string, SpeciesIndexEntry>,
): Record<string, SpeciesIndexEntry> {
  const merged: Record<string, SpeciesIndexEntry> = existing ? structuredClone(existing) : {};

  for (const [label, inc] of Object.entries(delta)) {
    const cur = merged[label];
    if (!cur) {
      merged[label] = structuredClone(inc);
      continue;
    }

    const occMap = new Map<
      string,
      { systemName: string; bodyName: string; bodySubtype: string; distanceLs: number | null }
    >();
    for (const o of cur.occurrences) occMap.set(occurrenceKey(o.systemName, o.bodyName), { ...o });
    for (const o of inc.occurrences) {
      const k = occurrenceKey(o.systemName, o.bodyName);
      if (!occMap.has(k))
        occMap.set(k, {
          systemName: o.systemName,
          bodyName: o.bodyName,
          bodySubtype: o.bodySubtype,
          distanceLs: o.distanceLs,
        });
      else {
        const prev = occMap.get(k)!;
        if (!prev.bodySubtype.trim() && o.bodySubtype.trim()) prev.bodySubtype = o.bodySubtype;
        if (prev.distanceLs == null && o.distanceLs != null) prev.distanceLs = o.distanceLs;
      }
    }

    const systems = uniqStrings([...cur.systems, ...inc.systems]);
    merged[label] = {
      genus: cur.genus,
      speciesLabel: label,
      systems,
      occurrences: [...occMap.values()],
      csvRowCount: cur.csvRowCount + inc.csvRowCount,
    };
  }

  return merged;
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
