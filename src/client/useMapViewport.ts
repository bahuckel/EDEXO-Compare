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
import { useCallback, useRef, useState } from "react";
import type { Camera } from "./galaxyProjection";

export interface Viewport {
  scale: number;
  /** Translation in screen units, applied after scaling. */
  tx: number;
  ty: number;
}

export const IDENTITY: Viewport = { scale: 1, tx: 0, ty: 0 };

const MIN_SCALE = 1;
const MAX_SCALE = 60;

export interface MapViewport {
  view: Viewport;
  camera: Camera;
  setCamera: (next: Camera) => void;
  /** `transform` for the group holding everything that should move. */
  transform: string;
  /** Divide a pixel size by this to keep it constant on screen. */
  pixel: number;
  reset: () => void;
  zoomBy: (factor: number, at?: { x: number; y: number }) => void;
  handlers: {
    onWheel: (e: React.WheelEvent<SVGSVGElement>) => void;
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
    onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void;
    onDoubleClick: () => void;
  };
  /** True while a drag is actually moving, so click handlers can stand down. */
  panning: boolean;
}

/** Where the pointer is in the SVG's own viewBox units, not CSS pixels. */
function svgPoint(e: { clientX: number; clientY: number }, svg: SVGSVGElement): { x: number; y: number } {
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const w = vb && vb.width ? vb.width : r.width;
  const h = vb && vb.height ? vb.height : r.height;
  return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h };
}

export function useMapViewport(initialCamera: Camera): MapViewport {
  const [view, setView] = useState<Viewport>(IDENTITY);
  const [camera, setCamera] = useState<Camera>(initialCamera);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);

  const zoomAt = useCallback((factor: number, at: { x: number; y: number }) => {
    setView((v) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      if (next === v.scale) return v;
      // Keep the point under the cursor fixed: solve for the translation that leaves it in place.
      const k = next / v.scale;
      return { scale: next, tx: at.x - (at.x - v.tx) * k, ty: at.y - (at.y - v.ty) * k };
    });
  }, []);

  const zoomBy = useCallback(
    (factor: number, at?: { x: number; y: number }) => {
      // Without a point, zoom about the middle of the plot; callers pass the viewBox centre.
      zoomAt(factor, at ?? { x: 0, y: 0 });
    },
    [zoomAt],
  );

  const reset = useCallback(() => setView(IDENTITY), []);

  const onWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      // Not preventDefault: React attaches wheel passively, and the plot is not scrollable anyway.
      const svg = e.currentTarget;
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, svgPoint(e, svg));
    },
    [zoomAt],
  );

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
    const svg = e.currentTarget;
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const kx = (vb && vb.width ? vb.width : r.width) / r.width;
    const ky = (vb && vb.height ? vb.height : r.height) / r.height;
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
    camera,
    setCamera,
    transform: `translate(${view.tx} ${view.ty}) scale(${view.scale})`,
    pixel: 1 / view.scale,
    reset,
    zoomBy,
    panning,
    handlers: { onWheel, onPointerDown, onPointerMove, onPointerUp, onDoubleClick: reset },
  };
}
