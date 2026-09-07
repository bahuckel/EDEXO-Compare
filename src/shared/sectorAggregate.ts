/**
 * Counting what is known about a species, per sector — INCLUDE-BODY-IDS Phase 10, step 2.
 *
 * The map draws one marker per sector per species, and the marker's colour is decided by the
 * *strongest* thing known there. So the aggregate has to keep the evidence kinds apart rather than
 * summing them: a sector with 200 confirmed sightings is a different place from one with 200 maybes,
 * and the owner's own tooltip list is exactly that distinction.
 *
 * ## The four kinds, strongest first
 *
 * | kind | means | where it comes from |
 * |---|---|---|
 * | `confirmed` | this **species** was identified here | corpus sightings, the commander's codex |
 * | `genus` | the **genus** is known, the species is not | `SAASignalsFound` / Spansh `signals.genuses` |
 * | `signal` | a biological signal, nobody has looked | `FSSBodySignals`, Spansh signal counts |
 * | `predicted` | conditions match, no signal seen | the matcher alone |
 *
 * `genus` sits between the other two because it is a real observation that narrows the answer
 * without settling it — a Bacterium genus hit rules out nineteen other genera, which is worth far
 * more than a bare signal count and far less than a species.
 *
 * ## Two rules that stop the map lying
 *
 * **A body is counted once, at its strongest kind.** Without that, a body with a confirmed species
 * would also be counted as a genus hit and a signal, and every sector would look three times as
 * populated as it is. {@link foldBodyEvidence} is where that collapse happens.
 *
 * **A species the app cannot gate contributes no `predicted` count.** Sinuous Tubers, Electricae
 * radialem, Brain Trees and Amphora carry conditions the matcher cannot evaluate (§7.11), so
 * predicting them anywhere would invent confidence the app refuses everywhere else. Their
 * `confirmed` and `genus` counts are still real and still drawn — an observation is a fact whether
 * or not we could have predicted it.
 */
import { sectorCellFromCoords, sectorCellKey, type SectorCell } from "./sectorName.js";

/** Ordered weakest to strongest; the index is the precedence. */
export const EVIDENCE_KINDS = ["predicted", "signal", "genus", "confirmed"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export function strongerEvidence(a: EvidenceKind, b: EvidenceKind): EvidenceKind {
  return EVIDENCE_KINDS.indexOf(a) >= EVIDENCE_KINDS.indexOf(b) ? a : b;
}

/** One body's worth of evidence about one species or genus. */
export interface BodyEvidence {
  /** The system's position — the only thing needed to place it. */
  x: number;
  y: number;
  z: number;
  /** `${systemId64}:${bodyId}` where known, else any stable per-body key. */
  bodyKey: string;
  /** Species id when known, otherwise the genus key. */
  taxon: string;
  kind: EvidenceKind;
}

export interface SectorSpeciesCounts {
  confirmed: number;
  genus: number;
  signal: number;
  predicted: number;
  /** Distinct bodies behind the counts — the sum of the four, and the number to show. */
  bodies: number;
}

export interface SectorAggregateEntry {
  cell: SectorCell;
  cellKey: string;
  taxon: string;
  counts: SectorSpeciesCounts;
}

const emptyCounts = (): SectorSpeciesCounts => ({
  confirmed: 0,
  genus: 0,
  signal: 0,
  predicted: 0,
  bodies: 0,
});

/**
 * Collapse many observations of the same body to the strongest one.
 *
 * A body legitimately produces several rows — a signal count from the FSS, a genus from the DSS, a
 * species from the codex — and all three describe one dot on the map.
 */
export function foldBodyEvidence(evidence: Iterable<BodyEvidence>): Map<string, BodyEvidence> {
  const best = new Map<string, BodyEvidence>();
  for (const e of evidence) {
    const key = `${e.bodyKey}::${e.taxon}`;
    const prev = best.get(key);
    if (!prev) best.set(key, e);
    else if (strongerEvidence(e.kind, prev.kind) === e.kind && e.kind !== prev.kind) best.set(key, e);
  }
  return best;
}

/**
 * Aggregate body evidence into per-sector, per-taxon counts.
 *
 * Pure and source-agnostic: the corpus, the EDDN register and a Spansh export all reduce to
 * {@link BodyEvidence} first, so adding a source later changes nothing here.
 */
export function aggregateBySector(evidence: Iterable<BodyEvidence>): SectorAggregateEntry[] {
  const folded = foldBodyEvidence(evidence);
  const out = new Map<string, SectorAggregateEntry>();

  for (const e of folded.values()) {
    const cell = sectorCellFromCoords(e.x, e.y, e.z);
    const cellKey = sectorCellKey(cell);
    const key = `${cellKey}::${e.taxon}`;
    let entry = out.get(key);
    if (!entry) {
      entry = { cell, cellKey, taxon: e.taxon, counts: emptyCounts() };
      out.set(key, entry);
    }
    entry.counts[e.kind] += 1;
    entry.counts.bodies += 1;
  }

  return [...out.values()];
}

/** The colour a marker takes: the strongest evidence present in that sector for that taxon. */
export function markerKind(counts: SectorSpeciesCounts): EvidenceKind | null {
  if (counts.confirmed > 0) return "confirmed";
  if (counts.genus > 0) return "genus";
  if (counts.signal > 0) return "signal";
  if (counts.predicted > 0) return "predicted";
  return null;
}

export interface SectorSummary {
  entries: number;
  sectors: number;
  taxa: number;
  totals: SectorSpeciesCounts;
  /** Sectors whose strongest evidence is each kind — what the map will actually look like. */
  byMarker: Record<EvidenceKind, number>;
}

export function summariseAggregate(entries: readonly SectorAggregateEntry[]): SectorSummary {
  const totals = emptyCounts();
  const byMarker: Record<EvidenceKind, number> = { confirmed: 0, genus: 0, signal: 0, predicted: 0 };
  const sectors = new Set<string>();
  const taxa = new Set<string>();

  for (const e of entries) {
    sectors.add(e.cellKey);
    taxa.add(e.taxon);
    for (const k of EVIDENCE_KINDS) totals[k] += e.counts[k];
    totals.bodies += e.counts.bodies;
    const m = markerKind(e.counts);
    if (m) byMarker[m] += 1;
  }

  return { entries: entries.length, sectors: sectors.size, taxa: taxa.size, totals, byMarker };
}
