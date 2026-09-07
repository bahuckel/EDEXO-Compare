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
  /**
   * Taxon to genus, so the picker can offer Genus and then only that genus's species.
   *
   * Optional: a map file written before this existed simply has no entry for a taxon, and the
   * picker falls back to treating that taxon as its own genus rather than guessing from its name.
   */
  taxonGenus?: Record<string, string>;
}

/**
 * Sum one cell's counts, optionally narrowed to a set of taxa.
 *
 * A set rather than a single taxon because the picker offers a whole genus: "all Tussock" is
 * fourteen taxa, and summing them here is one pass instead of fourteen.
 */
export function cellTotals(cell: SectorMapCell, taxa?: ReadonlySet<string> | string): {
  confirmed: number;
  genus: number;
  signal: number;
  predicted: number;
  bodies: number;
} {
  const out = { confirmed: 0, genus: 0, signal: 0, predicted: 0, bodies: 0 };
  for (const [t, v] of Object.entries(cell.taxa)) {
    if (taxa !== undefined) {
      if (typeof taxa === "string") {
        if (t !== taxa) continue;
      } else if (!taxa.has(t)) continue;
    }
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

/**
 * One system inside a sector — the drill-down (Phase 10 step 4).
 *
 * Coordinates are absolute light years, not offsets: the sector view rescales to whatever it holds,
 * and an offset would have to be recomputed the moment a cell's contents changed.
 */
export interface SectorSystem {
  /** `id64` where known, else the store's row id as text. Stable, and not a name. */
  key: string;
  name: string;
  x: number;
  y: number;
  z: number;
  /** Species label or genus key → packed counts, same layout as {@link SectorMapCell}. */
  taxa: Record<string, PackedCounts>;
  /** The bodies behind those counts — the last rung of the drill-down (step 5). */
  bodies: SectorSystemBody[];
}

/**
 * One body, and what is known to grow on it.
 *
 * This is **history, not prediction**. The app's own panel offers *candidate* species for the system
 * the commander is standing in, scored from a live scan; nothing here can do that for a system on
 * the other side of the galaxy, because there is no scan to score. So a body lists what was actually
 * found — and says which of the three kinds of evidence found it — rather than guessing.
 */
export interface SectorSystemBody {
  name: string;
  /** Species confirmed on this body. */
  species: string[];
  /** Genus known, species not — from `SAASignalsFound` / Spansh `genuses`. */
  genuses: string[];
  /** Biological signals with nothing identified, when that is all we have. */
  signal: number;
}

/**
 * `data/exomastery/sector-systems.json`.
 *
 * **Deliberately a second file.** The galaxy view is 87 kB and every session that opens the map
 * downloads it; the systems are several times that and most sessions never click a sector. Keeping
 * them apart means the first paint does not pay for the drill-down, and the server hands out one
 * sector at a time rather than the lot.
 */
export interface SectorSystemsFile {
  generatedAt: string;
  /** Cell key → the systems inside it. */
  cells: Record<string, SectorSystem[]>;
}

/** Totals for one system, across every taxon or just one. */
export function systemTotals(system: SectorSystem, taxon?: string) {
  const out = { confirmed: 0, genus: 0, signal: 0, predicted: 0, bodies: 0 };
  for (const [t, v] of Object.entries(system.taxa)) {
    if (taxon !== undefined && t !== taxon) continue;
    out.confirmed += v[EVIDENCE_INDEX.confirmed] ?? 0;
    out.genus += v[EVIDENCE_INDEX.genus] ?? 0;
    out.signal += v[EVIDENCE_INDEX.signal] ?? 0;
    out.predicted += v[EVIDENCE_INDEX.predicted] ?? 0;
  }
  out.bodies = out.confirmed + out.genus + out.signal + out.predicted;
  return out;
}
