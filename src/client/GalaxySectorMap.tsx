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
import { useCallback, useMemo, useState } from "react";
import { SECTOR_ORIGIN, SECTOR_SIZE_LY, sectorCellFromCoords, sectorCellKey } from "@shared/sectorName.js";
import type { BacklogMapDTO, BacklogSystemDTO } from "@shared/types";
import { TIER_ORDER, TIER_STYLE, tierFor, tierRank } from "@shared/galaxyTier";
import type { CommanderSectorsDTO } from "@shared/types";
import { CopySystemButton } from "./CopySystemButton";
import { MAX_CR, STEP_CR, sliderLabel, type GalaxySearchApplied } from "./GalaxySearchPanel";
import { groupByRegion, type LodRow, type RegionGroup } from "./galaxyLod";
import { regionIndexForCoords } from "@shared/regionMap.js";
import type { GalaxyImage, RegionMapPayload } from "./regionBackdrop";
import { allTaxa, cellTotals, type SectorMapCell, type SectorMapFile } from "@shared/sectorMapFile.js";
import { EMPTY_HITS, strongestKind, PROJECTIONS } from "./galaxySectorShared";
import type { Kind, CommanderPosition, CommanderCell } from "./galaxySectorShared";
import { SectorPlot } from "./GalaxySectorPlot";
import { SectorReadout, SectorSystems } from "./GalaxySectorReadouts";
import { fmtCrExact, fmtLy } from "@shared/format";
export type { CommanderPosition } from "./galaxySectorShared";

