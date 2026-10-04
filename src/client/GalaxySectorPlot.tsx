/**
 * The plotted galaxy: projections, markers, pan and zoom for the sector map. Split out of GalaxySectorMap.tsx (code review D, 2026-09-27).
 */
import type { GalaxySearchMark } from "./GalaxySearchPanel";
import { LodRow, RegionGroup, isOnScreen, lodLevel } from "./galaxyLod";
import { axisLabels, cameraLabel, project } from "./galaxyProjection";
import { PAD, Projection, VIEW_H, VIEW_W } from "./galaxySectorShared";
import {
  GalaxyImage,
  REGION_LAYER_ALPHA,
  REGION_MAP_SIZE,
  galaxyImageRect,
  regionSpanInCells,
} from "./regionBackdrop";
import { useMapViewport } from "./useMapViewport";
import { TIER_STYLE } from "@shared/galaxyTier";
import type { SectorMapCell } from "@shared/sectorMapFile.js";
import {
  SECTOR_SIZE_LY,
  sectorCellFractional,
  sectorCellFromCoords,
  sectorCellKey,
} from "@shared/sectorName.js";
import type { BacklogSystemDTO, CommanderSectorDTO } from "@shared/types";
import { useCallback, useMemo } from "react";
import { fmtCrExact, fmtLy } from "@shared/format";

