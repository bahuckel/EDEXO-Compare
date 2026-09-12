import type { AppSnapshot, NotableBodyInfo } from "@shared/types";
import { DScanBodiesBadge } from "./DScanBodiesBadge";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlanetQuickFactsPopup } from "./PlanetQuickFactsPopup";
import { useModal } from "./ui/useModal";
import { computeSystemMapLayout, type LayoutItem } from "./systemMapGeometry";
import { atmosphereRingColor } from "./planetDisplayUtils";

function systemMapNodeAppearance(it: LayoutItem): {
  fill: string;
  stroke: string;
  filter?: string;
  textFill: string;
  mapLabelFontSize?: number;
  strokeWidth?: number;
} {
  if (it.isBarycentre) {
    return {
      fill: "rgba(226, 232, 240, 0.12)",
      stroke: "#cbd5e1",
      filter: "url(#neonGray)",
      textFill: "#f8fafc",
      mapLabelFontSize: 12,
      strokeWidth: 1.5,
    };
  }
  if (it.isPlaceholder) {
    return {
      fill: "rgba(130, 135, 150, 0.16)",
      stroke: "#9ca3af",
      filter: "url(#neonGray)",
      textFill: "#e5e7eb",
      mapLabelFontSize: 13,
    };
  }
  const starLike = it.isStar || it.journalStellar === true;
  if (starLike) {
    if (it.starVisual === "neutron") {
      return {
        fill: "rgba(56,189,248,0.14)",
        stroke: "#38bdf8",
        filter: "url(#neonBlue)",
        textFill: "#7ddbfe",
      };
    }
    return {
      fill: "rgba(253, 224, 71, 0.16)",
      stroke: "#facc15",
      filter: "url(#neonSun)",
      textFill: "#fef9c3",
    };
  }

  const bl = it.baseLabel;
  if (bl === "ELW") {
    return {
      fill: "rgba(52,211,153,0.22)",
      stroke: "#4fd0ff",
      filter: "url(#neonElw)",
      textFill: "#9fe4ff",
    };
  }
  if (bl === "WW") {
    return {
      fill: "rgba(37, 99, 235, 0.22)",
      stroke: "#60a5fa",
      filter: "url(#neonWw)",
      textFill: "#93c5fd",
    };
  }
  if (bl === "AW") {
    return {
      fill: "rgba(234,179,8,0.24)",
      stroke: "#facc15",
      filter: "url(#neonAw)",
      textFill: "#fde047",
    };
  }
  if (bl === "I" || bl === "RI") {
    return {
      fill: "rgba(34, 211, 238, 0.2)",
      stroke: "#22d3ee",
      filter: "url(#neonIcy)",
      textFill: "#a5f3fc",
    };
  }
  if (bl === "R" || bl === "HMC" || bl === "MR") {
    return {
      fill: "rgba(255,122,36,0.12)",
      stroke: "#ff8a1f",
      filter: "url(#neonOrange)",
      textFill: "#ff9a4d",
    };
  }
  if (bl === "GG" || /^GG[1-5]$/.test(bl)) {
    return {
      fill: "rgba(196, 165, 116, 0.26)",
      stroke: "#c4a574",
      filter: "url(#neonGas)",
      textFill: "#e8d5b8",
    };
  }

  return {
    fill: "rgba(251, 146, 60, 0.1)",
    stroke: "#fb923c",
    filter: "url(#neonOrange)",
    textFill: "#fdba74",
  };
}

/** Under-node name: terraform *, exo tier +/++ on bodies, fuel + on scoopable stars / journal stellar. */
function mapNodeNameLine(it: LayoutItem): string {
  const base = it.displayBodyName ?? it.bodyName;
  const starLike = it.isStar || it.journalStellar === true;
  if (starLike && it.namePlus) return `${base}+`;
  if (!starLike && !it.isBarycentre) {
    if (it.exoValueTier === 2) return `${base}++`;
    if (it.exoValueTier === 1) return `${base}+`;
  }
  return base;
}

function notableBodyIsTerraformable(n: NotableBodyInfo): boolean {
  return n.tag.toLowerCase().includes("terraformable");
}

