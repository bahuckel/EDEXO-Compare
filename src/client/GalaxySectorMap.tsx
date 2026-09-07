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
import { useEffect, useMemo, useState } from "react";
import {
  allTaxa,
  cellTotals,
  systemTotals,
  type SectorMapCell,
  type SectorMapFile,
  type SectorSystem,
} from "@shared/sectorMapFile.js";

/** Strongest-first, and the order the legend reads in. */
const KINDS = ["confirmed", "genus", "signal", "predicted"] as const;
type Kind = (typeof KINDS)[number];

const KIND_COLOUR: Record<Kind, string> = {
  // Green for a fact, blue for a possibility — the owner's own choice.
  confirmed: "#3fb950",
  genus: "#58a6ff",
  signal: "#58a6ff",
  predicted: "#8b949e",
};

/**
 * `signal` is drawn **hollow** rather than in a fourth hue.
 *
 * Genus and signal are both "blue" in the owner's scheme, and two blues a shade apart are the kind of
 * distinction that survives a design review and fails on a real monitor at a glance. Filled versus
 * outlined separates them by shape as well as colour, which also survives colour blindness — and it
 * carries the meaning: a hollow marker is a body nobody has opened.
 */
const KIND_FILLED: Record<Kind, boolean> = {
  confirmed: true,
  genus: true,
  signal: false,
  predicted: false,
};

const KIND_LABEL: Record<Kind, string> = {
  confirmed: "Confirmed — species identified here",
  genus: "Genus known from a DSS, species not",
  signal: "Biological signal from the FSS, nobody has mapped it",
  predicted: "Conditions match, no signal seen",
};

/**
 * A kind the app **cannot compute yet**, as distinct from one that happens to be absent.
 *
 * `predicted` needs the matcher run across bodies the app has never seen, which needs the Spansh
 * galaxy export loaded at scale. Leaving it in the legend unqualified would tell a reader there are
 * no such bodies, when the truth is that we cannot say — the same absence-of-evidence trap the
 * tri-state flags and `predictionUnsupported` exist to avoid, appearing here as a legend entry.
 */
const KIND_UNAVAILABLE: Partial<Record<Kind, string>> = {
  predicted: "not computed yet — needs the galaxy export",
};

