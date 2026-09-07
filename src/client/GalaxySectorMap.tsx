/**
 * The galaxy sector map — INCLUDE-BODY-IDS Phase 10, step 3.
 *
 * Two orthographic projections of the same sectors: **top** (X, Z) looking down on the galactic
 * plane, and **side** (X, Y) looking edge-on. No camera, no perspective, no WebGL — the owner asked
 * for flat views, and 104 markers today (a few thousand at galaxy scale) is well inside what SVG
 * draws without help. That also keeps the app's two runtime dependencies where they are.
 *
 * ## What a marker is, and what it deliberately is not
 *
 * One marker per sector: a 1280 ly grid cell, which is a true partition of space (§10.1a). Its
 * colour is the **strongest** evidence in that sector, never the commonest — one confirmed sighting
 * among ninety-nine bare signals still makes it a confirmed sector, because the confirmation is the
 * fact and the signals are the guesses.
 *
 * Size follows the count, but through a **cube root**, not linearly. The densest cell holds 883
 * bodies of one species and the thinnest holds one; a linear radius would make everything except the
 * bubble invisible, and an area-proportional circle would do the same. The cube root keeps a
 * one-body sector visible while still reading the bubble as dense, and it is stated here because a
 * reader is entitled to know the scale is compressed.
 *
 * ## The bias is drawn on the map, not buried in a doc
 *
 * Density follows commander traffic. Sectors around Sol are saturated because that is where people
 * fly, not because that is where the plants are (§1.6, §10.6 rule 3). The legend says so on screen —
 * the owner already knows, a stranger reading a bright bubble does not.
 */
import { useMemo, useState } from "react";
import {
  allTaxa,
  cellTotals,
  type SectorMapCell,
  type SectorMapFile,
} from "@shared/sectorMapFile.js";

/** Strongest-first, and the order the legend reads in. */
const KINDS = ["confirmed", "genus", "signal", "predicted"] as const;
type Kind = (typeof KINDS)[number];

const KIND_COLOUR: Record<Kind, string> = {
  // Green for a fact, blue for a possibility — the owner's own choice.
  confirmed: "#3fb950",
  genus: "#58a6ff",
  signal: "#388bfd",
  predicted: "#8b949e",
};

const KIND_LABEL: Record<Kind, string> = {
  confirmed: "Confirmed — species identified here",
  genus: "Genus known, species not",
  signal: "Biological signal, nobody has looked",
  predicted: "Conditions match, no signal seen",
};

function strongestKind(t: ReturnType<typeof cellTotals>): Kind | null {
  if (t.confirmed > 0) return "confirmed";
  if (t.genus > 0) return "genus";
  if (t.signal > 0) return "signal";
  if (t.predicted > 0) return "predicted";
  return null;
}

interface Projection {
  id: "top" | "side";
  label: string;
  hint: string;
  /** Cell → plot axes. Cell indices, not light years: the grid is what we draw. */
  ax: (c: SectorMapCell) => number;
  ay: (c: SectorMapCell) => number;
  axisLabel: [string, string];
}

const PROJECTIONS: Projection[] = [
  {
    id: "top",
    label: "Top (X / Z)",
    hint: "Looking down on the galactic plane. Sol sits near the middle-right; the core is far to the galactic north.",
    ax: (c) => c.x,
    ay: (c) => c.z,
    axisLabel: ["X →", "Z ↑"],
  },
  {
    id: "side",
    label: "Side (X / Y)",
    hint: "Edge-on. The galaxy is thin — most sectors sit within a few cells of the plane.",
    ax: (c) => c.x,
    ay: (c) => c.y,
    axisLabel: ["X →", "Y ↑"],
  },
];

const VIEW_W = 520;
const VIEW_H = 380;
const PAD = 28;

