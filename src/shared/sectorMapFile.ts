/**
 * The shape of `data/exomastery/sector-map.json` — INCLUDE-BODY-IDS Phase 10, step 3.
 *
 * Written by the feeder, read by the app. The app never opens `feeder_store.sqlite`; the corpus is a
 * build input, and this is the shipped derivative of it — the same arrangement as
 * `species-prevalence.json` and `genus-cooccurrence.json`.
 *
 * ## The counts are packed as an array on purpose
 *
 * `[confirmed, genus, signal, predicted]`. This repeats once per (cell, taxon) — 2,741 times today
 * and far more once the export lands — and spelled-out keys would be most of the file. The order is
 * `EVIDENCE_KINDS` reversed to strongest-first, and {@link EVIDENCE_INDEX} is the only place that
 * knows it.
 */

/** Index into a packed count tuple. */
export const EVIDENCE_INDEX = { confirmed: 0, genus: 1, signal: 2, predicted: 3 } as const;

/** `[confirmed, genus, signal, predicted]`. */
export type PackedCounts = readonly number[];

export interface SectorMapCell {
  /** `x:y:z` of the 1280 ly grid cell. */
  key: string;
  x: number;
  y: number;
  z: number;
  /**
   * The sector's game name, or null when the cell is outside the catalogue.
   *
   * Null is drawn as the cell key rather than hidden — a marker with data and no name is still a
   * place worth flying to, and blanking it would lose evidence to a labelling gap.
   */
  name: string | null;
  /** Species label or genus key → packed counts. `"*"` means "biology, unidentified". */
  taxa: Record<string, PackedCounts>;
}

export interface SectorMapFile {
  generatedAt: string;
  /** Travels with the data so the map cannot be read as a map of the galaxy. */
  note: string;
  sectorNameSource: string;
  cells: SectorMapCell[];
}

/** Sum one cell's counts across every taxon, or across one taxon when `taxon` is given. */
export function cellTotals(cell: SectorMapCell, taxon?: string): {
  confirmed: number;
  genus: number;
  signal: number;
  predicted: number;
  bodies: number;
} {
  const out = { confirmed: 0, genus: 0, signal: 0, predicted: 0, bodies: 0 };
  for (const [t, v] of Object.entries(cell.taxa)) {
    if (taxon !== undefined && t !== taxon) continue;
    out.confirmed += v[EVIDENCE_INDEX.confirmed] ?? 0;
    out.genus += v[EVIDENCE_INDEX.genus] ?? 0;
    out.signal += v[EVIDENCE_INDEX.signal] ?? 0;
    out.predicted += v[EVIDENCE_INDEX.predicted] ?? 0;
  }
  out.bodies = out.confirmed + out.genus + out.signal + out.predicted;
  return out;
}

/** Every taxon present anywhere in the file, sorted — the species picker's options. */
export function allTaxa(file: SectorMapFile): string[] {
  const s = new Set<string>();
  for (const c of file.cells) for (const t of Object.keys(c.taxa)) s.add(t);
  return [...s].sort();
}