/** The owner's tooltip: confirmed, genus hits, FSS-only, in that order. */
function evidenceSummary(t: { confirmed: number; genus: number; signal: number; predicted: number }): string {
  const parts: string[] = [];
  if (t.confirmed) parts.push(`${t.confirmed} confirmed`);
  if (t.genus) parts.push(`${t.genus} genus-only`);
  if (t.signal) parts.push(`${t.signal} signal-only`);
  if (t.predicted) parts.push(`${t.predicted} predicted`);
  return parts.length > 0 ? parts.join(" · ") : "nothing recorded";
}

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
  const [openCell, setOpenCell] = useState<SectorMapCell | null>(null);

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
            onOpen={setOpenCell}
          />
        ))}
      </div>

      <SectorReadout cell={hover ?? openCell ?? searchHit} taxon={taxon} />

      {openCell ? (
        <SectorSystems cell={openCell} taxon={taxon} onClose={() => setOpenCell(null)} />
      ) : null}

      <ul className="galaxy-map__legend">
        {KINDS.map((k) => (
          <li key={k} className={KIND_UNAVAILABLE[k] ? "galaxy-map__legend--unavailable" : undefined}>
            <span
              className="galaxy-map__swatch"
              style={
                KIND_FILLED[k]
                  ? { background: KIND_COLOUR[k] }
                  : { background: "transparent", border: `2px solid ${KIND_COLOUR[k]}` }
              }
              aria-hidden="true"
            />
            {KIND_LABEL[k]}
            {KIND_UNAVAILABLE[k] ? <em> — {KIND_UNAVAILABLE[k]}</em> : null}
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
  onOpen,
}: {
  projection: Projection;
  rows: { cell: SectorMapCell; totals: ReturnType<typeof cellTotals>; kind: Kind }[];
  maxBodies: number;
  highlight: SectorMapCell | null;
  onHover: (c: SectorMapCell | null) => void;
  onOpen: (c: SectorMapCell) => void;
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
              fill={KIND_FILLED[kind] ? KIND_COLOUR[kind] : "none"}
              fillOpacity={KIND_FILLED[kind] ? 0.75 : 1}
              stroke={isHit ? "#f0f6fc" : KIND_FILLED[kind] ? "none" : KIND_COLOUR[kind]}
              strokeWidth={isHit ? 2 : KIND_FILLED[kind] ? 0 : 1.5}
              onMouseEnter={() => onHover(cell)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onOpen(cell)}
            >
              {/* A native title is the cheapest hover label and it works on touch and for readers. */}
              <title>{`${cell.name ?? cell.key} — ${totals.bodies} bodies
${evidenceSummary(totals)}`}</title>
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
      <p>{evidenceSummary(totals)}</p>
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

/**
 * A sector's systems, fetched on click — INCLUDE-BODY-IDS Phase 10, step 4.
 *
 * The systems file is 935 kB for 3,015 systems and grows with the corpus, so the client never
 * downloads it whole: it asks the server for the one cell it just clicked. Most sessions open the
 * galaxy view and never click, and this is what keeps them from paying for the drill-down.
 *
 * Positions are absolute light years within the sector, plotted top-down (X, Z) like the galaxy view
 * above it. A 1280 ly cell is small enough that a second projection would add nothing.
 */
function SectorSystems({
  cell,
  taxon,
  onClose,
}: {
  cell: SectorMapCell;
  taxon: string;
  onClose: () => void;
}) {
  const [systems, setSystems] = useState<SectorSystem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<SectorSystem | null>(null);
  /** Clicking pins a system so the body list survives the mouse leaving the dot. */
  const [pinned, setPinned] = useState<SectorSystem | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSystems(null);
    setError(null);
    setHover(null);
    setPinned(null);
    fetch(`/api/sector-systems?cell=${encodeURIComponent(cell.key)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { systems: SectorSystem[] };
      })
      .then((d) => {
        if (!cancelled) setSystems(d.systems);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [cell.key]);

  // Only systems that have something for the current filter — clicking a sector while filtered to
  // one species should not show every system in it.
  const shown = useMemo(() => {
    if (!systems) return [];
    return systems
      .map((s) => ({ system: s, totals: systemTotals(s, taxon || undefined) }))
      .filter((r) => r.totals.bodies > 0);
  }, [systems, taxon]);

  const bounds = useMemo(() => {
    if (shown.length === 0) return { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
    const xs = shown.map((r) => r.system.x);
    const zs = shown.map((r) => r.system.z);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  }, [shown]);

  const W = 520;
  const H = 300;
  const sx = (v: number) => PAD + ((v - bounds.minX) / Math.max(1, bounds.maxX - bounds.minX)) * (W - PAD * 2);
  const sy = (v: number) => H - PAD - ((v - bounds.minZ) / Math.max(1, bounds.maxZ - bounds.minZ)) * (H - PAD * 2);

  return (
    <section className="sector-systems">
      <header>
        <h3>
          {cell.name ?? cell.key}
          <span className="galaxy-map__cellkey"> cell {cell.key}</span>
        </h3>
        <button type="button" onClick={onClose} aria-label="Close sector view">
          Close
        </button>
      </header>

      {error ? <p className="galaxy-map__more">Could not load systems: {error}</p> : null}
      {!systems && !error ? <p className="galaxy-map__more">Loading systems…</p> : null}

      {systems && shown.length === 0 ? (
        <p className="galaxy-map__more">
          No systems here for that selection{taxon ? ` (${taxon})` : ""}.
        </p>
      ) : null}

      {shown.length > 0 ? (
        <>
          <p className="galaxy-map__more">
            {shown.length} system{shown.length === 1 ? "" : "s"} · top-down (X / Z) within the sector
          </p>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Systems in ${cell.name ?? cell.key}`}>
            <rect x={0} y={0} width={W} height={H} className="galaxy-map__bg" />
            {shown.map(({ system, totals }) => {
              const kind = strongestKind(totals) ?? "predicted";
              return (
                <circle
                  key={system.key}
                  cx={sx(system.x)}
                  cy={sy(system.z)}
                  r={2.5 + 4 * Math.cbrt(totals.bodies / Math.max(1, shown[0]!.totals.bodies))}
                  fill={KIND_FILLED[kind] ? KIND_COLOUR[kind] : "none"}
                  fillOpacity={KIND_FILLED[kind] ? 0.8 : 1}
                  stroke={
                    hover?.key === system.key ? "#f0f6fc" : KIND_FILLED[kind] ? "none" : KIND_COLOUR[kind]
                  }
                  strokeWidth={hover?.key === system.key ? 1.5 : KIND_FILLED[kind] ? 0 : 1.2}
                  onMouseEnter={() => setHover(system)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setPinned(system)}
                  style={{ cursor: "pointer" }}
                >
                  <title>{`${system.name} — ${totals.bodies} bodies
${evidenceSummary(totals)}`}</title>
                </circle>
              );
            })}
          </svg>
          <SystemReadout system={hover ?? pinned} taxon={taxon} pinned={pinned !== null && !hover} />
        </>
      ) : null}
    </section>
  );
}

/**
 * What one system holds, body by body — INCLUDE-BODY-IDS Phase 10, step 5.
 *
 * **This is history, not prediction, and the wording says so.** The app's own panel offers *candidate*
 * species for the system the commander is standing in, scored from a live scan. Nothing here can do
 * that for a system on the other side of the galaxy, because there is no scan to score — so a body
 * lists what was actually found and which kind of evidence found it. Presenting it as a forecast
 * would be inventing the one thing the map is not entitled to claim.
 */
function SystemReadout({
  system,
  taxon,
  pinned,
}: {
  system: SectorSystem | null;
  taxon: string;
  pinned: boolean;
}) {
  if (!system) {
    return (
      <p className="galaxy-map__readout galaxy-map__readout--empty">
        Hover a system for its bodies, or click one to keep it open.
      </p>
    );
  }

  const bodies = (system.bodies ?? []).filter(
    (b) => !taxon || b.species.includes(taxon) || b.genuses.includes(taxon) || taxon === "*",
  );

  return (
    <div className="galaxy-map__readout">
      <h4>
        {system.name}
        {pinned ? <span className="galaxy-map__cellkey"> pinned — click another to change</span> : null}
      </h4>
      <p>
        {bodies.length} bod{bodies.length === 1 ? "y" : "ies"} with something recorded · found, not
        predicted
      </p>
      <ul className="sector-systems__bodies">
        {bodies.map((b) => (
          <li key={b.name}>
            <strong>{b.name}</strong>
            <span>
              {b.species.length > 0 ? b.species.join(", ") : null}
              {b.species.length > 0 && b.genuses.length > 0 ? " · " : null}
              {b.genuses.length > 0 ? `${b.genuses.join(", ")} (genus only)` : null}
              {b.species.length === 0 && b.genuses.length === 0 && b.signal > 0
                ? `${b.signal} biological signal${b.signal === 1 ? "" : "s"}, nothing identified`
                : null}
            </span>
          </li>
        ))}
      </ul>
      {bodies.length === 0 ? (
        <p className="galaxy-map__more">No bodies here match that selection.</p>
      ) : null}
    </div>
  );
}
