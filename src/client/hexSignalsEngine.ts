/**
 * The life in the hex grid behind the app (HexSignals.tsx). Runs in a worker on an OffscreenCanvas
 * when the browser can, so the page's main thread never paints it; on the main thread otherwise.
 *
 * Two layers (owner, 2026-09-30: the first version's bright travelling lights were "a bit
 * distracting"; he wanted "a dull shimmer … that just adds some liveliness"):
 * - the **glimmer**, the main effect: now and then a hexagon's outline brightens very faintly and
 *   fades out again over a few seconds, scattered at random — the grid breathing, not moving;
 * - a few **signals**: dim, slow, short trails running along the edges, no bright head.
 * On a phone only the glimmer runs, at a lower frame rate.
 *
 * Lined up with the CSS tile in shell.css: a true honeycomb of pointy-top hexagons, side 16 px, tile
 * 27.7128 × 48 px at `background-position: center top`. Change both together.
 */

const SIDE = 16;
const HALF_W = (SIDE * Math.sqrt(3)) / 2;
const TILE_W = 2 * HALF_W;
const ROW_H = 24;

/** How strong the whole effect is; the owner picks between the two (`?backdrop=soft|faint`). */
export type BackdropLevel = "soft" | "faint";
// 2026-09-30: the first cut (0.2 / 0.3) was too faint to notice behind the panels; the original
// signals peaked at 0.8 with glowing heads, which was too much.
const LEVEL = {
  soft: { glimmer: 0.34, signal: 0.45 },
  faint: { glimmer: 0.2, signal: 0.28 },
} as const;

export interface BackdropOptions {
  level: BackdropLevel;
  /** Travelling signals as well as the glimmer (off on phones). */
  signals: boolean;
  fps: number;
  /** The app's colour scheme, "r, g, b"; absent = the backdrop's own orange. */
  accentRgb?: string | null;
}

/** px per second along an edge. */
const SPEED = 34;
const TRAIL = 16;
/** One signal per this many square pixels of window, within bounds. */
const AREA_PER_SIGNAL = 450_000;
const MIN_SIGNALS = 2;
const MAX_SIGNALS = 7;
/** Glimmering hexagons at any moment: one per this many square pixels, within bounds. */
const AREA_PER_GLIMMER = 80_000;
const MIN_GLIMMER = 4;
const MAX_GLIMMER = 26;
/** The trail in this many strokes, each fainter towards the tail. */
const BANDS = 3;
const RGB = { accent: "255, 150, 60", info: "79, 208, 255" } as const;
type Hue = keyof typeof RGB;

type Dir = [number, number];
// A vertex at the top of a hexagon ("up" class) has an edge up and two down; every step flips class.
const UP_EDGES: Dir[] = [
  [0, -SIDE],
  [-HALF_W, SIDE / 2],
  [HALF_W, SIDE / 2],
];
const DOWN_EDGES: Dir[] = [
  [0, SIDE],
  [-HALF_W, -SIDE / 2],
  [HALF_W, -SIDE / 2],
];
/** The six corners of a hexagon around its centre. */
const CORNERS: Dir[] = [
  [0, -SIDE],
  [HALF_W, -SIDE / 2],
  [HALF_W, SIDE / 2],
  [0, SIDE],
  [-HALF_W, SIDE / 2],
  [-HALF_W, -SIDE / 2],
];

interface Signal {
  x: number;
  y: number;
  up: boolean;
  dir: Dir;
  /** 0..1 along the current edge */
  t: number;
  trail: { x: number; y: number }[];
  age: number;
  life: number;
  hue: Hue;
}

