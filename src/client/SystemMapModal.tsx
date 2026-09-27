import { SnapshotButton } from "./SnapshotButton";
import type { AppSnapshot, NotableBodyInfo } from "@shared/types";
import { DScanBodiesBadge } from "./DScanBodiesBadge";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { DetailBody } from "./PlanetQuickFactsPopup";
import { useModal } from "./ui/useModal";
import {
  computeSystemMapLayout,
  neighbourInDirection,
  orbitChain,
  type MapItem,
  type MapLayout,
} from "./systemMapLayout";
import {
  MAP_BG,
  MAP_BLUE,
  STAR_COLOURS,
  SystemMapDefs,
  SystemMapDrawing,
  SystemMapGrid,
  bodyColours,
} from "./SystemMapDrawing";
import { CopySystemButton } from "./CopySystemButton";
import { IDENTITY, useMapViewport, type MapViewport } from "./useMapViewport";

function notableBodyIsTerraformable(n: NotableBodyInfo): boolean {
  return n.tag.toLowerCase().includes("terraformable");
}

/** A tiny drawing for the legend, in the map's own colours. */
function Swatch({ children }: { children: React.ReactNode }) {
  return (
    <svg className="system-map-legend-svg" viewBox="-9 -9 18 18" width="18" height="18" aria-hidden="true">
      {children}
    </svg>
  );
}

function BodySwatch({ label }: { label: string }) {
  const c = bodyColours(label);
  return (
    <Swatch>
      <circle r={6.5} fill={c.fill} stroke={c.stroke} strokeWidth={1.4} />
    </Swatch>
  );
}

/**
 * What the map draws, said in words — in the map's own colours, so a change to one cannot leave
 * the other describing the old look.
 */
