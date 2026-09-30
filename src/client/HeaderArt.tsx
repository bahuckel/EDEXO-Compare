/**
 * The header artwork (owner, 2026-10-01: the Vista Genomics picture went on 2026-09-29, "draw a new one,
 * make sure it fits well behind all of the things there, neutral or synced with app color").
 *
 * A planet's limb with a lit atmosphere, a few of the plants the app is about standing on it in outline
 * (tussock, brain tree, stratum, fungoid, bacteria, a rosette), the sample rings the app draws around
 * one of them, a distant ringed gas giant and some stars.
 *
 * Drawn, not a picture, and laid out against what is actually in the header: it runs from 350 × 476 on
 * a phone to 1816 × 135 on a wide screen, and where its cards sit moves with the width and the system
 * (a Notable card, a route card). So the plants and the top of the planet go in the widest free gap
 * along the bottom, and the gas giant in a free gap along the top; with no room, only the limb and
 * the stars show. Every colour comes from the scheme (`--accent-rgb`, the tinted neutrals), so it
 * follows the colour scheme like the rest of the app; the stars stay white. Painted once per layout
 * change, `aria-hidden`, under the header's content.
 */
import { memo, useLayoutEffect, useRef, useState } from "react";

type Plant = "tussock" | "brain" | "stratum" | "fungoid" | "bacteria" | "rosette";

/** Left to right, the middle one carries the sample rings; trimmed from both ends to fit the gap. */
const PLANTS: [Plant, number][] = [
  ["stratum", 1],
  ["bacteria", 1],
  ["tussock", 1.05],
  ["brain", 1.1],
  ["tussock", 1.3],
  ["fungoid", 1],
  ["rosette", 1],
  ["tussock", 0.95],
  ["stratum", 1.1],
];
const PLANT_STEP = 34;
/** How high the top of the planet sits above the header's bottom edge. */
const LIFT = 30;
/** The strip the plants stand in, measured up from the bottom edge. */
const PLANT_BAND = 64;
const MIN_PLANT_GAP = 110;
const GIANT_R = 16;
/** How far the atmosphere's haze reaches above the limb. */
const HAZE = 36;

/** A box something is drawn in, in the header's own pixels: left, top, right, bottom. */
type Rect = [number, number, number, number];

interface Layout {
  w: number;
  h: number;
  /** Top of the planet (x) and how many plants fit there (0: limb only, low along the bottom edge). */
  peakX: number;
  plants: number;
  giant: { x: number; y: number } | null;
  /** What is drawn in the header: no star goes behind any of it. */
  taken: Rect[];
}