export function GalaxySectorMap({
  file,
  commander,
  backdrop,
  galaxyImage,
  backlog,
  commanderSectors,
  search,
  regionMap,
}: {
  file: SectorMapFile;
  commander?: CommanderPosition | null;
  /** The galaxy image, painted once by the screen above. Null while it loads, or on a build without it. */
  backdrop?: string | null;
  /** A photograph of the galaxy to put under the regions, where this machine has one. */
  galaxyImage?: GalaxyImage | null;
  /** Unfinished business, rolled up to systems. Null on a build with no journal store. */
  backlog?: BacklogMapDTO | null;
  /** This commander's own state per sector. Null while it loads or on a build with no journals. */
  commanderSectors?: CommanderSectorsDTO | null;
  /**
   * What the search above this map asked for, once it was asked (A3).
   *
   * This map used to own a genus and a species picker of its own, duplicating the search that lived
   * behind a magnifying glass in the app's top bar. They are one control now: the search names the
   * taxon and the systems, and the map draws both.
   */
  search?: GalaxySearchApplied | null;
  /**
   * The region map, as data rather than as a picture (A3).
   *
   * Null while it loads or on a build without it, in which case the map simply never groups: every
   * sector stays its own mark, exactly as before. A missing region map must cost detail, never
   * correctness.
   */
  regionMap?: RegionMapPayload | null;
}) {
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<SectorMapCell | null>(null);
  const [openCell, setOpenCell] = useState<SectorMapCell | null>(null);
  /**
   * The region whose sectors are listed below the plots, or null (A3).
   *
   * The owner's drill-down: *"clicking it opens that specific region's sectors below, and clicking
   * that sector shows all the systems in it"*. Three levels, each one a click into the last, and the
   * deepest was already built — {@link SectorSystems} has always listed a sector's systems.
   */
  const [openRegion, setOpenRegion] = useState<RegionGroup<SectorMapCell> | null>(null);
  /**
   * Minimum floor for a system to appear on the backlog layer, in credits. 0 shows every one.
   *
   * The same steps the backlog panel uses, for the same reason: the question is "what is worth a
   * detour", which is answered in orders of magnitude rather than exact credits.
   */
  const [minCr, setMinCr] = useState(0);

  const taxa = useMemo(() => allTaxa(file), [file]);

  /**
   * The backlog, filtered, with distances measured against the *polled* commander position.
   *
   * The server stamps a distance when the layer is fetched, and that fetch happens once — this
   * screen is meant to be left open on a second monitor while flying, so those numbers would age
   * out of usefulness exactly when the commander is using them. The position is already polled here
   * every 15 s and every system carries its own coordinates, so re-measuring is arithmetic.
   *
   * Falls back to the server's figure when there is no polled position, which is the honest answer
   * before the first jump of a session rather than a distance from the origin.
   */
  /** Keyed for the per-cell lookup the plot does once per marker. */
  const mine = useMemo(
    () => new Map((commanderSectors?.rows ?? []).map((r) => [r.key, r])),
    [commanderSectors],
  );

  const shownBacklog = useMemo(() => {
    const kept = (backlog?.systems ?? []).filter((s) => s.floorCr >= minCr);
    const p = commander?.position;
    if (!p) return kept;
    return kept.map((s) => {
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      const dz = p.z - s.z;
      return { ...s, distanceLy: Math.sqrt(dx * dx + dy * dy + dz * dz) };
    });
  }, [backlog, minCr, commander]);

  /**
   * The nearest system that clears the current minimum — "take me to the next one".
   *
   * A null distance means no journal recorded the commander's position, or the system's; either way
   * it is not a candidate for *nearest*, so it is skipped rather than treated as zero.
   */
  const nextTarget = useMemo(
    () =>
      shownBacklog.reduce<BacklogSystemDTO | null>(
        (best, s) =>
          s.distanceLy == null ? best : !best || s.distanceLy < (best.distanceLy ?? Infinity) ? s : best,
        null,
      ),
    [shownBacklog],
  );

  /** Genus for a taxon, from the file. Falls back to the taxon itself for an older map file. */
  const genusOf = useCallback((t: string): string => file.taxonGenus?.[t] ?? t, [file]);

  /**
   * The taxon the search named, if this map file has ever heard of it.
   *
   * The two sides speak different vocabularies: the galaxy index speaks species ids and genus
   * directories, this file speaks lowercase names — `"bacterium"`, `"bacterium aurasus"`. The
   * translation happens here because this is the side that holds the file, and only the file knows
   * which taxa actually appear in it.
   */
  const taxon = useMemo(() => {
    const want = search?.species;
    if (!want) return "";
    return taxa.find((t) => t === want) ?? "";
  }, [search, taxa]);

  /**
   * What the map is actually filtered by: one taxon, a whole genus, or everything.
   *
   * `undefined` means no filter at all. A genus with no species named passes the set of its taxa,
   * which is what makes "show me all Tussock" work without a taxon per option.
   *
   * A search for something this sector map has never recorded yields an **empty** set rather than
   * `undefined`: an honest "no sectors" beats quietly showing the whole galaxy, which would read as
   * "it is everywhere".
   */
  const filterTaxa = useMemo<ReadonlySet<string> | undefined>(() => {
    if (search?.species) return new Set(taxon ? [taxon] : []);
    if (search?.genus) return new Set(taxa.filter((t) => genusOf(t) === search.genus));
    return undefined;
  }, [search, taxon, taxa, genusOf]);

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
  const searchHitCount = search?.hits.length ?? 0;

  /**
   * The tier for each shown sector, computed once here instead of once per marker per projection.
   *
   * It moved up out of the plot because grouping needs it: a region can only be said to report the
   * same thing as its sectors if something has already decided what each sector reports. Both plots
   * read the same answer, which they should — the two projections are one dataset at two angles.
   */
  const lodRows = useMemo<LodRow<SectorMapCell>[]>(
    () =>
      shown.map(({ cell, totals }) => {
        const m = mine.get(cell.key);
        return {
          cell,
          /*
            A cell's coordinates are the floor of a division, so `12:0:34` is the box's *corner*,
            not a point. Drawing the aggregate there put every sector marker up to a full cell
            down-and-left of the space it describes, and the visible cost was the ship: the
            commander's cross is plotted from real coordinates, so it sat inside its own sector's
            box while that sector's marker sat at the corner — as much as 1 280 ly away, and never
            under the cross. Reported as "my location is not on the sector I am in".

            Half a cell puts the mark in the middle of what it stands for. It happens once, here,
            so both projections and the region centroids all agree about where a sector is.
          */
          x: cell.x + 0.5,
          y: cell.y + 0.5,
          z: cell.z + 0.5,
          bodies: totals.bodies,
          tier: tierFor({
            visited: m?.visited ?? false,
            scannedByYou: m?.scannedByYou ?? 0,
            unscannedByYou: m?.unscannedByYou ?? 0,
            confirmedElsewhere: totals.confirmed > 0 && (m?.scannedByYou ?? 0) === 0,
            genusKnown: totals.genus > 0,
            signals: totals.signal > 0,
            knownBodies: totals.bodies,
          }),
        };
      }),
    [shown, mine],
  );

  /**
   * Sectors collapsed into regions, for the zoomed-out view.
   *
   * Regions come from the same klightspeed map the backdrop is drawn from, so a group sits inside
   * the coloured area a reader can already see. A sector's region is looked up from the centre of
   * its box in light years — the map is a plane map, so only x and z are consulted.
   */
  const regionGroups = useMemo<RegionGroup<SectorMapCell>[] | null>(() => {
    if (!regionMap) return null;
    const names = regionMap.regions;
    return groupByRegion(lodRows, (r) => {
      const x = SECTOR_ORIGIN.x + r.x * SECTOR_SIZE_LY;
      const z = SECTOR_ORIGIN.z + r.z * SECTOR_SIZE_LY;
      const id = regionIndexForCoords(regionMap, x, z);
      return { id, name: names[id] ?? "" };
    });
  }, [lodRows, regionMap]);

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
    const out: CommanderCell = {
      x: (p.x - SECTOR_ORIGIN.x) / SECTOR_SIZE_LY,
      y: (p.y - SECTOR_ORIGIN.y) / SECTOR_SIZE_LY,
      z: (p.z - SECTOR_ORIGIN.z) / SECTOR_SIZE_LY,
      key: sectorCellKey(cell),
      system: commander?.system ?? null,
      ly: { x: p.x, y: p.y, z: p.z },
    };
    return out;
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
        {/*
          The genus and species pickers that stood here are the search panel's pickers now (A3).
          What is left is the one thing the search cannot do — go to a sector by name — and a line
          saying what the plot below is currently showing, since the control that decided it is no
          longer beside it.
        */}
        {search ? (
          <span className="galaxy-map__filter">
            Showing <strong>{search.label}</strong>
            {filterTaxa && filterTaxa.size === 0 ? (
              <span className="dim"> — no sector in this map has recorded it</span>
            ) : null}
          </span>
        ) : null}
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
        {/*
            A slider, not five fixed steps (A3). The owner asked for a price bar on this map and got
            one in the search modal instead, which he called redundant: *"the bar I asked for, for
            the price was the 'Unfinished worth at least' drop down INSIDE ?screen=map"*. Same range
            and step as the search's own slider — 0 to half a billion in millions — because the two
            controls now sit on one screen and reading differently would say they measure different
            things.
        */}
        {backlog && backlog.systems.length > 0 ? (
          <label className="galaxy-map__backlog-filter">
            Unfinished worth at least <strong>{sliderLabel(minCr)}</strong>
            <input
              type="range"
              className="galaxy-map__backlog-slider"
              min={0}
              max={MAX_CR}
              step={STEP_CR}
              value={minCr}
              onChange={(e) => setMinCr(Number(e.target.value))}
              aria-label="Minimum unfinished system value in credits"
            />
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

      {nextTarget ? (
        <div className="galaxy-map__next">
          <span className="galaxy-map__next-label">Nearest that qualifies</span>
          <strong>
            {nextTarget.starSystem}
            <CopySystemButton system={nextTarget.starSystem} />
          </strong>
          <span className="dim">
            {/*
              Under a light year is the same system: the commander is standing in it. "0 ly away"
              is arithmetically true and reads like a broken number.
            */}
            {nextTarget.distanceLy == null
              ? ""
              : nextTarget.distanceLy < 1
                ? "you are here"
                : `${fmtLy(nextTarget.distanceLy)} away`}
          </span>
          <span className="dim">
            {nextTarget.bodies} unfinished {nextTarget.bodies === 1 ? "body" : "bodies"} ·{" "}
            {fmtCrExact(nextTarget.floorCr)} floor
          </span>
        </div>
      ) : null}

      <div className="galaxy-map__views">
        {PROJECTIONS.map((p) => (
          <SectorPlot
            key={p.id}
            projection={p}
            rows={lodRows}
            regionGroups={regionGroups}
            allCells={file.cells}
            onOpenRegion={setOpenRegion}
            maxBodies={maxBodies}
            highlight={searchHit}
            onHover={setHover}
            onOpen={setOpenCell}
            commander={commanderCell}
            backdrop={backdrop ?? null}
            galaxyImage={galaxyImage ?? null}
            backlog={shownBacklog}
            searchHits={search?.hits ?? EMPTY_HITS}
            mine={mine}
            nextTarget={nextTarget}
          />
        ))}
      </div>

      {/*
        The middle rung of the drill-down: a region's sectors, listed below the plots (A3).

        A list rather than a zoomed plot, because the question at this point has stopped being
        spatial — the commander has picked a region and now wants to know which sector in it is
        worth the trip. Sorted by what is most actionable, then by how much is recorded, so the row
        to read is the first one.
      */}
      {openRegion ? (
        <section className="galaxy-region">
          <header className="galaxy-region__head">
            <h3>{openRegion.name || "Unnamed space"}</h3>
            <span className="dim">
              {openRegion.rows.length} sector{openRegion.rows.length === 1 ? "" : "s"} · {openRegion.bodies}{" "}
              bodies recorded
            </span>
            <button type="button" className="galaxy-region__close" onClick={() => setOpenRegion(null)}>
              Close
            </button>
          </header>
          <ul className="galaxy-region__list">
            {[...openRegion.rows]
              .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || b.bodies - a.bodies)
              .map((r) => {
                const style = TIER_STYLE[r.tier];
                const isOpen = openCell?.key === r.cell.key;
                return (
                  <li key={r.cell.key}>
                    <button
                      type="button"
                      className={isOpen ? "galaxy-region__row galaxy-region__row--on" : "galaxy-region__row"}
                      onClick={() => setOpenCell(r.cell)}
                      title={style.help}
                    >
                      <span
                        className="galaxy-map__swatch"
                        style={
                          style.fill
                            ? { background: style.fill }
                            : { background: "transparent", border: `2px solid ${style.stroke}` }
                        }
                        aria-hidden="true"
                      />
                      <span className="galaxy-region__name">{r.cell.name ?? r.cell.key}</span>
                      <span className="dim galaxy-region__tier">{style.label}</span>
                      <span className="dim galaxy-region__bodies">{r.bodies}</span>
                    </button>
                  </li>
                );
              })}
          </ul>
        </section>
      ) : null}

      <SectorReadout cell={hover ?? openCell ?? searchHit} taxon={taxon} />

      {openCell ? (
        <SectorSystems
          cell={openCell}
          taxon={taxon}
          commander={commanderCell?.key === openCell.key ? commanderCell : null}
          onClose={() => setOpenCell(null)}
        />
      ) : null}

      {/*
        The ladder, in the order the map applies it: most actionable first, "done" last. Reading it
        top to bottom is reading the rule — a sector shows the highest thing on this list that is
        still true of it, which is why a thousand finished plants never outrank one unfinished.
      */}
      <ul className="galaxy-map__legend">
        {TIER_ORDER.map((t) => {
          const st = TIER_STYLE[t];
          const missing = t === "barren";
          return (
            <li key={t} className={missing ? "galaxy-map__legend--unavailable" : undefined} title={st.help}>
              <span
                className="galaxy-map__swatch"
                style={
                  st.fill
                    ? { background: st.fill }
                    : { background: "transparent", border: `2px solid ${st.stroke}` }
                }
                aria-hidden="true"
              />
              {st.label}
              {missing ? <em> — needs a source that lists systems with no life</em> : null}
            </li>
          );
        })}
        {/*
          The two layers drawn *over* the survey, which had no legend at all.

          The owner saw both and could not tell what either was: *"legend for the 'moon like'
          imperfect orange circles on the map and the purple ones"*. A mark nobody can name is
          noise, however carefully it was chosen — and these two are the only marks on the map that
          are not evidence about a place, which is exactly the thing a reader has to be told.
        */}
        <li
          className="galaxy-map__legend--layer"
          title="Systems where you found biology and never collected it, sized by how many bodies are unfinished there."
        >
          <span className="galaxy-map__swatch galaxy-map__swatch--target" aria-hidden="true" />
          Your unfinished systems
        </li>
        {/*
          The dashed ones are the marks the owner described as "moon like" — a broken ring rather
          than a disc. They are not a different kind of thing, they are the same thing with one fact
          missing, so they sit beside it in the legend rather than somewhere else.
        */}
        <li
          className="galaxy-map__legend--layer"
          title="The same, where the journal never reported footfall. The biology is recorded; whether the 5x first-footfall bonus is still intact is not, so the ring is left open."
        >
          <span className="galaxy-map__swatch galaxy-map__swatch--target-unverified" aria-hidden="true" />…
          with footfall unconfirmed
        </li>
        {searchHitCount > 0 ? (
          <li
            className="galaxy-map__legend--layer"
            title="Where the search found biology, sampled across the galaxy: the richest system in each sector that matched, not the ones nearest you. Click one to open its sector."
          >
            <span className="galaxy-map__swatch galaxy-map__swatch--hit" aria-hidden="true" />
            Search results — {searchHitCount} sector{searchHitCount === 1 ? "" : "s"} sampled
          </li>
        ) : null}
      </ul>

      <p className="galaxy-map__caveat">
        Marker size is the cube root of the body count, so a single sighting stays visible next to a sector
        holding hundreds. <strong>Density follows commander traffic</strong> — the bright region around Sol is
        where people fly, not where the plants are.
      </p>
    </div>
  );
}
