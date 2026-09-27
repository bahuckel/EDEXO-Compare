/**
 * The sector map's side panels: the sector under the pointer, its systems, and one system's readout. Split out of GalaxySectorMap.tsx (code review D, 2026-09-27).
 */
import { CopySystemButton } from "./CopySystemButton";
import {
  CommanderCell,
  KIND_COLOUR,
  KIND_FILLED,
  PAD,
  evidenceSummary,
  strongestKind,
} from "./galaxySectorShared";
import { SectorMapCell, SectorSystem, cellTotals, systemTotals } from "@shared/sectorMapFile.js";
import { useEffect, useMemo, useState } from "react";

export function SectorReadout({ cell, taxon }: { cell: SectorMapCell | null; taxon: string }) {
  if (!cell) {
    return (
      <p className="galaxy-map__readout galaxy-map__readout--empty">Hover a sector, or search for one.</p>
    );
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
export function SectorSystems({
  cell,
  taxon,
  commander,
  onClose,
}: {
  cell: SectorMapCell;
  taxon: string;
  /** The ship, when it is inside *this* cell. Null otherwise — the caller decides. */
  commander: CommanderCell | null;
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
    const xs = shown.map((r) => r.system.x);
    const zs = shown.map((r) => r.system.z);
    /*
     * The ship stretches the frame the same way it does on the galaxy plot.
     *
     * A sector is 1 280 ly across and the recorded systems in it can sit in one corner, so fitting
     * to them alone can put the commander off-canvas — which reads as "no position" rather than as
     * "outside this crop". A cell holding nothing recorded at all still frames the ship.
     */
    if (commander) {
      xs.push(commander.ly.x);
      zs.push(commander.ly.z);
    }
    if (xs.length === 0) return { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  }, [shown, commander]);

  const W = 520;
  const H = 300;
  const sx = (v: number) =>
    PAD + ((v - bounds.minX) / Math.max(1, bounds.maxX - bounds.minX)) * (W - PAD * 2);
  const sy = (v: number) =>
    H - PAD - ((v - bounds.minZ) / Math.max(1, bounds.maxZ - bounds.minZ)) * (H - PAD * 2);

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
        <p className="galaxy-map__more">No systems here for that selection{taxon ? ` (${taxon})` : ""}.</p>
      ) : null}

      {/*
        A sector with the ship in it and nothing recorded still has something to say: where you are.
        Without this the panel answered "no systems here for that selection" and stopped, which is
        true and useless.
      */}
      {systems && shown.length === 0 && commander ? (
        <p className="galaxy-map__more">
          You are here — {commander.system ?? "unknown system"}
          <CopySystemButton system={commander.system} />.
        </p>
      ) : null}

      {shown.length > 0 ? (
        <>
          <p className="galaxy-map__more">
            {shown.length} system{shown.length === 1 ? "" : "s"} · top-down (X / Z) within the sector
            {commander ? " · your ship marked" : ""}
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
            {/*
              The ship, inside the sector.

              The galaxy plot can only say which 1 280 ly box you are in; this is the one view where
              "where you are in the sector" is a question with an answer, and the commander asked for
              it. Same cross as the galaxy plot so the two read as one mark, and `pointer-events:
              none` so it never takes a click from a system underneath it.
            */}
            {commander ? (
              <g
                transform={`translate(${sx(commander.ly.x)}, ${sy(commander.ly.z)})`}
                className="galaxy-map__you"
                pointerEvents="none"
              >
                <line x1={-7} y1={0} x2={7} y2={0} strokeWidth={1.5} />
                <line x1={0} y1={-7} x2={0} y2={7} strokeWidth={1.5} />
                <circle r={4} fill="none" strokeWidth={1.5} />
              </g>
            ) : null}
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
        {/* Click a system in the sector to pin it; the name and its copy stay while you move off. */}
        <CopySystemButton system={system.name} />
        {pinned ? <span className="galaxy-map__cellkey"> pinned — click another to change</span> : null}
      </h4>
      <p>
        {bodies.length} bod{bodies.length === 1 ? "y" : "ies"} with something recorded · found, not predicted
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
      {bodies.length === 0 ? <p className="galaxy-map__more">No bodies here match that selection.</p> : null}
    </div>
  );
}