/**
 * What the map draws, said in words.
 *
 * The map has a full colour vocabulary — nine body kinds, each with its own stroke — and three
 * suffix marks, and it explained none of them. A commander could see that some rings are cyan and
 * some orange, and that some names end in `+`, without anything on screen saying which is which.
 * The colours are read from {@link systemMapNodeAppearance} rather than restated, so a change to a
 * body's colour cannot leave this describing the old one.
 *
 * `++` and `+` are the exobiology value tiers the owner sets in Options, which is why they are
 * spelled out with the setting that drives them rather than as bare symbols.
 */
function SystemMapLegend({ plusMinCr, plusPlusMinCr }: { plusMinCr: number; plusPlusMinCr: number }) {
  const swatch = (label: string, it: Partial<LayoutItem>) => {
    const a = systemMapNodeAppearance(it as LayoutItem);
    return (
      <span className="system-map-legend-item" key={label}>
        <span
          className="system-map-legend-dot"
          style={{ background: a.fill, borderColor: a.stroke }}
          aria-hidden="true"
        />
        {label}
      </span>
    );
  };

  return (
    <div className="system-map-legend">
      <div className="system-map-legend-row">
        {swatch("Star", { isStar: true })}
        {swatch("Neutron", { isStar: true, starVisual: "neutron" })}
        {swatch("Earth-like", { baseLabel: "ELW" })}
        {swatch("Water", { baseLabel: "WW" })}
        {swatch("Ammonia", { baseLabel: "AW" })}
        {swatch("Icy", { baseLabel: "I" })}
        {swatch("Rocky / HMC", { baseLabel: "R" })}
        {swatch("Gas giant", { baseLabel: "GG" })}
        {swatch("Barycentre", { isBarycentre: true })}
        {swatch("Not yet scanned", { isPlaceholder: true })}
      </div>
      <div className="system-map-legend-row system-map-legend-row--marks">
        <span className="system-map-legend-item">
          <b>*</b> terraformable
        </span>
        <span className="system-map-legend-item">
          <b>+</b> exobiology worth ≥ {plusMinCr.toLocaleString()} CR
        </span>
        <span className="system-map-legend-item">
          <b>++</b> ≥ {plusPlusMinCr.toLocaleString()} CR
        </span>
        <span className="system-map-legend-item">
          <b>+</b> on a star: scoopable
        </span>
        <span className="system-map-legend-item dim">
          Scroll to zoom · drag to pan · double-click to reset
        </span>
      </div>
    </div>
  );
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
  const mapHeading = systemTitleName.length > 0 ? `System map - ${systemTitleName}` : "System map";
  const layout = useMemo(() => (map ? computeSystemMapLayout(map.tree, map.starSystem ?? "") : null), [map]);
  const layoutKey = layout != null ? `${layout.minX},${layout.minY},${layout.width},${layout.height}` : "";

  /** How many bodies the map draws that carry biology — the count beside the toggle. */
  const bioCount = useMemo(
    () => layout?.items.filter((it) => map?.detailsByBodyId[String(it.bodyId)]?.hasExobiology).length ?? null,
    [layout, map],
  );

  /**
   * The body the main panel is showing, so the map and the panel visibly agree.
   *
   * `uiSelectedBodyKey` is `${systemAddress}:${bodyId}`; the map only knows body ids, so the id is
   * taken off the end. Comparing the whole key would need the address threaded in for no gain — the
   * map only ever draws one system.
   */
  const selectedBodyId = useMemo(() => {
    const key = snap.uiSelectedBodyKey;
    if (!key) return null;
    const id = Number(key.slice(key.lastIndexOf(":") + 1));
    return Number.isFinite(id) ? id : null;
  }, [snap.uiSelectedBodyKey]);
  /**
   * Fade everything that is not carrying biology, rather than removing it.
   *
   * Measured on the owner's home system: 39 nodes, 2 with biology, and **both are moons whose
   * parent planet has none**. Deleting barren bodies would therefore orphan the only two worth
   * flying to, and rebuilding the tree around that is a layout problem where this is a reading
   * problem. Dimming keeps every orbit where it was, so the eye still finds the pair by their
   * position under the planet they belong to.
   */
  const [bioOnly, setBioOnly] = useState(false);
  const [mapZoom, setMapZoom] = useState(1);
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const mapWheelRef = useRef<HTMLDivElement | null>(null);
  const mapSvgRef = useRef<SVGSVGElement | null>(null);
  const mapDragRef = useRef<{ lastClientX: number; lastClientY: number; total: number } | null>(null);
  const suppressNextMapNodeClickRef = useRef(false);

  const [popup, setPopup] = useState<{ bodyId: number; x: number; y: number } | null>(null);

  const detail = useMemo(() => {
    if (!map || popup == null) return null;
    return map.detailsByBodyId[String(popup.bodyId)] ?? null;
  }, [map, popup]);

  const clickedMapItem = useMemo(() => {
    if (popup == null || layout == null) return null;
    return layout.items.find((it) => it.bodyId === popup.bodyId) ?? null;
  }, [popup, layout]);

  const closePopup = useCallback(() => setPopup(null), []);

  useEffect(() => {
    setMapZoom(1);
    setMapPan({ x: 0, y: 0 });
  }, [layoutKey]);

  useEffect(() => {
    const el = mapWheelRef.current;
    if (!el || !layout) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      const factor = Math.exp(dir * 0.11);
      setMapZoom((z) => Math.min(220, Math.max(0.012, z * factor)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [layout]);

  /** Escape closes the body popup first, then the map; useModal adds trap, restore and scroll lock. */
  const closeTopLayer = useCallback(() => {
    if (popup) closePopup();
    else onClose();
  }, [onClose, popup, closePopup]);

  const dialogRef = useModal<HTMLDivElement>(true, closeTopLayer);

  if (!map) {
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
            <div
              key={`system-map-fss-prompt-${snap.viewingSystemAddress ?? snap.currentSystemAddress ?? "na"}`}
              className="system-map-fss-required"
              role="img"
              aria-label="No merged Scan data for this system yet. FSS the system so journal lines populate bodies."
            />
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

  if (!layout || layout.width <= 0) {
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
            <button type="button" className="modal-close" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="modal-body">
            {snap.dScanBodies ? (
              <div className="system-map-dscan-wrap system-map-dscan-wrap--head">
                <DScanBodiesBadge d={snap.dScanBodies} />
              </div>
            ) : null}
            <p className="dim">No layout data.</p>
          </div>
        </div>
      </div>
    );
  }

  const lc = layout.minX + layout.width / 2;
  const lcy = layout.minY + layout.height / 2;
  const vw = layout.width / mapZoom;
  const vh = layout.height / mapZoom;
  const rq = (n: number) => Math.round(n * 1000) / 1000;
  const vb = `${rq(lc + mapPan.x - vw / 2)} ${rq(lcy + mapPan.y - vh / 2)} ${rq(vw)} ${rq(vh)}`;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-panel system-map-panel system-map-panel--wide"
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
                  className={`system-map-notable-pill${n.dssMapped ? " system-map-notable-pill--dss" : " system-map-notable-pill--fss"}`}
                  title={
                    n.dssMapped
                      ? "DSS complete in merged journal (SAAScanComplete)"
                      : "Scan in journal — DSS not complete for this body"
                  }
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setPopup({ bodyId: n.bodyId, x: ev.clientX, y: ev.clientY });
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

        {/*
          The zoom existed and was invisible: wheel to scale, double-click to reset, and nothing on
          screen saying so. Buttons make it discoverable and give a keyboard and touch route to the
          same state, and the readout doubles as the hint that the map is zoomable at all.
        */}
        <div className="system-map-zoom" role="group" aria-label="Map zoom">
          <button
            type="button"
            onClick={() => setMapZoom((z) => Math.max(0.012, z / 1.3))}
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="system-map-zoom-val">{Math.round(mapZoom * 100)}%</span>
          <button
            type="button"
            onClick={() => setMapZoom((z) => Math.min(220, z * 1.3))}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => {
              setMapZoom(1);
              setMapPan({ x: 0, y: 0 });
            }}
          >
            Reset
          </button>
          <label className="system-map-bioonly">
            <input type="checkbox" checked={bioOnly} onChange={(e) => setBioOnly(e.target.checked)} />
            <span>
              Biology only
              {bioCount != null ? <span className="dim"> ({bioCount})</span> : null}
            </span>
          </label>
        </div>

        <div
          ref={mapWheelRef}
          className="system-map-svg-wrap card-neon"
          onClick={() => closePopup()}
          onDoubleClick={(ev) => {
            ev.stopPropagation();
            setMapZoom(1);
            setMapPan({ x: 0, y: 0 });
          }}
          role="presentation"
        >
          <svg
            ref={mapSvgRef}
            className="system-map-svg"
            viewBox={vb}
            preserveAspectRatio="xMidYMid meet"
            onPointerDown={(ev) => {
              if (ev.pointerType === "mouse" && ev.button !== 0) return;
              const el = ev.target as Element | null;
              if (el && typeof el.closest === "function" && el.closest(".system-map-node-g")) {
                /** Let clicks reach map node groups — preventDefault + capture would suppress `click`. */
                return;
              }
              ev.preventDefault();
              const svg = mapSvgRef.current;
              if (!svg) return;
              svg.setPointerCapture(ev.pointerId);
              mapDragRef.current = { lastClientX: ev.clientX, lastClientY: ev.clientY, total: 0 };
            }}
            onPointerMove={(ev) => {
              const d = mapDragRef.current;
              if (!d) return;
              const svg = mapSvgRef.current;
              if (!svg) return;
              const rect = svg.getBoundingClientRect();
              const pw = rect.width;
              const ph = rect.height;
              if (pw < 1 || ph < 1) return;
              const dcx = ev.clientX - d.lastClientX;
              const dcy = ev.clientY - d.lastClientY;
              d.lastClientX = ev.clientX;
              d.lastClientY = ev.clientY;
              d.total += Math.hypot(dcx, dcy);
              const vw = layout.width / mapZoom;
              const vh = layout.height / mapZoom;
              const ix = (dcx * vw) / pw;
              const iy = (dcy * vh) / ph;
              setMapPan((prev) => ({ x: prev.x - ix, y: prev.y - iy }));
            }}
            onPointerUp={(ev) => {
              const d = mapDragRef.current;
              if (d && d.total > 8) suppressNextMapNodeClickRef.current = true;
              mapDragRef.current = null;
              try {
                mapSvgRef.current?.releasePointerCapture(ev.pointerId);
              } catch {
                /* not captured */
              }
            }}
            onPointerCancel={(ev) => {
              mapDragRef.current = null;
              try {
                mapSvgRef.current?.releasePointerCapture(ev.pointerId);
              } catch {
                /* not captured */
              }
            }}
          >
            <defs>
              <filter id="neonOrange" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="0" stdDeviation="1.2" floodColor="#ff8a1f" floodOpacity="0.55" />
              </filter>
              <filter id="neonGreen" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="0" stdDeviation="1.2" floodColor="#4fd0ff" floodOpacity="0.55" />
              </filter>
              <filter id="neonBlue" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="0" stdDeviation="1.4" floodColor="#38bdf8" floodOpacity="0.65" />
              </filter>
              <filter id="neonElw" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="0" stdDeviation="1.35" floodColor="#4fd0ff" floodOpacity="0.72" />
              </filter>
              <filter id="neonWw" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="0" stdDeviation="1.45" floodColor="#3b82f6" floodOpacity="0.72" />
              </filter>
              <filter id="neonAw" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="0" stdDeviation="1.25" floodColor="#facc15" floodOpacity="0.68" />
              </filter>
              <filter id="neonGray" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="0" stdDeviation="1.35" floodColor="#9ca3af" floodOpacity="0.65" />
              </filter>
              <filter id="neonSun" x="-45%" y="-45%" width="190%" height="190%">
                <feDropShadow dx="0" dy="0" stdDeviation="1.35" floodColor="#facc15" floodOpacity="0.72" />
              </filter>
              <filter id="neonIcy" x="-45%" y="-45%" width="190%" height="190%">
                <feDropShadow dx="0" dy="0" stdDeviation="1.4" floodColor="#22d3ee" floodOpacity="0.78" />
              </filter>
              <filter id="neonGas" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="0" stdDeviation="1.2" floodColor="#c4a574" floodOpacity="0.62" />
              </filter>
            </defs>
            <g className="system-map-edges">
              {layout.segments.map((s, i) => (
                <line
                  key={`e-${i}-${s.x1}-${s.y1}`}
                  x1={s.x1}
                  y1={s.y1}
                  x2={s.x2}
                  y2={s.y2}
                  className="system-map-line"
                />
              ))}
              {layout.bracketSegments.map((s, i) => (
                <line
                  key={`b-${i}-${s.x1}-${s.y1}`}
                  x1={s.x1}
                  y1={s.y1}
                  x2={s.x2}
                  y2={s.y2}
                  className="system-map-line system-map-bracket"
                />
              ))}
            </g>
            {layout.items.map((it) => {
              let neo = systemMapNodeAppearance(it);
              if (it.isArrivalBody) {
                neo = { ...neo, stroke: "#ffd23f", strokeWidth: Math.max(neo.strokeWidth ?? 2, 2.6) };
              }
              const sw = neo.strokeWidth ?? 2;
              const fs = neo.mapLabelFontSize ?? (it.mapLabel.length > 5 ? 8.5 : 10);
              const nameDy = it.r + (it.isBarycentre ? 17 : 13);
              const det = map?.detailsByBodyId[String(it.bodyId)];
              const atmoRing =
                det && !it.isStar && it.journalStellar !== true && !it.isBarycentre && !it.isPlaceholder
                  ? atmosphereRingColor(det.atmosphereType || det.atmosphere)
                  : null;
              const starRays = it.isStar || it.journalStellar === true;
              const rayStroke = neo.stroke;
              const rayOpacity = it.starVisual === "neutron" ? 0.44 : 0.36;
              // Stars and barycentres stay lit under the filter: they are the scaffolding that makes
              // the tree readable, and fading them would leave the survivors floating.
              const structural = starRays || it.isBarycentre;
              const dimmed = bioOnly && !structural && !det?.hasExobiology;
              const isSelected = selectedBodyId != null && it.bodyId === selectedBodyId;
              return (
                <g
                  key={it.bodyId}
                  className={`system-map-node-g${dimmed ? " system-map-node-g--dim" : ""}${
                    isSelected ? " system-map-node-g--selected" : ""
                  }`}
                  style={{ cursor: "pointer" }}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    if (suppressNextMapNodeClickRef.current) {
                      suppressNextMapNodeClickRef.current = false;
                      return;
                    }
                    setPopup({ bodyId: it.bodyId, x: ev.clientX, y: ev.clientY });
                  }}
                >
                  {starRays ? (
                    <g className="system-map-star-rays" pointerEvents="none">
                      {Array.from({ length: 12 }, (_, i) => {
                        const a = (Math.PI * 2 * i) / 12 - Math.PI / 2;
                        const r0 = it.r * 1.05;
                        const r1 = it.r * 1.78;
                        return (
                          <line
                            key={i}
                            x1={it.cx + Math.cos(a) * r0}
                            y1={it.cy + Math.sin(a) * r0}
                            x2={it.cx + Math.cos(a) * r1}
                            y2={it.cy + Math.sin(a) * r1}
                            stroke={rayStroke}
                            strokeWidth={1.2}
                            strokeLinecap="round"
                            opacity={rayOpacity}
                          />
                        );
                      })}
                    </g>
                  ) : null}
                  <circle
                    cx={it.cx}
                    cy={it.cy}
                    r={it.r}
                    fill={neo.fill}
                    stroke={neo.stroke}
                    strokeWidth={sw}
                    filter={neo.filter}
                  />
                  {atmoRing ? (
                    <circle
                      cx={it.cx}
                      cy={it.cy}
                      r={it.r + Math.max(3, sw * 1.1)}
                      fill="none"
                      stroke={atmoRing}
                      strokeWidth={1.15}
                      strokeDasharray="3 5"
                      strokeLinecap="round"
                      opacity={0.95}
                      style={{ filter: `drop-shadow(0 0 5px ${atmoRing})` }}
                      pointerEvents="none"
                    />
                  ) : null}
                  {it.mapLabel ? (
                    <text
                      x={it.cx}
                      y={it.cy}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="system-map-svg-text"
                      fill={neo.textFill}
                      fontSize={fs}
                      fontWeight={800}
                    >
                      {it.mapLabel}
                    </text>
                  ) : null}
                  <text
                    x={it.cx}
                    y={it.cy + nameDy}
                    textAnchor="middle"
                    className="system-map-svg-name"
                    fill="#a8a4b8"
                    fontSize={9}
                  >
                    {mapNodeNameLine(it)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <SystemMapLegend plusMinCr={snap.exoMapTierPlusMinCr} plusPlusMinCr={snap.exoMapTierPlusPlusMinCr} />

        {popup ? (
          <PlanetQuickFactsPopup
            detail={detail}
            fallbackTitle={
              clickedMapItem?.displayBodyName ?? clickedMapItem?.bodyName ?? `Body ${popup.bodyId}`
            }
            bodyId={popup.bodyId}
            onClose={closePopup}
            onGoToBioBody={onGoToBioBody}
            pos={{ left: popup.x, top: popup.y }}
          />
        ) : null}
      </div>
    </div>
  );
});