export function SectorPlot({
  projection,
  rows,
  regionGroups,
  allCells,
  onOpenRegion,
  maxBodies,
  highlight,
  onHover,
  onOpen,
  commander,
  backdrop,
  galaxyImage,
  backlog,
  searchHits,
  mine,
  nextTarget,
}: {
  projection: Projection;
  rows: LodRow<SectorMapCell>[];
  /**
   * Sectors collapsed by region, or null when there is no region map to group by.
   *
   * Null is not an error state: without it the plot draws every sector at every zoom, which is what
   * it always did. Detail is the thing that degrades, never correctness.
   */
  regionGroups: RegionGroup<SectorMapCell>[] | null;
  /** Every sector the file holds, so a mark can find its sector even when the filter hides it. */
  allCells: SectorMapCell[];
  onOpenRegion: (g: RegionGroup<SectorMapCell> | null) => void;
  maxBodies: number;
  highlight: SectorMapCell | null;
  onHover: (c: SectorMapCell | null) => void;
  onOpen: (c: SectorMapCell) => void;
  commander: { x: number; y: number; z: number; key: string; system: string | null } | null;
  /** The galaxy image, as a data URL. Top projection only — the region map has no y axis. */
  backdrop: string | null;
  /** The photograph the regions are drawn over, or null when this machine has none. */
  galaxyImage: GalaxyImage | null;
  /** Backlog systems already filtered by the caller's minimum. */
  backlog: BacklogSystemDTO[];
  /**
   * Systems the galaxy search found, drawn over the survey (A3).
   *
   * The owner's reason for moving the search here: *"when a player searches for something, those
   * filters are applied to the galaxy map below"*. A table of two hundred names answers *which*;
   * the same two hundred as marks answers *where*, which is the question a map is for.
   */
  searchHits: readonly GalaxySearchMark[];
  /** This commander's own state per sector, keyed by cell. Empty on a build with no journals. */
  mine: Map<string, CommanderSectorDTO>;
  /** The one the banner names, ringed so the name and the dot cannot disagree. */
  nextTarget: BacklogSystemDTO | null;
}) {
  /*
   * The region map is a plane map: y was discarded when it was built, so there is nothing to draw
   * behind the edge-on view. Asking for it there would silently place a top-down galaxy against a
   * vertical axis, which would look like data.
   */
  const vp = useMapViewport(projection.camera);
  const cam = vp.camera;

  /**
   * The backdrop is a plane image, so it only makes sense looking straight down.
   *
   * Tilt away and it would be a top-down galaxy pasted against a vertical axis — a picture that
   * looks like data and is not. It fades out as the camera leaves the plane rather than vanishing,
   * so the commander can see it go.
   */
  const backdropOpacity = Math.max(0, (Math.abs(cam.pitch) - 60) / 30);
  const showBackdrop = backdrop != null && backdropOpacity > 0.02 && Math.abs(cam.yaw % 360) < 1;
  const span = regionSpanInCells(SECTOR_SIZE_LY);

  /**
   * Cells by key, so a mark that knows only its coordinates can find the sector it belongs to.
   *
   * The backlog dots are drawn over the sector markers and used to eat the click that was meant for
   * the sector underneath — they carry a tooltip and no handler, so the click simply vanished.
   * Reported as "I cannot click the sector which is under it".
   */
  /**
   * Every sector in the file, not only the ones the current filter draws.
   *
   * Built from `allCells` because a mark drawn from its own coordinates — a backlog system, a search
   * hit — needs the sector underneath it whether or not that sector is currently on the map. When
   * this was built from the filtered rows, searching for a species narrowed the sectors and the
   * diamonds sitting outside them silently stopped being clickable. Reported as "I cannot click
   * them".
   */
  const cellByKey = useMemo(() => new Map(allCells.map((c) => [sectorCellKey(c), c])), [allCells]);

  /**
   * Regions or sectors, decided by how far in the commander has zoomed (A3).
   *
   * The split is a display decision and lives here rather than above, because zoom is per plot:
   * the top view and the edge-on view are panned and zoomed independently, and forcing them to the
   * same level of detail would mean zooming into one to coarsen the other.
   */
  const level = regionGroups ? lodLevel(vp.view.scale) : "sector";

  /** Groups are keyed by region, except the unnamed ones which stand alone at their own position. */
  const regionKeyOf = useCallback(
    (g: RegionGroup<SectorMapCell>) =>
      g.regionId === 0 ? `unnamed:${g.x},${g.y},${g.z}` : `r:${g.regionId}`,
    [],
  );

  /** The group holding the commander's own sector, so it can be ringed like the sector is. */
  const youRegionKey = useMemo(() => {
    if (!commander || !regionGroups) return null;
    const g = regionGroups.find((grp) => grp.rows.some((r) => sectorCellKey(r.cell) === commander.key));
    return g ? regionKeyOf(g) : null;
  }, [commander, regionGroups, regionKeyOf]);

  /** Plot coordinates for a point in cell space, at the current camera. */
  const at = useCallback((c: { x: number; y: number; z: number }) => project(c, cam), [cam]);
  /*
   * Two framings, and which one is right depends on whether the galaxy is drawn.
   *
   * Without a backdrop, fitting to the data keeps a small corpus legible instead of a dot in the
   * corner. With one, the whole galaxy has to be in frame or the backdrop is a meaningless crop —
   * and seeing the data as a small cluster inside the galaxy is the entire point of drawing it.
   */
  const bounds = useMemo(() => {
    if (showBackdrop) {
      /*
       * Square data range, and the plot is 1040x560 — so mapping 0..span onto both axes squashes
       * the galaxy to about half its height. That was invisible while the backdrop was an abstract
       * mosaic of regions and is obvious the moment it is a photograph of a round galaxy.
       *
       * Fixed by widening the *x* range instead of stretching the image: the view keeps the whole
       * span vertically, and the horizontal range grows to whatever makes a cell the same size on
       * both axes. Every marker goes through the same sx/sy, so the plot stays in register with
       * itself and the galaxy comes out round.
       */
      const aspect = (VIEW_W - PAD * 2) / (VIEW_H - PAD * 2);
      const halfWide = (span * aspect) / 2;
      return { minX: span / 2 - halfWide, maxX: span / 2 + halfWide, minY: 0, maxY: span };
    }
    if (rows.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    // Rows already carry the centre of their box, so no half-cell nudge is needed here.
    const pts = rows.map((r) => at(r));
    const xs = pts.map((p) => p.u);
    const ys = pts.map((p) => p.v);
    // The ship may be well outside the sampled corpus. Stretching the view to include it beats
    // drawing it off-canvas, which would silently look like "no position".
    if (commander) {
      const c = at(commander);
      xs.push(c.u);
      ys.push(c.v);
    }
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  }, [rows, at, commander, showBackdrop, span]);

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
        <span className="galaxy-map__cam">{cameraLabel(cam)}</span>
      </figcaption>

      <div className="galaxy-map__controls">
        <label>
          Yaw
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={cam.yaw}
            onChange={(e) => vp.setCamera({ ...cam, yaw: Number(e.target.value) })}
            aria-label={`${projection.label} yaw`}
          />
        </label>
        <label>
          Pitch
          <input
            type="range"
            min={0}
            max={90}
            step={1}
            value={cam.pitch}
            onChange={(e) => vp.setCamera({ ...cam, pitch: Number(e.target.value) })}
            aria-label={`${projection.label} pitch`}
          />
        </label>
        <button
          type="button"
          onClick={() => vp.zoomBy(1.4, { x: VIEW_W / 2, y: VIEW_H / 2 })}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => vp.zoomBy(1 / 1.4, { x: VIEW_W / 2, y: VIEW_H / 2 })}
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => {
            vp.reset();
            vp.setCamera(projection.camera);
          }}
        >
          Reset
        </button>
        <span className="dim galaxy-map__zoom">{vp.view.scale.toFixed(1)}×</span>
      </div>

      <svg
        ref={vp.svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={`${projection.label} sector map`}
        className={vp.panning ? "galaxy-map__svg galaxy-map__svg--panning" : "galaxy-map__svg"}
        {...vp.handlers}
      >
        {/* Outside the panned group: the background is the window, not part of the scene. */}
        <rect x={0} y={0} width={VIEW_W} height={VIEW_H} className="galaxy-map__bg" />
        <g transform={vp.transform}>
          {showBackdrop && galaxyImage
            ? /*
               * The photograph, under the regions and under everything else.
               *
               * Drawn as its own element rather than painted into the region canvas, so the browser
               * samples the original once at the size it is actually shown instead of taking it through
               * a 2048-pixel intermediate that upscales it by 2.6 and then scales the result back down.
               * `galaxyImageRect` puts it in grid pixels, which are the region layer's own coordinates,
               * so the two stay pinned to each other whatever the view does.
               */
              (() => {
                const rect = galaxyImageRect(galaxyImage.width, galaxyImage.height);
                const u = (px: number) => (px / REGION_MAP_SIZE) * span;
                return (
                  <image
                    href={galaxyImage.url}
                    x={sx(u(rect.x))}
                    y={sy(span - u(rect.y))}
                    width={sx(u(rect.width)) - sx(0)}
                    height={sy(0) - sy(u(rect.height))}
                    preserveAspectRatio="none"
                    className="galaxy-map__galaxy"
                    opacity={backdropOpacity}
                  />
                );
              })()
            : null}
          {showBackdrop && backdrop ? (
            /*
             * The regions over it. `preserveAspectRatio="none"` because sx/sy already place the grid,
             * and letting the image impose its own aspect would put it out of register with the
             * markers drawn over it.
             *
             * Dropped to {@link REGION_LAYER_ALPHA} when there is a photograph underneath: the two
             * layers answer different questions and only the boundaries need to read here.
             */
            <image
              href={backdrop}
              x={sx(0)}
              y={sy(span)}
              width={sx(span) - sx(0)}
              height={sy(0) - sy(span)}
              preserveAspectRatio="none"
              className="galaxy-map__backdrop"
              opacity={backdropOpacity * (galaxyImage ? REGION_LAYER_ALPHA : 1)}
            />
          ) : null}
          {/*
          One circle per region while zoomed out (A3).

          Sized by everything recorded inside it, so a region reads as dense or thin at a glance,
          and coloured only when its sectors agree: a region whose sectors report different things
          is a place to look into, not an answer, and painting it as any one of them would be a
          claim no sector makes.
        */}
          {level === "region" && regionGroups
            ? regionGroups
                .filter((g) => isOnScreen(sx(at(g).u), sy(at(g).v), vp.view, VIEW_W, VIEW_H))
                .map((g) => {
                  const style = TIER_STYLE[g.tier];
                  const cx = sx(at(g).u);
                  const cy = sy(at(g).v);
                  // A floor of 4: a region is always a bigger target than the sectors inside it,
                  // because its whole job at this zoom is to be clickable.
                  const r = 4 + 9 * Math.cbrt(g.bodies / Math.max(1, maxBodies * 4));
                  return (
                    <g key={regionKeyOf(g)} className="galaxy-map__region">
                      {/*
                      The region the ship is in, ringed — the same pairing the sector marker gets.
                      A region is drawn at the centroid of its sectors, which can be a long way from
                      the commander, so without this the two marks read as unrelated.
                    */}
                      {youRegionKey === regionKeyOf(g) ? (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={(r + 5) * vp.pixel}
                          className="galaxy-map__you-cell"
                          pointerEvents="none"
                          fill="none"
                          strokeWidth={1.2 * vp.pixel}
                        />
                      ) : null}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={r * vp.pixel}
                        fill={g.uniform ? (style.fill ?? "none") : "none"}
                        fillOpacity={g.uniform && style.fill ? 0.45 : 1}
                        stroke={g.uniform ? style.stroke : "#8b949e"}
                        strokeWidth={1.4 * vp.pixel}
                        strokeDasharray={g.uniform ? undefined : `${2 * vp.pixel} ${1.5 * vp.pixel}`}
                        style={{ cursor: "pointer" }}
                        onClick={() => {
                          if (!vp.panning) onOpenRegion(g);
                        }}
                      >
                        <title>{`${g.name || "unnamed space"}
${g.rows.length} sector${g.rows.length === 1 ? "" : "s"} · ${g.bodies} bodies recorded
${g.uniform ? style.label : "sectors here report different things"}
Click to list its sectors, or zoom in to split it`}</title>
                      </circle>
                    </g>
                  );
                })
            : null}
          {/*
          The commander's own sector is drawn at **both** levels.

          Grouping into regions took it away: a region circle sits at the centroid of its sectors,
          which for Inner Orion Spur is 22 plot units from where the ship actually is and smaller
          than that gap. So the cross was left standing on its own with nothing under it, and the
          owner reported the map "showing me outside in the black". He was in the middle of a
          region the whole time — the mark that used to say so had been grouped away.

          One extra circle, and the ring below pairs it with the ship.
        */}
          {(level === "sector"
            ? rows.filter((row) => isOnScreen(sx(at(row).u), sy(at(row).v), vp.view, VIEW_W, VIEW_H))
            : rows.filter((row) => commander != null && sectorCellKey(row.cell) === commander.key)
          ).map(({ cell, bodies, tier, ...pos }) => {
            const r = 2 + 7 * Math.cbrt(bodies / maxBodies);
            const isHit = highlight?.key === cell.key;
            /*
             * Outlined, not filled, once there is a galaxy behind them.
             *
             * A filled marker over the backdrop hides the region it sits in, which is the one thing
             * the backdrop was added to show. Hollow keeps both readable, and the evidence colour
             * moves to the stroke where it still reads at this size. Without a backdrop the original
             * filled form is kept: on a flat background hollow markers are harder to see, not easier.
             */
            /*
             * The tier — what this sector is worth the commander's attention for, not what is best
             * known about it — is decided above this component now, because the region grouping needs
             * it too. See shared/galaxyTier.ts for the ladder itself.
             */
            const m = mine.get(cell.key);
            const style = TIER_STYLE[tier];
            // Hollow means one thing now: your own unfinished work.
            const hollow = style.fill === null;
            const cx = sx(at(pos).u);
            const cy = sy(at(pos).v);
            return (
              <g key={cell.key}>
                {/*
                An invisible disc over the whole marker, so a hollow one can be clicked through its
                middle. Hitting a 1.5px ring is a game of patience, and the empty centre reads as
                part of the marker to everybody except the hit tester.

                `pointer-events: all` with no fill is what makes an unpainted shape catch a click.
                Sized in screen pixels via `vp.pixel` so it stays a comfortable target at every zoom,
                and given at least 6 so the smallest sectors are still reachable.
              */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={Math.max(6, r + 3) * vp.pixel}
                  fill="none"
                  className="galaxy-map__hit"
                  onMouseEnter={() => onHover(cell)}
                  onMouseLeave={() => onHover(null)}
                  onClick={() => {
                    // A drag that ends over a marker is a pan, not a pick.
                    if (!vp.panning) onOpen(cell);
                  }}
                >
                  <title>{`${cell.name ?? cell.key} — ${style.label}${
                    commander?.key === cell.key
                      ? `
You are here — ${commander.system ?? "unknown system"}`
                      : ""
                  }
${style.help}
${bodies} bodies recorded here${
                    m ? ` · you scanned ${m.scannedByYou}, ${m.unscannedByYou} left` : ""
                  }`}</title>
                </circle>
                <circle
                  cx={cx}
                  cy={cy}
                  r={r * vp.pixel}
                  pointerEvents="none"
                  fill={style.fill ?? "none"}
                  fillOpacity={style.fill ? 0.8 : 1}
                  stroke={isHit ? "#f0f6fc" : style.stroke}
                  strokeWidth={(isHit ? 2 : hollow ? 1.6 : 0.6) * vp.pixel}
                ></circle>
                {/*
              The sector the ship is in, ringed.

              The cross alone left the pairing to the eye, and at galaxy scale two marks a few
              pixels apart are not obviously the same place. A ring around the marker says which
              sector the cross belongs to without needing a hover, and stays out of the evidence
              colours by being drawn in the ship's own colour.
            */}
                {commander?.key === cell.key ? (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={(r + 5) * vp.pixel}
                    className="galaxy-map__you-cell"
                    pointerEvents="none"
                    fill="none"
                    strokeWidth={1.2 * vp.pixel}
                  />
                ) : null}
              </g>
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
              {backlog
                .filter((s) => {
                  const c = sectorCellFractional(s.x, s.y, s.z);
                  return isOnScreen(sx(at(c).u), sy(at(c).v), vp.view, VIEW_W, VIEW_H);
                })
                .map((s) => {
                  /*
                Fractional, not floored. These systems know their own coordinates; rounding them into
                a 1 280 ly cell before drawing collapses the edge-on view into three stacked rows,
                because that is how few cells thick the galaxy is.
              */
                  const cell = sectorCellFractional(s.x, s.y, s.z);
                  // The sector this target sits in, so a click on the dot opens the drill-down instead
                  // of being swallowed by a mark that has nowhere to send it.
                  const owner = cellByKey.get(sectorCellKey(sectorCellFromCoords(s.x, s.y, s.z))) ?? null;
                  return (
                    <circle
                      key={s.systemAddress}
                      cx={sx(at(cell).u)}
                      cy={sy(at(cell).v)}
                      onClick={() => {
                        if (!vp.panning && owner) onOpen(owner);
                      }}
                      style={owner ? { cursor: "pointer" } : undefined}
                      r={(2 + Math.min(3, Math.cbrt(s.bodies))) * vp.pixel}
                      className={[
                        "galaxy-map__target",
                        s.allVerified ? "" : "galaxy-map__target--unverified",
                        // Ringed rather than recoloured: the fill already carries whether the 5x is
                        // verified, and overwriting that to show "this is the one" would trade a fact
                        // for a pointer.
                        nextTarget?.systemAddress === s.systemAddress ? "galaxy-map__target--next" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <title>
                        {[
                          `${s.starSystem} — ${s.bodies} unfinished ${s.bodies === 1 ? "body" : "bodies"}`,
                          `floor ${fmtCrExact(s.floorCr)} at 5×`,
                          ...(owner ? [`click to open ${owner.name ?? sectorCellKey(owner)}`] : []),
                          ...(s.allVerified ? [] : ["footfall never reported — not confirmed"]),
                        ].join(`
`)}
                      </title>
                    </circle>
                  );
                })}
            </g>
          ) : null}
          {/*
          What the search found, as places rather than rows.

          Diamonds, and a violet nothing else on this map uses. Every other mark here is either
          evidence (green / blue / grey) or the commander's own unfinished work (amber), and a sixth
          circle in a seventh shade would read as a sixth kind of evidence. These are not evidence at
          all — they are the answer to a question somebody asked a minute ago, and they should look
          like an overlay that will go away again.

          Drawn from each system's own coordinates, fractionally: rounding them into a 1 280 ly cell
          first collapses the edge-on view into three stacked rows, because that is how few cells
          thick the galaxy is.
        */}
          {searchHits.length > 0 ? (
            <g className="galaxy-map__hits">
              {searchHits
                .filter((h) => {
                  const c = sectorCellFractional(h.x, h.y, h.z);
                  return isOnScreen(sx(at(c).u), sy(at(c).v), vp.view, VIEW_W, VIEW_H);
                })
                .map((h) => {
                  const cell = sectorCellFractional(h.x, h.y, h.z);
                  const owner = cellByKey.get(sectorCellKey(sectorCellFromCoords(h.x, h.y, h.z))) ?? null;
                  const cx = sx(at(cell).u);
                  const cy = sy(at(cell).v);
                  const d = 3.2 * vp.pixel;
                  return (
                    <polygon
                      key={h.systemAddress}
                      points={`${cx},${cy - d} ${cx + d},${cy} ${cx},${cy + d} ${cx - d},${cy}`}
                      className="galaxy-map__hit-mark"
                      strokeWidth={1.1 * vp.pixel}
                      style={owner ? { cursor: "pointer" } : undefined}
                      onClick={() => {
                        if (!vp.panning && owner) onOpen(owner);
                      }}
                    >
                      <title>
                        {[
                          `${h.starSystem} — ${h.note}`,
                          ...(h.distanceLy == null ? [] : [`${fmtLy(h.distanceLy)} away`]),
                          /*
                        A hit can land in a sector this map has no cell for: the sector file only
                        covers where the feeder corpus has data, while the search runs over 5.3
                        million systems. Saying so beats a mark that quietly does nothing when
                        clicked — which is how the missing click was reported in the first place.
                      */
                          owner
                            ? `click to open ${owner.name ?? sectorCellKey(owner)}`
                            : "this system's sector is not in the sector map",
                        ].join(`
`)}
                      </title>
                    </polygon>
                  );
                })}
            </g>
          ) : null}
          {commander ? (
            /*
             * Drawn last so a dense sector never hides the ship, and `pointer-events: none` so the
             * ship never hides a sector: the cross sits on top of the marker for the cell it is in,
             * and without this it ate every click and hover meant for it. The sector's own tooltip
             * says "you are here" instead.
             */
            <g
              transform={`translate(${sx(at(commander).u)}, ${sy(at(commander).v)})`}
              className="galaxy-map__you"
              pointerEvents="none"
            >
              {/* A cross, not a dot: at a glance it must not be mistaken for a sector marker, and it
                stays legible on top of one. Drawn last so a dense sector never hides the ship. */}
              {/* Sized in screen pixels: zooming in should reveal space, not inflate the ship. */}
              <line x1={-7 * vp.pixel} y1={0} x2={7 * vp.pixel} y2={0} strokeWidth={1.5 * vp.pixel} />
              <line x1={0} y1={-7 * vp.pixel} x2={0} y2={7 * vp.pixel} strokeWidth={1.5 * vp.pixel} />
              <circle r={4 * vp.pixel} fill="none" strokeWidth={1.5 * vp.pixel} />
            </g>
          ) : null}
        </g>

        {/* Axis captions live outside the panned group: they describe the view, not the scene. */}
        <text x={VIEW_W - PAD} y={VIEW_H - 8} className="galaxy-map__axis" textAnchor="end">
          {axisLabels(cam)[0]}
        </text>
        <text x={8} y={PAD} className="galaxy-map__axis">
          {axisLabels(cam)[1]}
        </text>
      </svg>
    </figure>
  );
}