interface Glimmer {
  cx: number;
  cy: number;
  age: number;
  life: number;
  /** 0.5..1 of the level's strength, so they are not all alike */
  peak: number;
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface HexSignalsHandle {
  resize(w: number, h: number, dpr: number): void;
  /** Follow a colour-scheme change without restarting. */
  setAccent(rgb: string | null): void;
  stop(): void;
}

export function runHexSignals(
  canvas: AnyCanvas,
  size: { w: number; h: number; dpr: number },
  opts: BackdropOptions,
): HexSignalsHandle | null {
  const ctx = canvas.getContext("2d") as Ctx | null;
  if (!ctx) return null;
  const strength = LEVEL[opts.level] ?? LEVEL.soft;
  let accent: string = opts.accentRgb || RGB.accent;
  const frameMs = 1000 / Math.max(5, Math.min(60, opts.fps));

  let w = 0;
  let h = 0;
  let x0 = 0;
  let signals: Signal[] = [];
  let glimmers: Glimmer[] = [];
  let wantGlimmer = 0;
  let raf = 0;
  let last = -1;
  let stopped = false;

  const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

  /** The centre of a random hexagon on screen (row r, column c of the CSS tile). */
  const randomCell = () => {
    const r = Math.floor(Math.random() * (Math.ceil(h / ROW_H) + 1));
    const c = Math.floor(Math.random() * (Math.ceil(w / TILE_W) + 2));
    return { x: x0 + HALF_W + c * TILE_W + (r % 2 ? HALF_W : 0), y: SIDE + r * ROW_H };
  };

  const spawnSignal = (anyAge = false): Signal => {
    const cell = randomCell();
    const life = 6 + Math.random() * 6;
    return {
      x: cell.x,
      y: cell.y - SIDE,
      up: true,
      dir: pick(UP_EDGES),
      t: 0,
      trail: [],
      age: anyAge ? Math.random() * life : 0,
      life,
      hue: Math.random() < 0.15 ? "info" : "accent",
    };
  };

  const spawnGlimmer = (anyAge = false): Glimmer => {
    const cell = randomCell();
    const life = 3 + Math.random() * 2.5;
    return { cx: cell.x, cy: cell.y, age: anyAge ? Math.random() * life : 0, life, peak: 0.5 + Math.random() * 0.5 };
  };

  const resize = (nw: number, nh: number, dpr: number) => {
    const d = Math.min(dpr || 1, 2);
    w = nw;
    h = nh;
    canvas.width = Math.round(w * d);
    canvas.height = Math.round(h * d);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    // Where the CSS tile starts: `center top`, repeated.
    x0 = (((w - TILE_W) / 2) % TILE_W) - TILE_W;
    const area = w * h;
    wantGlimmer = Math.max(MIN_GLIMMER, Math.min(MAX_GLIMMER, Math.round(area / AREA_PER_GLIMMER)));
    glimmers = glimmers.slice(0, wantGlimmer);
    while (glimmers.length < wantGlimmer) glimmers.push(spawnGlimmer(true));
    const wantSignals = opts.signals
      ? Math.max(MIN_SIGNALS, Math.min(MAX_SIGNALS, Math.round(area / AREA_PER_SIGNAL)))
      : 0;
    signals = signals.slice(0, wantSignals);
    while (signals.length < wantSignals) signals.push(spawnSignal(true));
  };

  const stepSignal = (s: Signal, dt: number) => {
    s.age += dt;
    s.t += (SPEED * dt) / SIDE;
    while (s.t >= 1) {
      s.t -= 1;
      s.x += s.dir[0];
      s.y += s.dir[1];
      s.up = !s.up;
      // Any edge but the one it came along.
      const back: Dir = [-s.dir[0], -s.dir[1]];
      s.dir = pick(
        (s.up ? UP_EDGES : DOWN_EDGES).filter(
          (d) => Math.abs(d[0] - back[0]) > 0.01 || Math.abs(d[1] - back[1]) > 0.01,
        ),
      );
    }
    s.trail.push({ x: s.x + s.dir[0] * s.t, y: s.y + s.dir[1] * s.t });
    if (s.trail.length > TRAIL) s.trail.shift();
  };

  const draw = () => {
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // The glimmer: a hexagon outline that swells in and fades out (a sine over its life).
    ctx.lineWidth = 1;
    for (const g of glimmers) {
      const a = Math.sin(Math.PI * Math.min(1, g.age / g.life)) * strength.glimmer * g.peak;
      if (a <= 0.004) continue;
      ctx.strokeStyle = `rgba(${accent}, ${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(g.cx + CORNERS[0]![0], g.cy + CORNERS[0]![1]);
      for (let i = 1; i < 6; i++) ctx.lineTo(g.cx + CORNERS[i]![0], g.cy + CORNERS[i]![1]);
      ctx.closePath();
      ctx.stroke();
    }

    // The signals: dim, with the tail fading out; no glowing head.
    ctx.lineWidth = 1.1;
    for (const s of signals) {
      const n = s.trail.length;
      if (n < 2) continue;
      // Fade in over the first two seconds, out over the last two.
      const fade = Math.min(1, s.age / 2, (s.life - s.age) / 2);
      if (fade <= 0) continue;
      const per = Math.ceil((n - 1) / BANDS);
      for (let band = 0; band < BANDS; band++) {
        const from = band * per;
        const to = Math.min(n - 1, from + per);
        if (to <= from) break;
        ctx.strokeStyle = `rgba(${s.hue === "accent" ? accent : RGB[s.hue]}, ${(((band + 1) / BANDS) * strength.signal * fade).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(s.trail[from]!.x, s.trail[from]!.y);
        for (let i = from + 1; i <= to; i++) ctx.lineTo(s.trail[i]!.x, s.trail[i]!.y);
        ctx.stroke();
      }
    }
  };

  const frame = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    if (last < 0) last = now;
    if (now - last < frameMs) return;
    const dt = Math.min((now - last) / 1000, 0.2);
    last = now;
    for (let i = 0; i < glimmers.length; i++) {
      const g = glimmers[i]!;
      g.age += dt;
      // A short random pause between glimmers keeps them from reading as a pattern.
      if (g.age >= g.life + Math.random() * 1.5) glimmers[i] = spawnGlimmer();
    }
    for (let i = 0; i < signals.length; i++) {
      const s = signals[i]!;
      stepSignal(s, dt);
      if (s.age >= s.life || s.x < -40 || s.x > w + 40 || s.y < -40 || s.y > h + 40) signals[i] = spawnSignal();
    }
    draw();
  };

  resize(size.w, size.h, size.dpr);
  raf = requestAnimationFrame(frame);
  return {
    resize,
    setAccent(rgb) {
      accent = rgb || RGB.accent;
    },
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, w, h);
    },
  };
}
