/**
 * Zoom and pan for an SVG plot, and the camera angles that go with it.
 *
 * At galaxy scale everything overlaps: a hundred thousand light years squeezed into five hundred
 * pixels puts the whole bubble inside one marker. Without a way in, the map can be looked at but not
 * used, which is what the owner reported.
 *
 * ## Zoom happens at the pointer, not at the middle
 *
 * Zooming to the centre means every zoom is followed by a pan to find what you were looking at, and
 * the thing you were looking at is exactly what moved. Anchoring at the cursor keeps the point under
 * it still — the interaction people already know from every map they have used.
 *
 * ## The transform is applied to a group, not to the coordinates
 *
 * One `translate/scale` on a `<g>`, so the geometry underneath stays in plot units and nothing has
 * to know it is being viewed. Strokes and marker radii are divided by the scale at the point of use
 * so they keep their pixel size — a zoomed-in map should show more space between dots, not fatter
 * dots.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CAMERA_TOP, type Camera } from "./galaxyProjection";

export interface Viewport {
  scale: number;
  /** Translation in screen units, applied after scaling. */
  tx: number;
  ty: number;
}

export const IDENTITY: Viewport = { scale: 1, tx: 0, ty: 0 };

const MIN_SCALE = 1;
const MAX_SCALE = 60;

export interface MapViewportOptions {
  /** Smallest scale; 1 = the viewBox as fitted. */
  minScale?: number;
  maxScale?: number;
  /**
   * Re-bind the wheel when this changes: the `<svg>` may mount after the hook first runs (a map
   * window that opens on "no data" and gets its layout later).
   */
  bindKey?: string;
}

export interface MapViewport {
  view: Viewport;
  /**
   * Attach to the `<svg>`. The wheel listener is bound here rather than through React.
   *
   * React attaches `onWheel` **passively**, and a passive listener is not allowed to call
   * `preventDefault` — so zooming the map also scrolled the page under it, which the owner
   * reported: *"scrolling on the galaxy map makes the page scroll as well"*. There is no React prop
   * that fixes this; the listener has to be registered by hand with `{ passive: false }`.
   */
  svgRef: React.RefObject<SVGSVGElement | null>;
  camera: Camera;
  setCamera: (next: Camera) => void;
  /** `transform` for the group holding everything that should move. */
  transform: string;
  /** Divide a pixel size by this to keep it constant on screen. */
  pixel: number;
  reset: () => void;
  /** Put the view somewhere exact (the snapshot fits the map, then puts it back). */
  setView: (v: Viewport) => void;
  zoomBy: (factor: number, at?: { x: number; y: number }) => void;
  handlers: {
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
    onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void;
    onDoubleClick: () => void;
  };
  /** True while a drag is actually moving, so click handlers can stand down. */
  panning: boolean;
}

/**
 * Where the pointer is in the SVG's own user units, not CSS pixels.
 *
 * Read through the screen matrix, so it stays right when the viewBox does not start at 0,0 or does
 * not share the element's aspect ratio (the system map fits a layout box of any shape, letterboxed).
 */
function svgPoint(e: { clientX: number; clientY: number }, svg: SVGSVGElement): { x: number; y: number } {
  const m = typeof svg.getScreenCTM === "function" ? svg.getScreenCTM() : null;
  if (m && typeof svg.createSVGPoint === "function") {
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(m.inverse());
    return { x: q.x, y: q.y };
  }
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const w = vb && vb.width ? vb.width : r.width;
  const h = vb && vb.height ? vb.height : r.height;
  return {
    x: (vb?.x ?? 0) + ((e.clientX - r.left) / r.width) * w,
    y: (vb?.y ?? 0) + ((e.clientY - r.top) / r.height) * h,
  };
}

/** User units per CSS pixel along x and y. */
function unitsPerPixel(svg: SVGSVGElement): { kx: number; ky: number } {
  const m = typeof svg.getScreenCTM === "function" ? svg.getScreenCTM() : null;
  if (m && m.a && m.d) return { kx: 1 / m.a, ky: 1 / m.d };
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  return {
    kx: (vb && vb.width ? vb.width : r.width) / r.width,
    ky: (vb && vb.height ? vb.height : r.height) / r.height,
  };
}

export function useMapViewport(
  initialCamera: Camera = CAMERA_TOP,
  opts: MapViewportOptions = {},
): MapViewport {
  const minScale = opts.minScale ?? MIN_SCALE;
  const maxScale = opts.maxScale ?? MAX_SCALE;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<Viewport>(IDENTITY);
  const [camera, setCamera] = useState<Camera>(initialCamera);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);

  const zoomAt = useCallback(
    (factor: number, at: { x: number; y: number }) => {
      setView((v) => {
        const next = Math.min(maxScale, Math.max(minScale, v.scale * factor));
        if (next === v.scale) return v;
        // Keep the point under the cursor fixed: solve for the translation that leaves it in place.
        const k = next / v.scale;
        return { scale: next, tx: at.x - (at.x - v.tx) * k, ty: at.y - (at.y - v.ty) * k };
      });
    },
    [minScale, maxScale],
  );

  const zoomBy = useCallback(
    (factor: number, at?: { x: number; y: number }) => {
      // Without a point, zoom about the middle of the plot; callers pass the viewBox centre.
      zoomAt(factor, at ?? { x: 0, y: 0 });
    },
    [zoomAt],
  );

  const reset = useCallback(() => setView(IDENTITY), []);

  /**
   * Wheel-to-zoom, bound by hand so it can swallow the scroll.
   *
   * The plot fills the width of the page now, so a commander reaching for the map with the wheel
   * has no way to avoid it — and with a passive listener every zoom also scrolled the page out
   * from under them. `preventDefault` needs a listener registered with `{ passive: false }`, which
   * React's `onWheel` prop cannot give.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, svgPoint(e, svg));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt, opts.bindKey]);

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    // A few pixels of slop, so a click with a shaky hand is still a click.
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    if (!d.moved) {
      d.moved = true;
      setPanning(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const { kx, ky } = unitsPerPixel(e.currentTarget);
    d.x = e.clientX;
    d.y = e.clientY;
    setView((v) => ({ ...v, tx: v.tx + dx * kx, ty: v.ty + dy * ky }));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be gone */
      }
      // Cleared on the next frame so the click this pointer-up produces still sees `panning`.
      setTimeout(() => setPanning(false), 0);
    }
  }, []);

  return {
    view,
    svgRef,
    camera,
    setCamera,
    transform: `translate(${view.tx} ${view.ty}) scale(${view.scale})`,
    pixel: 1 / view.scale,
    reset,
    setView,
    zoomBy,
    panning,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onDoubleClick: reset },
  };
}