/** Every box drawn in the header (cards, pills, borders) and every run of bare text. */
function drawnRects(host: HTMLElement, art: Element): Rect[] {
  const box = host.getBoundingClientRect();
  const out: Rect[] = [];
  const add = (r: DOMRect) => out.push([r.left - box.left, r.top - box.top, r.right - box.left, r.bottom - box.top]);
  for (const el of host.querySelectorAll<HTMLElement>("*")) {
    if (art.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden") continue;
    if (cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none" || parseFloat(cs.borderTopWidth) > 0) {
      add(r);
      continue;
    }
    // Bare text: the text itself, not its box (a full-width line with a few words on the left).
    for (const n of el.childNodes) {
      if (n.nodeType !== Node.TEXT_NODE || !n.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const t = range.getBoundingClientRect();
      if (t.width > 0) add(t);
    }
  }
  return out;
}

/** Free horizontal spans inside [y0, y1], between the drawn boxes (8 px kept clear on each side). */
function freeSpans(rects: Rect[], width: number, y0: number, y1: number): [number, number][] {
  const taken: [number, number][] = rects
    .filter(([, top, , bottom]) => bottom > y0 && top < y1)
    .map(([l, , r]) => [l - 8, r + 8]);
  taken.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let x = 0;
  for (const [a, b] of taken) {
    if (a > x) out.push([x, a]);
    x = Math.max(x, b);
  }
  if (x < width) out.push([x, width]);
  return out;
}

function measure(host: HTMLElement, art: Element): Layout {
  const w = host.clientWidth;
  const h = host.clientHeight;
  const taken = drawnRects(host, art);
  // The widest gap along the bottom; the right-hand one wins a near tie (the limb reads better there).
  const bottom = freeSpans(taken, w, h - PLANT_BAND, h);
  let best: [number, number] | null = null;
  for (const s of bottom) {
    if (!best || s[1] - s[0] > (best[1] - best[0]) * 0.85) best = s;
  }
  const gap = best ? best[1] - best[0] : 0;
  const plants = gap >= MIN_PLANT_GAP ? Math.min(PLANTS.length, Math.floor((gap - 40) / PLANT_STEP)) : 0;
  const peakX = best && plants > 0 ? (best[0] + best[1]) / 2 : w * 0.78;
  // The gas giant: a free gap across the top third, as far right as there is one.
  const top = freeSpans(taken, w, 0, Math.min(h * 0.4, 60)).filter((s) => s[1] - s[0] >= GIANT_R * 7);
  const g = top.at(-1);
  const giant = g ? { x: g[1] - GIANT_R * 3.5, y: Math.min(h * 0.22, 30) } : null;
  return { w, h, peakX, plants, giant, taken };
}

/** A small repeatable random sequence, so the stars sit in the same places on every paint. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** One plant in outline, drawn upright with its base at 0,0 (up is -y), about 20 px tall. */
function PlantShape({ kind }: { kind: Plant }) {
  switch (kind) {
    case "tussock":
      return (
        <g className="hart-plant">
          {[-34, -22, -11, 0, 11, 22, 34].map((a, i) => {
            const t = (a * Math.PI) / 180;
            const len = 22 - Math.abs(a) / 4;
            const x = Math.sin(t) * len;
            const y = -Math.cos(t) * len;
            return <path key={i} d={`M0 0 Q${(x * 0.3).toFixed(1)} ${(y * 0.7).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`} />;
          })}
        </g>
      );
    case "brain":
      return (
        <g className="hart-plant">
          <path d="M0 0 L0 -9" />
          <path d="M-7 -14 a7 6 0 1 1 14 0 a7 6 0 1 1 -14 0 Z" />
          <path d="M-4 -16 q2 -2 4 0 q2 2 4 0 M-5 -12 q2 2 5 0 q2 -2 4 0" />
        </g>
      );
    case "stratum":
      return (
        <g className="hart-plant">
          <path d="M-12 0 q3 -5 7 -3 q3 -4 7 -1 q4 -3 7 1 q3 -1 3 3" />
          <path d="M-8 -1 l0 -2 M-1 -3 l0 -2 M6 -2 l0 -2" />
        </g>
      );
    case "fungoid":
      return (
        <g className="hart-plant">
          <path d="M-1 0 q-1 -7 1 -13 M3 0 q1 -5 -1 -9" />
          <path d="M-8 -12 q8 -10 16 0 z" />
          <path d="M-4 -9 q3 -6 8 0" />
        </g>
      );
    case "bacteria":
      return (
        <g className="hart-plant hart-plant--dots">
          {[
            [-9, -1, 1.6],
            [-5, -3, 2],
            [0, -2, 2.4],
            [5, -3.5, 1.8],
            [9, -1.5, 1.4],
            [-2, -6, 1.3],
            [3, -7, 1.1],
          ].map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r} />
          ))}
        </g>
      );
    case "rosette":
      return (
        <g className="hart-plant">
          {[-60, -38, -18, 0, 18, 38, 60].map((a, i) => {
            const t = (a * Math.PI) / 180;
            const len = 13 - Math.abs(a) / 12;
            return <path key={i} d={`M0 0 L${(Math.sin(t) * len).toFixed(1)} ${(-Math.cos(t) * len).toFixed(1)}`} />;
          })}
          <path d="M-3 -2 q3 -4 6 0" />
        </g>
      );
  }
}

