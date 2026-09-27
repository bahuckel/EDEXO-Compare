/**
 * The Codex map (owner, 2026-09-27): Encyclopedia → Codex.
 *
 * The galaxy's regions with nothing on them — zoom and pan only. Click a region, choose **Bodies**
 * or **Biological**, and dots appear in that region only: systems where EDSM's codex has entries of
 * that kind. Orange = none of its entries in this commander's codex for the region yet, yellow =
 * some, green = all. The region is what counts, as it does in the game's codex: an entry logged
 * anywhere in a region is logged for every system there.
 *
 * Data provided by EDSM (nightly codex dump), a few systems per region — see `codexMap.ts`.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  CodexMapKind,
  CodexMapRegionDTO,
  CodexMapRegionsDTO,
  CodexMapStatus,
  CodexMapSystemDTO,
} from "@shared/types";
import { regionJoinKey } from "@shared/regionMap.js";
import { useModal } from "./ui/useModal";
import { useMapViewport } from "./useMapViewport";
import {
  galaxyImageRect,
  loadGalaxyImage,
  REGION_LAYER_ALPHA,
  REGION_MAP_SIZE,
  renderRegionBackdrop,
  type GalaxyImage,
  type RegionMapPayload,
} from "./regionBackdrop";
import { CopySystemButton } from "./CopySystemButton";

const X0 = -49985;
const Z0 = -24105;
const LY_PER_PX = 4096 / 83;

export const CODEX_DOT: Record<CodexMapStatus, { fill: string; label: string }> = {
  todo: { fill: "#ff8a1f", label: "Something to log" },
  partial: { fill: "#ffd23f", label: "Some logged" },
  done: { fill: "#4ade80", label: "All logged" },
};

const KIND_LABEL: Record<CodexMapKind, string> = { bodies: "Bodies", bio: "Biological" };

/** Galactic x/z → region-grid pixel (the SVG's user space; y grows down, z grows up). */
export function codexMapPoint(x: number, z: number): { px: number; py: number } {
  return { px: (x - X0) / LY_PER_PX, py: REGION_MAP_SIZE - (z - Z0) / LY_PER_PX };
}

/** Region index under a region-grid pixel, or 0 outside every region. */
function regionIndexAt(map: RegionMapPayload, px: number, py: number): number {
  const pz = REGION_MAP_SIZE - 1 - Math.floor(py);
  const x = Math.floor(px);
  if (pz < 0 || pz >= map.regionmap.length || x < 0) return 0;
  let rx = 0;
  for (const [len, idx] of map.regionmap[pz] ?? []) {
    if (x < rx + len) return idx;
    rx += len;
  }
  return 0;
}

/** The selected region, painted as a highlight, and its bounding box in grid pixels. */
function regionHighlight(
  map: RegionMapPayload,
  index: number,
  paint = true,
): { url: string | null; box: { x0: number; y0: number; x1: number; y1: number } | null } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const canvas = paint && typeof document !== "undefined" ? document.createElement("canvas") : null;
  const ctx = canvas?.getContext("2d") ?? null;
  if (canvas) {
    canvas.width = REGION_MAP_SIZE;
    canvas.height = REGION_MAP_SIZE;
  }
  const img = ctx?.createImageData(REGION_MAP_SIZE, REGION_MAP_SIZE) ?? null;
  map.regionmap.forEach((row, pz) => {
    const y = REGION_MAP_SIZE - 1 - pz;
    let x = 0;
    for (const [len, idx] of row) {
      if (idx === index) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x + len);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y + 1);
        if (img) {
          for (let k = x; k < Math.min(x + len, REGION_MAP_SIZE); k++) {
            const o = (y * REGION_MAP_SIZE + k) * 4;
            img.data[o] = 255;
            img.data[o + 1] = 170;
            img.data[o + 2] = 80;
            img.data[o + 3] = 70;
          }
        }
      }
      x += len;
    }
  });
  if (ctx && img) ctx.putImageData(img, 0, 0);
  return {
    url: canvas && ctx ? canvas.toDataURL("image/png") : null,
    box: Number.isFinite(x0) ? { x0, y0, x1, y1 } : null,
  };
}

