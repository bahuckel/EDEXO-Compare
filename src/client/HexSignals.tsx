/**
 * Signals travelling the hex grid behind the app (owner, 2026-09-29: "the hexagonal background is
 * dated … slightly glowing / animated signals traveling across a similar hexagon pattern").
 *
 * The grid itself stays the static CSS layer (shell.css `body::before`, now a true honeycomb),
 * painted once. A canvas above it carries only the signals: a few faint pulses running along the
 * hexagon edges, turning at random corners, with a short fading trail (hexSignalsEngine.ts).
 *
 * Cost, on purpose: drawn in a worker on an OffscreenCanvas, so the page's main thread does not
 * paint them at all (drawn on the main thread first, the page was ~4.5 % busier); 30 frames a second
 * at most; nothing when the window is hidden, and nothing at all with "reduce motion" on or on a
 * touch screen (a phone on the LAN link).
 *
 * The canvas is made inside the effect, not rendered: a canvas hands its drawing to a worker once,
 * and a remount (StrictMode in development) needs a fresh one.
 */
import { useEffect, useRef } from "react";
import { runHexSignals } from "./hexSignalsEngine";

export function HexSignals() {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (motion?.matches) return;
    // Phones on the LAN link: a battery, not a desk. The grid stays; the signals are for the PC.
    if (window.matchMedia?.("(pointer: coarse)").matches) return;

    const canvas = document.createElement("canvas");
    canvas.className = "hex-signals";
    el.appendChild(canvas);

    // The layout viewport, as the fixed CSS grid sees it (no scrollbar).
    const size = () => ({
      w: document.documentElement.clientWidth || window.innerWidth,
      h: document.documentElement.clientHeight || window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    });

    let stop: () => void = () => {};
    let resize: () => void = () => {};
    if (typeof canvas.transferControlToOffscreen === "function" && typeof Worker === "function") {
      const worker = new Worker(new URL("./hexSignals.worker.ts", import.meta.url), { type: "module" });
      const off = canvas.transferControlToOffscreen();
      worker.postMessage({ type: "start", canvas: off, ...size() }, [off]);
      resize = () => worker.postMessage({ type: "resize", ...size() });
      stop = () => worker.terminate();
    } else {
      const handle = runHexSignals(canvas, size(), (w, h) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        return c;
      });
      if (handle) {
        resize = () => {
          const n = size();
          handle.resize(n.w, n.h, n.dpr);
        };
        stop = () => handle.stop();
      }
    }

    window.addEventListener("resize", resize);
    const onMotion = () => {
      if (motion?.matches) {
        stop();
        canvas.remove();
      }
    };
    motion?.addEventListener?.("change", onMotion);
    return () => {
      window.removeEventListener("resize", resize);
      motion?.removeEventListener?.("change", onMotion);
      stop();
      canvas.remove();
    };
  }, []);

  return <div ref={host} aria-hidden="true" />;
}