export function GalaxySectorMap({ file }: { file: SectorMapFile }) {
  const [taxon, setTaxon] = useState<string>("");
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<SectorMapCell | null>(null);

  const taxa = useMemo(() => allTaxa(file), [file]);

  /** Cells that have something to show for the current filter, with their totals. */
  const shown = useMemo(() => {
    const rows: { cell: SectorMapCell; totals: ReturnType<typeof cellTotals>; kind: Kind }[] = [];
    for (const cell of file.cells) {
      const totals = cellTotals(cell, taxon || undefined);
      const kind = strongestKind(totals);
      if (!kind || totals.bodies === 0) continue;
      rows.push({ cell, totals, kind });
    }
    return rows;
  }, [file, taxon]);

  const maxBodies = useMemo(() => Math.max(1, ...shown.map((r) => r.totals.bodies)), [shown]);

  const searchHit = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return (
      file.cells.find((c) => (c.name ?? c.key).toLowerCase() === q) ??
      file.cells.find((c) => (c.name ?? c.key).toLowerCase().includes(q)) ??
      null
    );
  }, [file, query]);

  return (
    <div className="galaxy-map">
      <div className="galaxy-map__controls">
        <label>
          Species / genus
          <select value={taxon} onChange={(e) => setTaxon(e.target.value)}>
            <option value="">Everything ({taxa.length} taxa)</option>
            {taxa.map((t) => (
              <option key={t} value={t}>
                {t === "*" ? "biology, unidentified" : t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Find a sector
          <input
            type="search"
            value={query}
            placeholder="Wregoe, Synuefai…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <span className="galaxy-map__count">
          {shown.length} sector{shown.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="galaxy-map__views">
        {PROJECTIONS.map((p) => (
          <SectorPlot
            key={p.id}
            projection={p}
            rows={shown}
            maxBodies={maxBodies}
            highlight={searchHit}
            onHover={setHover}
          />
        ))}
      </div>

      <SectorReadout cell={hover ?? searchHit} taxon={taxon} />

      <ul className="galaxy-map__legend">
        {KINDS.map((k) => (
          <li key={k}>
            <span className="galaxy-map__swatch" style={{ background: KIND_COLOUR[k] }} aria-hidden="true" />
            {KIND_LABEL[k]}
          </li>
        ))}
      </ul>

      <p className="galaxy-map__caveat">
        Marker size is the cube root of the body count, so a single sighting stays visible next to a
        sector holding hundreds. <strong>Density follows commander traffic</strong> — the bright
        region around Sol is where people fly, not where the plants are.
      </p>
    </div>
  );
}

function SectorPlot({
  projection,
  rows,
  maxBodies,
  highlight,
  onHover,
}: {
  projection: Projection;
  rows: { cell: SectorMapCell; totals: ReturnType<typeof cellTotals>; kind: Kind }[];
  maxBodies: number;
  highlight: SectorMapCell | null;
  onHover: (c: SectorMapCell | null) => void;
}) {
  // The grid spans roughly 0..78 cells on each axis; fitting to the data rather than the whole
  // galaxy keeps a small corpus legible instead of a dot in the corner.
  const bounds = useMemo(() => {
    if (rows.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    const xs = rows.map((r) => projection.ax(r.cell));
    const ys = rows.map((r) => projection.ay(r.cell));
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  }, [rows, projection]);

  const sx = (v: number) =>
    PAD + ((v - bounds.minX) / Math.max(1, bounds.maxX - bounds.minX)) * (VIEW_W - PAD * 2);
  // SVG y grows downward; the galaxy's does not.
  const sy = (v: number) =>
    VIEW_H - PAD - ((v - bounds.minY) / Math.max(1, bounds.maxY - bounds.minY)) * (VIEW_H - PAD * 2);

  return (
    <figure className="galaxy-map__plot">
      <figcaption>
        {projection.label}
        <span className="galaxy-map__hint">{projection.hint}</span>
      </figcaption>
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={`${projection.label} sector map`}>
        <rect x={0} y={0} width={VIEW_W} height={VIEW_H} className="galaxy-map__bg" />
        <text x={VIEW_W - PAD} y={VIEW_H - 8} className="galaxy-map__axis" textAnchor="end">
          {projection.axisLabel[0]}
        </text>
        <text x={8} y={PAD} className="galaxy-map__axis">
          {projection.axisLabel[1]}
        </text>
        {rows.map(({ cell, totals, kind }) => {
          const r = 2 + 7 * Math.cbrt(totals.bodies / maxBodies);
          const isHit = highlight?.key === cell.key;
          return (
            <circle
              key={cell.key}
              cx={sx(projection.ax(cell))}
              cy={sy(projection.ay(cell))}
              r={r}
              fill={KIND_COLOUR[kind]}
              fillOpacity={0.75}
              stroke={isHit ? "#f0f6fc" : "none"}
              strokeWidth={isHit ? 2 : 0}
              onMouseEnter={() => onHover(cell)}
              onMouseLeave={() => onHover(null)}
            >
              {/* A native title is the cheapest hover label and it works on touch and for readers. */}
              <title>{`${cell.name ?? cell.key} — ${totals.bodies} bodies`}</title>
            </circle>
          );
        })}
      </svg>
    </figure>
  );
}

function SectorReadout({ cell, taxon }: { cell: SectorMapCell | null; taxon: string }) {
  if (!cell) {
    return <p className="galaxy-map__readout galaxy-map__readout--empty">Hover a sector, or search for one.</p>;
  }
  const totals = cellTotals(cell, taxon || undefined);
  const matching = Object.entries(cell.taxa).filter(([t]) => !taxon || t === taxon);
  const rows = matching
    .map(([t, v]) => ({ taxon: t, confirmed: v[0] ?? 0, genus: v[1] ?? 0, signal: v[2] ?? 0 }))
    .sort((a, b) => b.confirmed + b.genus + b.signal - (a.confirmed + a.genus + a.signal))
    .slice(0, 8);
  // Count the overflow against what the filter actually shows. Counting every taxon here claimed
  // "…and 79 more" on a sector that held none of the selected species.
  const hidden = matching.length - rows.length;

  return (
    <div className="galaxy-map__readout">
      <h4>
        {cell.name ?? cell.key}
        {cell.name ? <span className="galaxy-map__cellkey"> cell {cell.key}</span> : null}
      </h4>
      <p>
        {totals.confirmed} confirmed · {totals.genus} genus only · {totals.signal} signal only
        {totals.predicted ? ` · ${totals.predicted} predicted` : ""}
      </p>
      <ul>
        {rows.map((r) => (
          <li key={r.taxon}>
            <span>{r.taxon === "*" ? "biology, unidentified" : r.taxon}</span>
            <span>{r.confirmed + r.genus + r.signal}</span>
          </li>
        ))}
      </ul>
      {rows.length === 0 ? (
        <p className="galaxy-map__more">Nothing recorded here for that selection.</p>
      ) : null}
      {hidden > 0 ? <p className="galaxy-map__more">…and {hidden} more here</p> : null}
    </div>
  );
}
