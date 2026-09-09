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
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SECTOR_ORIGIN,
  SECTOR_SIZE_LY,
  sectorCellFromCoords,
  sectorCellKey,
} from "@shared/sectorName.js";
import type { BacklogMapDTO, BacklogSystemDTO } from "@shared/types";
import { regionSpanInCells } from "./regionBackdrop";
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

export interface CommanderPosition {
  position: { x: number; y: number; z: number } | null;
  system: string | null;
}

export function GalaxySectorMap({
  file,
  commander,
  backdrop,
  backlog,
}: {
  file: SectorMapFile;
  commander?: CommanderPosition | null;
  /** The galaxy image, painted once by the screen above. Null while it loads, or on a build without it. */
  backdrop?: string | null;
  /** Unfinished business, rolled up to systems. Null on a build with no journal store. */
  backlog?: BacklogMapDTO | null;
}) {
  /**
   * Genus and species are two pickers, not one.
   *
   * The single list held 103 entries mixing both, sorted alphabetically, so choosing "tussock
   * ignis" meant scrolling past every Bacterium. `genus` narrows the second list; `taxon` is the
   * exact taxon or "" for "every species in this genus".
   */
  const [genus, setGenus] = useState<string>("");
  const [taxon, setTaxon] = useState<string>("");
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<SectorMapCell | null>(null);
  const [openCell, setOpenCell] = useState<SectorMapCell | null>(null);
  /**
   * Minimum floor for a system to appear on the backlog layer, in credits. 0 shows every one.
   *
   * The same steps the backlog panel uses, for the same reason: the question is "what is worth a
   * detour", which is answered in orders of magnitude rather than exact credits.
   */
  const [minCr, setMinCr] = useState(0);

  const taxa = useMemo(() => allTaxa(file), [file]);

  const shownBacklog = useMemo(
    () => (backlog?.systems ?? []).filter((s) => s.floorCr >= minCr),
    [backlog, minCr],
  );

  /** Genus for a taxon, from the file. Falls back to the taxon itself for an older map file. */
  const genusOf = useCallback(
    (t: string): string => file.taxonGenus?.[t] ?? t,
    [file],
  );

  const genera = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of taxa) {
      const g = genusOf(t);
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [taxa, genusOf]);

  /**
   * The species of the chosen genus.
   *
   * A genus whose only taxon *is* the genus — Bark Mounds, or a bare `bacterial` signal row — has
   * nothing to choose between, so the second picker disables itself rather than offering one option
   * that changes nothing.
   */
  const speciesOfGenus = useMemo(
    () => (genus ? taxa.filter((t) => genusOf(t) === genus && t !== genus) : []),
    [taxa, genus, genusOf],
  );

  /**
   * What the map is actually filtered by: one taxon, a whole genus, or everything.
   *
   * `undefined` means no filter at all. A genus with no species selected passes the set of its
   * taxa, which is what makes "show me all Tussock" work without a taxon per option.
   */
  const filterTaxa = useMemo<ReadonlySet<string> | undefined>(() => {
    if (taxon) return new Set([taxon]);
    if (genus) return new Set(taxa.filter((t) => genusOf(t) === genus));
    return undefined;
  }, [taxon, genus, taxa, genusOf]);

  /** Cells that have something to show for the current filter, with their totals. */
  const shown = useMemo(() => {
    const rows: { cell: SectorMapCell; totals: ReturnType<typeof cellTotals>; kind: Kind }[] = [];
    for (const cell of file.cells) {
      const totals = cellTotals(cell, filterTaxa);
      const kind = strongestKind(totals);
      if (!kind || totals.bodies === 0) continue;
      rows.push({ cell, totals, kind });
    }
    return rows;
  }, [file, filterTaxa]);

  const maxBodies = useMemo(() => Math.max(1, ...shown.map((r) => r.totals.bodies)), [shown]);

  /**
   * The commander, in cell coordinates.
   *
   * The plots are drawn in grid indices, not light years, so the position is converted once here
   * rather than in both projections. Fractional on purpose — a marker snapped to the cell centre
   * would sit up to 640 ly from where the ship actually is.
   */
  const commanderCell = useMemo(() => {
    const p = commander?.position;
    if (!p) return null;
    const cell = sectorCellFromCoords(p.x, p.y, p.z);
    return {
      x: (p.x - SECTOR_ORIGIN.x) / SECTOR_SIZE_LY,
      y: (p.y - SECTOR_ORIGIN.y) / SECTOR_SIZE_LY,
      z: (p.z - SECTOR_ORIGIN.z) / SECTOR_SIZE_LY,
      key: sectorCellKey(cell),
      system: commander?.system ?? null,
    };
  }, [commander]);

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
          Genus
          <select
            value={genus}
            onChange={(e) => {
              setGenus(e.target.value);
              // The old species no longer belongs to the new genus, so it cannot stay selected.
              setTaxon("");
            }}
          >
            <option value="">Every genus ({genera.length})</option>
            {genera.map(([g, n]) => (
              <option key={g} value={g}>
                {g === "*" ? "biology, unidentified" : g}
                {n > 1 ? ` (${n})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Species
          <select
            value={taxon}
            disabled={!genus || speciesOfGenus.length === 0}
            onChange={(e) => setTaxon(e.target.value)}
          >
            <option value="">
              {!genus
                ? "pick a genus first"
                : speciesOfGenus.length === 0
                  ? "no species under this genus"
                  : `All ${genus} (${speciesOfGenus.length})`}
            </option>
            {speciesOfGenus.map((t) => (
              <option key={t} value={t}>
                {/* The genus is already the other picker; repeating it wastes the width. */}
                {t.startsWith(`${genus} `) ? t.slice(genus.length + 1) : t}
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
        {backlog && backlog.systems.length > 0 ? (
          <label className="galaxy-map__backlog-filter">
            Unfinished worth at least
            <select value={minCr} onChange={(e) => setMinCr(Number(e.target.value))}>
              <option value={0}>anything</option>
              <option value={10e6}>10 M</option>
              <option value={20e6}>20 M</option>
              <option value={50e6}>50 M</option>
              <option value={100e6}>100 M</option>
            </select>
            <span className="galaxy-map__count">
              {shownBacklog.length} system{shownBacklog.length === 1 ? "" : "s"}
              {backlog.unplaceable > 0 ? (
                <span
                  className="dim"
                  title="These systems are in the backlog but no journal ever recorded their position, so nothing can place them on the map."
                >
                  {" "}
                  · {backlog.unplaceable} unplaceable
                </span>
              ) : null}
            </span>
          </label>
        ) : null}
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
            commander={commanderCell}
            backdrop={backdrop ?? null}
            backlog={shownBacklog}
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
  commander,
  backdrop,
  backlog,
}: {
  projection: Projection;
  rows: { cell: SectorMapCell; totals: ReturnType<typeof cellTotals>; kind: Kind }[];
  maxBodies: number;
  highlight: SectorMapCell | null;
  onHover: (c: SectorMapCell | null) => void;
  onOpen: (c: SectorMapCell) => void;
  commander: { x: number; y: number; z: number; key: string; system: string | null } | null;
  /** The galaxy image, as a data URL. Top projection only — the region map has no y axis. */
  backdrop: string | null;
  /** Backlog systems already filtered by the caller's minimum. */
  backlog: BacklogSystemDTO[];
}) {
  /*
   * The region map is a plane map: y was discarded when it was built, so there is nothing to draw
   * behind the edge-on view. Asking for it there would silently place a top-down galaxy against a
   * vertical axis, which would look like data.
   */
  const showBackdrop = backdrop != null && projection.id === "top";
  const span = regionSpanInCells(SECTOR_SIZE_LY);
  /*
   * Two framings, and which one is right depends on whether the galaxy is drawn.
   *
   * Without a backdrop, fitting to the data keeps a small corpus legible instead of a dot in the
   * corner. With one, the whole galaxy has to be in frame or the backdrop is a meaningless crop —
   * and seeing the data as a small cluster inside the galaxy is the entire point of drawing it.
   */
  const bounds = useMemo(() => {
    if (showBackdrop) return { minX: 0, maxX: span, minY: 0, maxY: span };
    if (rows.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    const xs = rows.map((r) => projection.ax(r.cell));
    const ys = rows.map((r) => projection.ay(r.cell));
    // The ship may be well outside the sampled corpus. Stretching the view to include it beats
    // drawing it off-canvas, which would silently look like "no position".
    if (commander) {
      xs.push(projection.ax(commander as unknown as SectorMapCell));
      ys.push(projection.ay(commander as unknown as SectorMapCell));
    }
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  }, [rows, projection, commander, showBackdrop, span]);

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
        {showBackdrop && backdrop ? (
          /*
           * The galaxy, under everything else. `preserveAspectRatio="none"` because the two axes are
           * already scaled independently by sx/sy to fill the plot, and letting the image keep its
           * own square aspect would put it out of register with the markers drawn over it.
           */
          <image
            href={backdrop}
            x={sx(0)}
            y={sy(span)}
            width={sx(span) - sx(0)}
            height={sy(0) - sy(span)}
            preserveAspectRatio="none"
            className="galaxy-map__backdrop"
          />
        ) : null}
        <text x={VIEW_W - PAD} y={VIEW_H - 8} className="galaxy-map__axis" textAnchor="end">
          {projection.axisLabel[0]}
        </text>
        <text x={8} y={PAD} className="galaxy-map__axis">
          {projection.axisLabel[1]}
        </text>
        {rows.map(({ cell, totals, kind }) => {
          const r = 2 + 7 * Math.cbrt(totals.bodies / maxBodies);
          const isHit = highlight?.key === cell.key;
          /*
           * Outlined, not filled, once there is a galaxy behind them.
           *
           * A filled marker over the backdrop hides the region it sits in, which is the one thing
           * the backdrop was added to show. Hollow keeps both readable, and the evidence colour
           * moves to the stroke where it still reads at this size. Without a backdrop the original
           * filled form is kept: on a flat background hollow markers are harder to see, not easier.
           */
          const hollow = showBackdrop || !KIND_FILLED[kind];
          return (
            <circle
              key={cell.key}
              cx={sx(projection.ax(cell))}
              cy={sy(projection.ay(cell))}
              r={r}
              fill={hollow ? "none" : KIND_COLOUR[kind]}
              fillOpacity={hollow ? 1 : 0.75}
              stroke={isHit ? "#f0f6fc" : hollow ? KIND_COLOUR[kind] : "none"}
              strokeWidth={isHit ? 2 : hollow ? 1.5 : 0}
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
        {/*
          The backlog: systems holding biology this commander found and never collected.

          Drawn after the sector markers and before the commander, so it reads as a layer over the
          survey rather than part of it — these are targets, not evidence. One dot per system, sized
          by how many unfinished bodies it holds, because a system with four is worth one trip.

          Amber, which no evidence kind uses: green/blue/grey already mean confirmed/possible/
          predicted on this map, and a fifth shade of those would read as a fifth kind of evidence.
        */}
        {backlog.length > 0 ? (
          <g className="galaxy-map__backlog">
            {backlog.map((s) => {
              const cell = sectorCellFromCoords(s.x, s.y, s.z);
              return (
                <circle
                  key={s.systemAddress}
                  cx={sx(projection.ax(cell as unknown as SectorMapCell))}
                  cy={sy(projection.ay(cell as unknown as SectorMapCell))}
                  r={2 + Math.min(3, Math.cbrt(s.bodies))}
                  className={
                    s.allVerified ? "galaxy-map__target" : "galaxy-map__target galaxy-map__target--unverified"
                  }
                >
                  <title>
                    {[
                      `${s.starSystem} — ${s.bodies} unfinished ${s.bodies === 1 ? "body" : "bodies"}`,
                      `floor ${Math.round(s.floorCr).toLocaleString("en-US")} CR at 5×`,
                      ...(s.allVerified ? [] : ["footfall never reported — not confirmed"]),
                    ].join(`
`)}
                  </title>
                </circle>
              );
            })}
          </g>
        ) : null}
        {commander ? (
          <g
            transform={`translate(${sx(projection.ax(commander as unknown as SectorMapCell))}, ${sy(
              projection.ay(commander as unknown as SectorMapCell),
            )})`}
            className="galaxy-map__you"
          >
            {/* A cross, not a dot: at a glance it must not be mistaken for a sector marker, and it
                stays legible on top of one. Drawn last so a dense sector never hides the ship. */}
            <line x1={-7} y1={0} x2={7} y2={0} />
            <line x1={0} y1={-7} x2={0} y2={7} />
            <circle r={4} fill="none" />
            <title>{`You are here — ${commander.system ?? "unknown system"} (cell ${commander.key})`}</title>
          </g>
        ) : null}
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
