/**
 * The life in the hex grid behind the app (owner, 2026-09-29: "the hexagonal background is dated";
 * 2026-09-30: "a dull shimmer … that just adds some liveliness", and on the phone too).
 *
 * The grid itself stays the static CSS layer (shell.css `body::before`, a true honeycomb), painted
 * once. A canvas above it carries a faint glimmer of hexagon outlines and a few dim signals along the
 * edges (hexSignalsEngine.ts).
 *
 * Cost, on purpose: drawn in a worker on an OffscreenCanvas, so the page's main thread does not paint
 * it; 30 frames a second at most (15 on a phone, glimmer only); nothing when the window is hidden, and
 * nothing at all with "reduce motion" on.
 *
 * Strength: `?backdrop=soft` (default) or `?backdrop=faint`, remembered in this browser — two levels
 * for the owner to choose between. Options → Colour scheme → "Animated background" turns it off and
 * on again at once (owner, 2026-09-30); the static grid stays either way. Per device, on by default.
 *
 * The canvas is made inside the effect, not rendered: a canvas hands its drawing to a worker once,
 * and a remount (StrictMode in development) needs a fresh one.
 */
import { useEffect, useRef, useState } from "react";
import { APP_THEME_EVENT, backdropAccentRgb } from "./appTheme";
import { runHexSignals, type BackdropLevel, type BackdropOptions } from "./hexSignalsEngine";

const LEVEL_KEY = "edexo.backdrop";
const OFF_KEY = "edexo.backdropOff";
const BACKDROP_EVENT = "edexo-backdrop";

export function readBackdropOn(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) !== "1";
  } catch {
    return true;
  }
}

export function setBackdropOn(on: boolean): void {
  try {
    if (on) localStorage.removeItem(OFF_KEY);
    else localStorage.setItem(OFF_KEY, "1");
  } catch {
    /* applied for this session anyway */
  }
  window.dispatchEvent(new CustomEvent(BACKDROP_EVENT, { detail: on }));
}

function backdropLevel(): BackdropLevel {
  try {
    const q = new URLSearchParams(window.location.search).get("backdrop");
    if (q === "soft" || q === "faint") {
      localStorage.setItem(LEVEL_KEY, q);
      return q;
    }
    const saved = localStorage.getItem(LEVEL_KEY);
    return saved === "faint" ? "faint" : "soft";
  } catch {
    return "soft";
  }
}

export function HexSignals() {
  const host = useRef<HTMLDivElement | null>(null);
  const [on, setOn] = useState(readBackdropOn);

  useEffect(() => {
    const onToggle = (ev: Event) => setOn((ev as CustomEvent<boolean>).detail !== false);
    window.addEventListener(BACKDROP_EVENT, onToggle);
    return () => window.removeEventListener(BACKDROP_EVENT, onToggle);
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (!on) {
      el.setAttribute("data-backdrop", "off: option");
      return;
    }
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    // Which way it runs, readable in devtools (`data-backdrop` on this element) when it seems missing.
    const mark = (state: string) => el.setAttribute("data-backdrop", state);
    if (motion?.matches) {
      mark("off: reduce motion");
      return;
    }
    // A phone on the LAN link: the glimmer only, at half the frame rate.
    const phone = window.matchMedia?.("(pointer: coarse)").matches === true;
    const opts: BackdropOptions = {
      level: backdropLevel(),
      signals: !phone,
      fps: phone ? 15 : 30,
      accentRgb: backdropAccentRgb(),
    };

    let canvas = document.createElement("canvas");
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
    let setAccent: (rgb: string | null) => void = () => {};
    /* On the page's own thread: browsers without OffscreenCanvas, or a worker that failed to start. */
    const runHere = () => {
      const handle = runHexSignals(canvas, size(), opts);
      if (!handle) {
        mark("failed: no 2D canvas");
        return;
      }
      mark(`main thread · ${opts.level}${opts.signals ? "" : " · glimmer only"}`);
      resize = () => {
        const n = size();
        handle.resize(n.w, n.h, n.dpr);
      };
      stop = () => handle.stop();
      setAccent = (rgb) => handle.setAccent(rgb);
    };
    if (typeof canvas.transferControlToOffscreen === "function" && typeof Worker === "function") {
      try {
        const worker = new Worker(new URL("./hexSignals.worker.ts", import.meta.url), { type: "module" });
        const off = canvas.transferControlToOffscreen();
        worker.postMessage({ type: "start", canvas: off, ...size(), opts }, [off]);
        mark(`worker · ${opts.level}${opts.signals ? "" : " · glimmer only"}`);
        resize = () => worker.postMessage({ type: "resize", ...size() });
        setAccent = (rgb) => worker.postMessage({ type: "accent", rgb });
        stop = () => worker.terminate();
        // A worker that cannot load (an older phone browser, a blocked file) would leave the canvas it
        // was handed blank for good: start again on the page's own thread with a fresh canvas.
        worker.addEventListener("error", () => {
          worker.terminate();
          canvas.remove();
          canvas = document.createElement("canvas");
          canvas.className = "hex-signals";
          el.appendChild(canvas);
          runHere();
        });
      } catch {
        runHere();
      }
    } else {
      runHere();
    }

    // Through a wrapper: a fallback start replaces `resize`.
    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    const onTheme = () => setAccent(backdropAccentRgb());
    window.addEventListener(APP_THEME_EVENT, onTheme);
    const onMotion = () => {
      if (motion?.matches) {
        stop();
        canvas.remove();
      }
    };
    motion?.addEventListener?.("change", onMotion);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener(APP_THEME_EVENT, onTheme);
      motion?.removeEventListener?.("change", onMotion);
      stop();
      canvas.remove();
    };
  }, [on]);

  return <div ref={host} aria-hidden="true" />;
}