function Scene({ l }: { l: Layout }) {
  const { w, h } = l;
  // A gentle curve: wide enough that the limb runs across most of the card.
  const r = Math.max(900, w * 0.9);
  const cx = l.peakX;
  // With nothing standing on it, the limb is only a glow along the bottom edge, below any text.
  const cy = h - (l.plants > 0 ? LIFT : 4) + r;
  const rnd = seeded(Math.round(w) * 7 + Math.round(h));
  const stars: [number, number, number, number][] = [];
  const want = Math.round((w * h) / 3600);
  for (let n = 0; stars.length < want && n < want * 4; n++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const size = 0.4 + rnd() * 0.8;
    const a = 0.15 + rnd() * 0.45;
    if ((x - cx) ** 2 + (y - cy) ** 2 < (r + 6) ** 2) continue;
    // Never behind text or a card: a white dot in a letter reads as a speck on the glass.
    if (l.taken.some(([a0, b0, a1, b1]) => x > a0 - 6 && x < a1 + 6 && y > b0 - 6 && y < b1 + 6)) continue;
    stars.push([x, y, size, a]);
  }
  // The plants, centred on the top of the planet, standing along its curve.
  const start = Math.floor((PLANTS.length - l.plants) / 2);
  const chosen = PLANTS.slice(start, start + l.plants);
  const ringed = Math.floor(chosen.length / 2);
  const g = l.giant;
  return (
    <>
      <defs>
        {/* The lit side of the atmosphere, strongest right at the limb. */}
        <radialGradient id="hart-haze" cx={cx} cy={cy} r={r + HAZE} gradientUnits="userSpaceOnUse">
          <stop offset={(r - 4) / (r + HAZE)} className="hart-stop-haze-0" />
          <stop offset={(r + 2) / (r + HAZE)} className="hart-stop-haze-1" />
          <stop offset="1" className="hart-stop-haze-2" />
        </radialGradient>
        <radialGradient id="hart-ground" cx={cx} cy={cy - r} r={Math.min(r, w) * 0.6} gradientUnits="userSpaceOnUse">
          <stop offset="0" className="hart-stop-ground-0" />
          <stop offset="1" className="hart-stop-ground-1" />
        </radialGradient>
        <radialGradient id="hart-giant" cx="0.35" cy="0.35" r="0.75">
          <stop offset="0" className="hart-stop-giant-0" />
          <stop offset="1" className="hart-stop-giant-1" />
        </radialGradient>
      </defs>
      {stars.map(([x, y, s, a], i) => (
        <circle key={i} className="hart-star" cx={x.toFixed(1)} cy={y.toFixed(1)} r={s.toFixed(2)} style={{ opacity: a }} />
      ))}
      {g ? (
        <g className="hart-giant" transform={`rotate(-14 ${g.x.toFixed(1)} ${g.y.toFixed(1)})`}>
          <ellipse className="hart-giant-ring hart-giant-ring--back" cx={g.x} cy={g.y} rx={GIANT_R * 2.1} ry={GIANT_R * 0.42} />
          <circle cx={g.x} cy={g.y} r={GIANT_R} fill="url(#hart-giant)" />
          <path
            className="hart-giant-band"
            d={`M${g.x - GIANT_R * 0.9} ${g.y - GIANT_R * 0.25} q${GIANT_R * 0.9} ${GIANT_R * 0.18} ${GIANT_R * 1.8} 0 M${g.x - GIANT_R * 0.8} ${g.y + GIANT_R * 0.3} q${GIANT_R * 0.8} ${GIANT_R * 0.15} ${GIANT_R * 1.6} 0`}
          />
          <path
            className="hart-giant-ring"
            d={`M${g.x - GIANT_R * 2.1} ${g.y} a${GIANT_R * 2.1} ${GIANT_R * 0.42} 0 0 0 ${GIANT_R * 4.2} 0`}
          />
        </g>
      ) : null}
      <circle cx={cx} cy={cy} r={r + HAZE} fill="url(#hart-haze)" />
      <circle cx={cx} cy={cy} r={r} fill="url(#hart-ground)" />
      <circle className="hart-rim-glow" cx={cx} cy={cy} r={r} />
      <circle className="hart-rim" cx={cx} cy={cy} r={r} />
      {chosen.map(([kind, size], i) => {
        const dx = (i - (chosen.length - 1) / 2) * PLANT_STEP;
        const deg = -90 + (dx / r) * (180 / Math.PI);
        const t = (deg * Math.PI) / 180;
        const x = cx + (r - 1) * Math.cos(t);
        const y = cy + (r - 1) * Math.sin(t);
        return (
          <g key={i} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(deg + 90).toFixed(2)}) scale(${size})`}>
            {i === ringed ? (
              <g className="hart-rings">
                <ellipse cx="0" cy="0" rx="30" ry="6" />
                <ellipse cx="0" cy="0" rx="50" ry="10" />
              </g>
            ) : null}
            <PlantShape kind={kind} />
          </g>
        );
      })}
    </>
  );
}

export const HeaderArt = memo(function HeaderArt() {
  const ref = useRef<SVGSVGElement | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  useLayoutEffect(() => {
    const art = ref.current;
    const host = art?.parentElement;
    if (!art || !host) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next = measure(host, art);
        setLayout((prev) =>
          prev &&
          prev.w === next.w &&
          prev.h === next.h &&
          prev.peakX === next.peakX &&
          prev.plants === next.plants &&
          prev.giant?.x === next.giant?.x &&
          prev.giant?.y === next.giant?.y &&
          JSON.stringify(prev.taken) === JSON.stringify(next.taken)
            ? prev
            : next,
        );
      });
    };
    update();
    // The header's size, and each of its blocks: a card that grows moves the gap without resizing the header.
    const ro = new ResizeObserver(update);
    ro.observe(host);
    for (const child of host.children) if (child !== art) ro.observe(child);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  return (
    <svg
      ref={ref}
      className="header-art"
      viewBox={layout ? `0 0 ${layout.w} ${layout.h}` : "0 0 1 1"}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {layout ? <Scene l={layout} /> : null}
    </svg>
  );
});
