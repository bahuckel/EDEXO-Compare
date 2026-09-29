/**
 * The signals that travel the hex grid (HexSignals.tsx). Runs in a worker on an OffscreenCanvas when
 * the browser can, so the page's main thread never paints them; on the main thread otherwise.
 *
 * Lined up with the CSS tile in shell.css: a true honeycomb of pointy-top hexagons, side 16 px, tile
 * 27.7128 × 48 px at `background-position: center top`. Change both together.
 */

const SIDE = 16;
const HALF_W = (SIDE * Math.sqrt(3)) / 2;
const TILE_W = 2 * HALF_W;
const ROW_H = 24;

/** px per second along an edge. */
const SPEED = 70;
const TRAIL = 26;
/** One signal per this many square pixels of window, within bounds. */
const AREA_PER_SIGNAL = 140_000;
const MIN_SIGNALS = 5;
const MAX_SIGNALS = 18;
const FRAME_MS = 1000 / 30;
/** The trail in this many strokes, each fainter towards the tail. */
const BANDS = 4;
const GLOW = 4.5;
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

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface HexSignalsHandle {
  resize(w: number, h: number, dpr: number): void;
  stop(): void;
}

export function runHexSignals(
  canvas: AnyCanvas,
  size: { w: number; h: number; dpr: number },
  makeCanvas: (w: number, h: number) => AnyCanvas,
): HexSignalsHandle | null {
  const ctx = canvas.getContext("2d") as Ctx | null;
  if (!ctx) return null;

  let w = 0;
  let h = 0;
  let x0 = 0;
  let signals: Signal[] = [];
  let raf = 0;
  let last = -1;
  let stopped = false;

  const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

  /** A signal at the top vertex of a random hexagon on screen. */
  const spawn = (anyAge = false): Signal => {
    const rows = Math.ceil(h / ROW_H) + 1;
    const cols = Math.ceil(w / TILE_W) + 2;
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    const life = 5 + Math.random() * 7;
    return {
      x: x0 + HALF_W + c * TILE_W + (r % 2 ? HALF_W : 0),
      y: r * ROW_H,
      up: true,
      dir: pick(UP_EDGES),
      t: 0,
      trail: [],
      age: anyAge ? Math.random() * life : 0,
      life,
      hue: Math.random() < 0.15 ? "info" : "accent",
    };
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
    const want = Math.max(MIN_SIGNALS, Math.min(MAX_SIGNALS, Math.round((w * h) / AREA_PER_SIGNAL)));
    signals = signals.slice(0, want);
    while (signals.length < want) signals.push(spawn(true));
  };

  /* The glow of a signal's head, drawn once per colour and stamped each frame. */
  const sprites = {} as Record<Hue, AnyCanvas>;
  for (const k of Object.keys(RGB) as Hue[]) {
    const c = makeCanvas(GLOW * 4, GLOW * 4);
    const g = c.getContext("2d") as Ctx;
    const grad = g.createRadialGradient(GLOW * 2, GLOW * 2, 0, GLOW * 2, GLOW * 2, GLOW * 2);
    grad.addColorStop(0, `rgba(${RGB[k]}, 0.95)`);
    grad.addColorStop(0.35, `rgba(${RGB[k]}, 0.35)`);
    grad.addColorStop(1, `rgba(${RGB[k]}, 0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, GLOW * 4, GLOW * 4);
    sprites[k] = c;
  }

  const step = (s: Signal, dt: number) => {
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
    ctx.lineWidth = 1.3;
    for (const s of signals) {
      const n = s.trail.length;
      if (n < 2) continue;
      // Fade in over the first second, out over the last two.
      const fade = Math.min(1, s.age, (s.life - s.age) / 2);
      if (fade <= 0) continue;
      const per = Math.ceil((n - 1) / BANDS);
      for (let band = 0; band < BANDS; band++) {
        const from = band * per;
        const to = Math.min(n - 1, from + per);
        if (to <= from) break;
        ctx.strokeStyle = `rgba(${RGB[s.hue]}, ${(((band + 1) / BANDS) ** 1.5 * 0.8 * fade).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(s.trail[from]!.x, s.trail[from]!.y);
        for (let i = from + 1; i <= to; i++) ctx.lineTo(s.trail[i]!.x, s.trail[i]!.y);
        ctx.stroke();
      }
      const head = s.trail[n - 1]!;
      ctx.globalAlpha = fade;
      ctx.drawImage(sprites[s.hue], head.x - GLOW * 2, head.y - GLOW * 2);
      ctx.globalAlpha = 1;
    }
  };

  const frame = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    if (last < 0) last = now;
    if (now - last < FRAME_MS) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    for (let i = 0; i < signals.length; i++) {
      const s = signals[i]!;
      step(s, dt);
      if (s.age >= s.life || s.x < -40 || s.x > w + 40 || s.y < -40 || s.y > h + 40) signals[i] = spawn();
    }
    draw();
  };

  resize(size.w, size.h, size.dpr);
  raf = requestAnimationFrame(frame);
  return {
    resize,
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, w, h);
    },
  };
}