function SystemMapLegend({ plusMinCr, plusPlusMinCr }: { plusMinCr: number; plusPlusMinCr: number }) {
  const stars: [string, keyof typeof STAR_COLOURS][] = [
    ["O B A", "B"],
    ["F G", "G"],
    ["K", "K"],
    ["M", "M"],
    ["L", "L"],
    ["T Y", "T"],
    ["White dwarf", "D"],
    ["Neutron", "N"],
    ["Black hole", "H"],
  ];
  return (
    <div className="system-map-legend">
      <div className="system-map-legend-row">
        <span className="dim small-caps">Stars</span>
        {stars.map(([label, k]) => (
          <span className="system-map-legend-item" key={label}>
            <Swatch>
              <circle r={7} fill={STAR_COLOURS[k].core} stroke={STAR_COLOURS[k].edge} strokeWidth={2} />
            </Swatch>
            {label}
          </span>
        ))}
      </div>
      <div className="system-map-legend-row">
        <span className="dim small-caps">Bodies</span>
        {(
          [
            ["Earth-like", "ELW"],
            ["Water", "WW"],
            ["Ammonia", "AW"],
            ["Icy (I, RI)", "I"],
            ["Rocky / metal (R, HMC, MR)", "HMC"],
            ["Gas giant", "GG"],
            ["Not yet scanned", "?"],
          ] as const
        ).map(([label, k]) => (
          <span className="system-map-legend-item" key={label}>
            <BodySwatch label={k} />
            {label}
          </span>
        ))}
      </div>
      <div className="system-map-legend-row system-map-legend-row--marks">
        <span className="system-map-legend-item">
          <Swatch>
            <circle r={4.5} fill="#123a44" />
            <circle r={6.8} fill="none" stroke={MAP_BLUE} strokeWidth={1.5} />
          </Swatch>
          atmosphere
        </span>
        <span className="system-map-legend-item">
          <Swatch>
            <circle r={4.5} fill="#123a44" />
            <path
              d="M 3.4 5.9 A 6.8 6.8 0 1 1 3.4 -5.9"
              fill="none"
              stroke={MAP_BLUE}
              strokeWidth={1.8}
              strokeLinecap="round"
            />
          </Swatch>
          landable
        </span>
        <span className="system-map-legend-item">
          <span className="system-map-legend-badge">3</span> biological signals
        </span>
        <span className="system-map-legend-item">
          <span className="system-map-legend-badge system-map-legend-badge--x5">3 ×5</span> first footfall
          pays ×5
        </span>
        <span className="system-map-legend-item">
          <span className="system-map-legend-you" aria-hidden="true">
            ▼
          </span>
          you are here
        </span>
        <span className="system-map-legend-item">
          <b>×</b> barycentre (a pair's shared centre)
        </span>
        <span className="system-map-legend-item">
          <b>*</b> terraformable
        </span>
        <span className="system-map-legend-item">
          <b>+</b> / <b>++</b> exobiology ≥ {plusMinCr.toLocaleString()} / {plusPlusMinCr.toLocaleString()} CR
          · <b>+</b> on a star: scoopable
        </span>
      </div>
      <div className="system-map-legend-row dim">
        Scroll to zoom at the cursor · drag to pan · click a body for its data · arrow keys move between
        bodies · + / − zoom · 0 or double-click fits the map
      </div>
    </div>
  );
}

/** Put a body back in view when the keyboard moved to one off the screen. */
function keepInView(vp: MapViewport, layout: MapLayout, it: MapItem): void {
  const s = vp.view.scale;
  const x = s * it.cx + vp.view.tx;
  const y = s * it.cy + vp.view.ty;
  const mx = layout.width * 0.08;
  const my = layout.height * 0.08;
  const inX = x > layout.minX + mx && x < layout.minX + layout.width - mx;
  const inY = y > layout.minY + my && y < layout.minY + layout.height - my;
  if (inX && inY) return;
  vp.setView({
    scale: s,
    tx: inX ? vp.view.tx : layout.minX + layout.width / 2 - s * it.cx,
    ty: inY ? vp.view.ty : layout.minY + layout.height / 2 - s * it.cy,
  });
}

export const SystemMapModal = memo(function SystemMapModal({
  snap,
  onClose,
  onGoToBioBody,
}: {
  snap: AppSnapshot;
  onClose: () => void;
  onGoToBioBody: (bodyKey: string) => void;
}) {
  const map = snap.systemMap;
  const systemTitleName =
    map?.starSystem?.trim() ||
    snap.viewingSystemName?.trim() ||
    (snap.viewingSystemAddress != null ? `System ${snap.viewingSystemAddress}` : "");
  const mapHeading =
    systemTitleName.length > 0 ? (
      <>
        System map - {systemTitleName}
        {map?.starSystem?.trim() || snap.viewingSystemName?.trim() ? (
          <CopySystemButton system={systemTitleName} />
        ) : null}
      </>
    ) : (
      "System map"
    );
  const layout = useMemo(
    () => (map ? computeSystemMapLayout(map.tree, map.starSystem ?? "", map.detailsByBodyId) : null),
    [map],
  );
  const layoutKey = layout != null ? `${map?.systemAddress}:${layout.width}x${layout.height}` : "";
  const vp = useMapViewport(undefined, { maxScale: 40, bindKey: layoutKey });

  const detailOf = useCallback((id: number) => map?.detailsByBodyId[String(id)], [map]);

  /** How many drawn bodies carry biology / can be landed on — the counts beside the filters. */
  const counts = useMemo(() => {
    let bio = 0;
    let land = 0;
    for (const it of layout?.items ?? []) {
      const d = detailOf(it.id);
      if (d?.hasExobiology) bio++;
      if (d?.landable) land++;
    }
    return { bio, land };
  }, [layout, detailOf]);

  /**
   * Fade what a filter leaves out rather than removing it: the tree keeps its shape, so a bio moon
   * under a barren planet is still found where it belongs. Stars and barycentres never fade — they
   * are the scaffolding.
   */
  const [bioOnly, setBioOnly] = useState(false);
  const [landOnly, setLandOnly] = useState(false);
  const dimmed = useCallback(
    (it: MapItem) => {
      if (it.kind === "star" || it.kind === "hub" || it.kind === "bary") return false;
      const d = detailOf(it.id);
      return (bioOnly && !d?.hasExobiology) || (landOnly && !d?.landable);
    },
    [bioOnly, landOnly, detailOf],
  );

  /** The selected body opens where the ship is, else on the body the main panel shows. */
  const initialId = useMemo(() => {
    const here = layout?.items.find((it) => it.node.youAreHere);
    if (here) return here.id;
    const key = snap.uiSelectedBodyKey;
    if (!key) return null;
    const id = Number(key.slice(key.lastIndexOf(":") + 1));
    return Number.isFinite(id) && layout?.items.some((it) => it.id === id) ? id : null;
    // Only when the system changes — a new snapshot of the same system keeps the commander's pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map?.systemAddress]);
  const [selectedId, setSelectedId] = useState<number | null>(initialId);
  const [hoverId, setHoverId] = useState<number | null>(null);
  useEffect(() => {
    setSelectedId(initialId);
    vp.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map?.systemAddress]);

  const chain = useMemo(
    () => (layout ? orbitChain(layout, hoverId ?? selectedId) : new Set<number>()),
    [layout, hoverId, selectedId],
  );
  const selectedItem = layout?.items.find((it) => it.id === selectedId) ?? null;
  const selectedDetail = selectedId != null ? detailOf(selectedId) : undefined;

  const dialogRef = useModal<HTMLDivElement>(true, onClose);

  const onKeyDown = useCallback(
    (ev: React.KeyboardEvent) => {
      if (!layout) return;
      const t = ev.target as HTMLElement;
      if (t.closest("input, textarea, select")) return;
      const centre = { x: layout.minX + layout.width / 2, y: layout.minY + layout.height / 2 };
      if (ev.key === "+" || ev.key === "=") vp.zoomBy(1.3, centre);
      else if (ev.key === "-" || ev.key === "_") vp.zoomBy(1 / 1.3, centre);
      else if (ev.key === "0") vp.reset();
      else if (ev.key.startsWith("Arrow")) {
        const dir = ev.key.slice(5).toLowerCase() as "left" | "right" | "up" | "down";
        const from =
          selectedItem ??
          [...layout.items]
            .filter((it) => it.kind !== "bary")
            .sort((a, b) => a.cy - b.cy || a.cx - b.cx)[0] ??
          null;
        if (!from) return;
        const next = selectedItem ? neighbourInDirection(layout.items, from, dir) : from;
        if (next) {
          setSelectedId(next.id);
          keepInView(vp, layout, next);
        }
      } else return;
      ev.preventDefault();
    },
    [layout, vp, selectedItem],
  );

  const prepareSnapshot = useCallback(async () => {
    const prev = vp.view;
    const hovered = hoverId;
    vp.setView(IDENTITY);
    setHoverId(null);
    // Let React paint the fitted map before the camera clones it (no rAF: it stalls in a hidden window).
    await new Promise((res) => setTimeout(res, 60));
    return () => {
      vp.setView(prev);
      setHoverId(hovered);
    };
  }, [vp, hoverId]);

  if (!map || !layout || layout.width <= 0) {
    return (
      <div className="modal-backdrop" role="presentation" onClick={onClose}>
        <div
          ref={dialogRef}
          tabIndex={-1}
          className="modal-panel system-map-panel"
          role="dialog"
          aria-modal="true"
          onClick={(ev) => ev.stopPropagation()}
        >
          <div className="modal-head">
            <h3>{mapHeading}</h3>
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <div className="modal-body">
            {!map ? (
              <div
                key={`system-map-fss-prompt-${snap.viewingSystemAddress ?? snap.currentSystemAddress ?? "na"}`}
                className="system-map-fss-required"
                role="img"
                aria-label="No merged Scan data for this system yet. FSS the system so journal lines populate bodies."
              />
            ) : (
              <p className="dim">No layout data.</p>
            )}
            {snap.dScanBodies ? (
              <div className="system-map-dscan-wrap">
                <DScanBodiesBadge d={snap.dScanBodies} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const vb = `${layout.minX} ${layout.minY} ${layout.width} ${layout.height}`;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-panel system-map-panel system-map-panel--wide"
        role="dialog"
        aria-modal="true"
        onClick={(ev) => ev.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="modal-head">
          <h3>{mapHeading}</h3>
          <SnapshotButton what="system-map" className="system-map-snapshot" prepare={prepareSnapshot} />
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="system-map-totals card-neon">
          <div>
            <div className="dim small-caps">System FSS Value:</div>
            <div className="system-map-total-val">{map.approxSystemFssValue.toLocaleString()} CR</div>
          </div>
          <div>
            <div className="dim small-caps">System DSS Value:</div>
            <div className="system-map-total-val">{map.approxSystemDssValue.toLocaleString()} CR</div>
          </div>
          <div>
            <div className="dim small-caps">Current value</div>
            <div className="system-map-total-val">
              {map.journalExplorationSaleCreditsFocused.toLocaleString()} CR
            </div>
          </div>
        </div>
        {snap.dScanBodies ? (
          <div className="system-map-dscan-wrap">
            <DScanBodiesBadge d={snap.dScanBodies} />
          </div>
        ) : null}

        {snap.notableBodies.length > 0 ? (
          <div className="system-map-notable card-neon" onClick={(ev) => ev.stopPropagation()}>
            <div className="system-map-notable-head">
              <span className="dim small-caps">Notable bodies</span>
            </div>
            <div className="system-map-notable-pills" role="list">
              {snap.notableBodies.map((n, i) => (
                <button
                  type="button"
                  role="listitem"
                  key={`${n.systemAddress}-${n.bodyId}-${i}`}
                  className={`system-map-notable-pill${n.dssMapped ? " system-map-notable-pill--dss" : " system-map-notable-pill--fss"}${
                    n.bodyId === selectedId ? " is-selected" : ""
                  }`}
                  title={
                    n.dssMapped
                      ? "DSS complete in merged journal (SAAScanComplete)"
                      : "Scan in journal — DSS not complete for this body"
                  }
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setSelectedId(n.bodyId);
                    const it = layout.items.find((x) => x.id === n.bodyId);
                    if (it) keepInView(vp, layout, it);
                  }}
                >
                  <span className="system-map-notable-body">
                    {notableBodyIsTerraformable(n) ? (
                      <span className="system-map-notable-tf-star">*</span>
                    ) : null}
                    {n.bodyLabelShort}
                  </span>
                  <span className="system-map-notable-tag"> - {n.tag}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="system-map-zoom" role="group" aria-label="Map zoom and filters">
          <button
            type="button"
            onClick={() =>
              vp.zoomBy(1 / 1.3, { x: layout.minX + layout.width / 2, y: layout.minY + layout.height / 2 })
            }
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="system-map-zoom-val">{Math.round(vp.view.scale * 100)}%</span>
          <button
            type="button"
            onClick={() =>
              vp.zoomBy(1.3, { x: layout.minX + layout.width / 2, y: layout.minY + layout.height / 2 })
            }
            aria-label="Zoom in"
          >
            +
          </button>
          <button type="button" onClick={() => vp.reset()} title="Fit the whole map in the window">
            Fit
          </button>
          <label className="system-map-bioonly">
            <input type="checkbox" checked={bioOnly} onChange={(e) => setBioOnly(e.target.checked)} />
            <span>
              Biology only <span className="dim">({counts.bio})</span>
            </span>
          </label>
          <label className="system-map-bioonly">
            <input type="checkbox" checked={landOnly} onChange={(e) => setLandOnly(e.target.checked)} />
            <span>
              Landable only <span className="dim">({counts.land})</span>
            </span>
          </label>
        </div>

        <div className="system-map-body">
          <div className="system-map-svg-wrap" style={{ background: MAP_BG }}>
            <svg
              ref={vp.svgRef}
              className="system-map-svg"
              viewBox={vb}
              preserveAspectRatio="xMidYMid meet"
              onPointerDown={vp.handlers.onPointerDown}
              onPointerMove={vp.handlers.onPointerMove}
              onPointerUp={vp.handlers.onPointerUp}
              onDoubleClick={vp.handlers.onDoubleClick}
              onClick={() => {
                if (!vp.panning) setSelectedId(null);
              }}
              style={{ cursor: vp.panning ? "grabbing" : "grab" }}
              role="img"
              aria-label={`System map of ${systemTitleName}`}
            >
              <SystemMapDefs />
              <g transform={vp.transform}>
                <SystemMapGrid layout={layout} />
                <SystemMapDrawing
                  layout={layout}
                  map={map}
                  dimmed={dimmed}
                  selectedId={selectedId}
                  chain={chain}
                  onSelect={(it) => {
                    if (!vp.panning) setSelectedId(it.id);
                  }}
                  onHover={(it) => setHoverId(it?.id ?? null)}
                />
              </g>
            </svg>
          </div>
          <aside className="system-map-side card-neon" aria-label="Selected body">
            {selectedDetail ? (
              <DetailBody detail={selectedDetail} onGoToBioBody={onGoToBioBody} />
            ) : selectedItem ? (
              <div className="body-detail-stack">
                <h4 className="body-detail-title">{selectedItem.node.bodyName || "Barycentre"}</h4>
                <p className="dim small">
                  {selectedItem.inferred
                    ? "A barycentre worked out from the body names — the journal has not placed these bodies yet."
                    : "No journal detail for this body yet: FSS or DSS it and its data appears here."}
                </p>
              </div>
            ) : (
              <p className="dim small system-map-side-hint">
                Click a body — or move with the arrow keys — to see its data here.
              </p>
            )}
          </aside>
        </div>

        <SystemMapLegend plusMinCr={snap.exoMapTierPlusMinCr} plusPlusMinCr={snap.exoMapTierPlusPlusMinCr} />
      </div>
    </div>
  );
});