export function CodexMapModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useModal<HTMLDivElement>(true, onClose);
  const vp = useMapViewport(undefined, { maxScale: 60, bindKey: "codex" });
  const [regionMap, setRegionMap] = useState<RegionMapPayload | null>(null);
  const [backdrop, setBackdrop] = useState<string | null>(null);
  const [galaxyImage, setGalaxyImage] = useState<GalaxyImage | null>(null);
  const [summary, setSummary] = useState<CodexMapRegionsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regionIndex, setRegionIndex] = useState<number | null>(null);
  const [kind, setKind] = useState<CodexMapKind | null>(null);
  const [region, setRegion] = useState<CodexMapRegionDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<CodexMapSystemDTO | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [wrapPx, setWrapPx] = useState(700);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/region-map")
      .then((r) => (r.ok ? (r.json() as Promise<RegionMapPayload>) : null))
      .then((d) => {
        if (cancelled || !d) return;
        setRegionMap(d);
        setBackdrop(renderRegionBackdrop(d));
      })
      .catch(() => setError("The region map could not be loaded."));
    loadGalaxyImage("/api/galaxy-image")
      .then((img) => {
        if (!cancelled && img) setGalaxyImage(img);
      })
      .catch(() => {
        /* regions on their own */
      });
    fetch("/api/codex/regions")
      .then((r) => (r.ok ? (r.json() as Promise<CodexMapRegionsDTO>) : null))
      .then((d) => {
        if (!cancelled && d) setSummary(d);
      })
      .catch(() => setError("The codex data could not be loaded."));
    return () => {
      cancelled = true;
    };
  }, []);

  // Dots keep their size on screen: user units per CSS pixel, from the plot's rendered size.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWrapPx(Math.max(200, Math.min(el.clientWidth, el.clientHeight)));
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const unit = REGION_MAP_SIZE / wrapPx / vp.view.scale;

  const regionName = regionMap && regionIndex ? (regionMap.regions[regionIndex] ?? null) : null;
  const regionSummary = useMemo(
    () => summary?.regions.find((r) => r.joinKey === regionJoinKey(regionName)) ?? null,
    [summary, regionName],
  );
  const highlight = useMemo(
    () => (regionMap && regionIndex ? regionHighlight(regionMap, regionIndex) : null),
    [regionMap, regionIndex],
  );

  const chooseRegion = useCallback(
    (index: number) => {
      setRegionIndex(index);
      setKind(null);
      setRegion(null);
      setSelected(null);
      if (!regionMap) return;
      const h = regionHighlight(regionMap, index, false);
      if (!h.box) return;
      // Zoom to the region: its box fitted into the plot, with a margin.
      const w = h.box.x1 - h.box.x0;
      const ht = h.box.y1 - h.box.y0;
      const scale = Math.min(20, Math.max(1, (0.85 * REGION_MAP_SIZE) / Math.max(w, ht, 1)));
      const cx = (h.box.x0 + h.box.x1) / 2;
      const cy = (h.box.y0 + h.box.y1) / 2;
      vp.setView({ scale, tx: REGION_MAP_SIZE / 2 - scale * cx, ty: REGION_MAP_SIZE / 2 - scale * cy });
    },
    [regionMap, vp],
  );

  const chooseKind = useCallback(
    (k: CodexMapKind) => {
      if (!regionName) return;
      setKind(k);
      setSelected(null);
      setLoading(true);
      fetch(`/api/codex/region?name=${encodeURIComponent(regionName)}&kind=${k}`)
        .then(async (r) => {
          if (!r.ok)
            throw new Error(
              ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? r.statusText,
            );
          return r.json() as Promise<CodexMapRegionDTO>;
        })
        .then((d) => setRegion(d))
        .catch((e) => {
          setRegion(null);
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => setLoading(false));
    },
    [regionName],
  );

  const onMapClick = useCallback(
    (ev: React.MouseEvent<SVGSVGElement>) => {
      if (vp.panning || !regionMap) return;
      const svg = ev.currentTarget;
      const m = svg.getScreenCTM();
      if (!m) return;
      const p = svg.createSVGPoint();
      p.x = ev.clientX;
      p.y = ev.clientY;
      const u = p.matrixTransform(m.inverse());
      const gx = (u.x - vp.view.tx) / vp.view.scale;
      const gy = (u.y - vp.view.ty) / vp.view.scale;
      const idx = regionIndexAt(regionMap, gx, gy);
      if (idx > 0) chooseRegion(idx);
    },
    [vp, regionMap, chooseRegion],
  );

  const kindSummary = regionSummary && kind ? regionSummary.kinds[kind] : null;
  const dots = region?.systems ?? [];
  // Draw greens first so the systems with something left to log sit on top.
  const order: Record<CodexMapStatus, number> = { done: 0, partial: 1, todo: 2 };
  const drawn = [...dots].sort((a, b) => order[a.status] - order[b.status]);

  return (
    <div
      className="modal-backdrop codex-map-backdrop"
      role="presentation"
      onClick={(ev) => {
        // Opened over the Encyclopedia: a click out here closes the codex, not both.
        ev.stopPropagation();
        onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-panel codex-map-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="codex-map-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="codex-map-title">Codex{regionName ? ` — ${regionName}` : ""}</h3>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
            title="Close the codex"
          >
            ×
          </button>
        </div>
        <div className="codex-map-body">
          <div className="codex-map-wrap" ref={wrapRef}>
            <svg
              ref={vp.svgRef}
              className="codex-map-svg"
              viewBox={`0 0 ${REGION_MAP_SIZE} ${REGION_MAP_SIZE}`}
              preserveAspectRatio="xMidYMid meet"
              onPointerDown={vp.handlers.onPointerDown}
              onPointerMove={vp.handlers.onPointerMove}
              onPointerUp={vp.handlers.onPointerUp}
              onClick={onMapClick}
              style={{ cursor: vp.panning ? "grabbing" : "pointer" }}
              role="img"
              aria-label="Galaxy regions. Click a region to choose it."
            >
              <rect
                x={-4000}
                y={-4000}
                width={REGION_MAP_SIZE + 8000}
                height={REGION_MAP_SIZE + 8000}
                fill="#05060a"
              />
              <g transform={vp.transform}>
                {galaxyImage
                  ? (() => {
                      const r = galaxyImageRect(galaxyImage.width, galaxyImage.height);
                      return (
                        <image
                          href={galaxyImage.url}
                          x={r.x}
                          y={r.y}
                          width={r.width}
                          height={r.height}
                          preserveAspectRatio="none"
                          pointerEvents="none"
                        />
                      );
                    })()
                  : null}
                {backdrop ? (
                  <image
                    href={backdrop}
                    x={0}
                    y={0}
                    width={REGION_MAP_SIZE}
                    height={REGION_MAP_SIZE}
                    opacity={galaxyImage ? REGION_LAYER_ALPHA * 2 : 1}
                    style={{ imageRendering: "pixelated" }}
                    pointerEvents="none"
                  />
                ) : null}
                {highlight?.url ? (
                  <image
                    href={highlight.url}
                    x={0}
                    y={0}
                    width={REGION_MAP_SIZE}
                    height={REGION_MAP_SIZE}
                    style={{ imageRendering: "pixelated" }}
                    pointerEvents="none"
                  />
                ) : null}
                {drawn.map((s) => {
                  const { px, py } = codexMapPoint(s.x, s.z);
                  const on = selected?.systemAddress === s.systemAddress;
                  return (
                    <circle
                      key={s.systemAddress}
                      cx={px}
                      cy={py}
                      r={(on ? 7 : 4.5) * unit}
                      fill={CODEX_DOT[s.status].fill}
                      stroke={on ? "#ffffff" : "#05060a"}
                      strokeWidth={(on ? 2 : 1) * unit}
                      style={{ cursor: "pointer" }}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        if (!vp.panning) setSelected(s);
                      }}
                    >
                      <title>{`${s.name} — ${CODEX_DOT[s.status].label} (${s.entries.filter((e) => e.logged).length}/${s.entries.length})`}</title>
                    </circle>
                  );
                })}
              </g>
            </svg>
            <div className="codex-map-zoom" role="group" aria-label="Map zoom">
              <button type="button" onClick={() => vp.zoomBy(1.4, { x: 1024, y: 1024 })} aria-label="Zoom in">
                +
              </button>
              <button
                type="button"
                onClick={() => vp.zoomBy(1 / 1.4, { x: 1024, y: 1024 })}
                aria-label="Zoom out"
              >
                −
              </button>
              <button type="button" onClick={() => vp.reset()} title="Show the whole galaxy">
                Galaxy
              </button>
            </div>
          </div>

          <aside className="codex-map-side card-neon" aria-label="Codex region">
            {error ? <p className="codex-map-error">{error}</p> : null}
            {summary && !summary.available ? (
              <p className="dim small">This build has no codex data (data/codex/edsm-codex-regions.json).</p>
            ) : null}
            {!regionName ? (
              <>
                <p className="small">Click a region on the map, or pick one here.</p>
                <ul className="codex-map-region-list">
                  {(summary?.regions ?? []).map((r) => {
                    const idx = regionMap?.regions.findIndex((n) => regionJoinKey(n) === r.joinKey) ?? -1;
                    const logged = r.kinds.bodies.logged + r.kinds.bio.logged;
                    const total = r.kinds.bodies.entries + r.kinds.bio.entries;
                    return (
                      <li key={r.name}>
                        <button
                          type="button"
                          disabled={idx <= 0}
                          onClick={() => idx > 0 && chooseRegion(idx)}
                        >
                          <span>{r.name}</span>
                          <span className="dim tiny">
                            {logged}/{total}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <>
                <div className="codex-map-region-head">
                  <strong>{regionName}</strong>
                  <button
                    type="button"
                    className="linkish tiny"
                    onClick={() => {
                      setRegionIndex(null);
                      setKind(null);
                      setRegion(null);
                      setSelected(null);
                      vp.reset();
                    }}
                  >
                    All regions
                  </button>
                </div>
                <div className="codex-map-kinds" role="group" aria-label="What to show">
                  {(["bodies", "bio"] as const).map((k) => {
                    const ks = regionSummary?.kinds[k];
                    return (
                      <button
                        type="button"
                        key={k}
                        className={kind === k ? "is-on" : ""}
                        aria-pressed={kind === k}
                        disabled={!ks || ks.systems === 0}
                        onClick={() => chooseKind(k)}
                      >
                        {KIND_LABEL[k]}
                        {ks ? (
                          <span className="dim tiny">
                            {" "}
                            {ks.logged}/{ks.entries}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {!kind ? (
                  <p className="dim small">Choose Bodies or Biological to place its systems.</p>
                ) : null}
                {loading ? <p className="dim small">Loading…</p> : null}
                {kind && kindSummary && !loading ? (
                  <p className="small codex-map-counts">
                    {kindSummary.systems} systems ·{" "}
                    <span style={{ color: CODEX_DOT.todo.fill }}>{kindSummary.todo} to log</span> ·{" "}
                    <span style={{ color: CODEX_DOT.partial.fill }}>{kindSummary.partial} partly</span> ·{" "}
                    <span style={{ color: CODEX_DOT.done.fill }}>{kindSummary.done} done</span>
                    <br />
                    <span className="dim">
                      {kindSummary.logged} of {kindSummary.entries} {KIND_LABEL[kind].toLowerCase()} entries
                      in your codex here
                    </span>
                  </p>
                ) : null}
                {selected ? (
                  <div className="codex-map-system">
                    <div className="codex-map-system-head">
                      <span
                        className="codex-map-dot"
                        style={{ background: CODEX_DOT[selected.status].fill }}
                      />
                      <strong>{selected.name}</strong>
                      <CopySystemButton system={selected.name} />
                    </div>
                    <ul className="codex-map-entries">
                      {[...selected.entries]
                        .sort((a, b) => Number(a.logged) - Number(b.logged) || a.name.localeCompare(b.name))
                        .map((e) => (
                          <li key={e.key} className={e.logged ? "is-logged" : ""}>
                            <span aria-hidden="true">{e.logged ? "✓" : "○"}</span> {e.name}
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : kind && dots.length ? (
                  <p className="dim small">Click a dot for what that system has.</p>
                ) : null}
              </>
            )}
            <div className="codex-map-legend small">
              {(["todo", "partial", "done"] as const).map((s) => (
                <span key={s}>
                  <span className="codex-map-dot" style={{ background: CODEX_DOT[s].fill }} />{" "}
                  {CODEX_DOT[s].label}
                </span>
              ))}
            </div>
            <p className="dim tiny codex-map-credit">
              Codex data provided by EDSM (edsm.net). A few systems per region; "logged" means in your codex
              for this region, wherever you logged it.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
