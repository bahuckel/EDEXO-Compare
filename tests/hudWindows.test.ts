/**
 * The HUD overlay windows (electron/hudWindows.cjs), driven with a fake Electron.
 *
 * Split out of electron/main.cjs on 2026-09-28. main.cjs required Electron at the top and kept all
 * of this in module state, so none of it could run outside the app; the factory takes Electron's
 * `app`, `BrowserWindow` and `screen` as arguments, and these fakes record what it asks of them.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const hw = require("../electron/hudWindows.cjs") as {
  createHudWindows: (deps: unknown) => Huds;
  hudPathFrom: (o: unknown, fallback?: string) => string;
  hudWidthFrom: (o: unknown) => number;
  hudHeightFrom: (o: unknown) => number;
  hudSlotKey: (p: string) => string;
  MAX_HUD_OVERLAYS: number;
  HUD_MIN_HEIGHT: number;
  HUD_MAX_HEIGHT: number;
};

type Huds = {
  paths: () => string[];
  count: () => number;
  isHidden: () => boolean;
  layout: () => { corner: string; order: string[]; hidden: boolean; shortcut: string };
  setLayout: (o: unknown) => { corner: string; order: string[] };
  request: (
    p: string,
    w: number,
    h: number,
    icon: unknown,
    mode: "open" | "toggle" | "set",
  ) => Promise<{ opened: boolean; paths: string[]; error?: string }>;
  close: (p: string) => { closed: boolean; paths: string[] };
  toggleVisibility: (force?: boolean) => boolean;
  setGameAway: (away: boolean) => void;
  isGameAway: () => boolean;
  setFocusAway: (away: boolean) => void;
  isFocusAway: () => boolean;
  idlePaths: () => string[];
  restore: (icon: unknown) => Promise<void>;
  destroyAll: () => void;
  pushPrefs: (p: unknown) => void;
  resizeFromPage: (win: unknown, o: unknown) => { ok: boolean };
  setLayoutPathResolver: (fn: () => string) => void;
  setMoveMode: (on: boolean) => boolean;
  isMoving: () => boolean;
  dragFromPage: (win: unknown, phase: string) => { ok: boolean };
  loadLayout: () => void;
  relayout: () => void;
};

const WORK = { x: 0, y: 0, width: 1920, height: 1080 };
/** A second monitor to the right of the primary, for free move. */
const SECOND = { x: 1920, y: 0, width: 2560, height: 1440 };
let cursor = { x: 0, y: 0 };
function nearestDisplay(p: { x: number; y: number }) {
  const dist = (b: typeof WORK) =>
    Math.hypot(Math.max(b.x - p.x, 0, p.x - (b.x + b.width - 1)), Math.max(b.y - p.y, 0, p.y - (b.y + b.height - 1)));
  return { bounds: dist(SECOND) < dist(WORK) ? SECOND : WORK };
}

class FakeWindow {
  static all: FakeWindow[] = [];
  bounds: { x: number; y: number; width: number; height: number };
  visible = false;
  destroyed = false;
  url = "";
  sent: [string, unknown][] = [];
  private handlers: Record<string, (() => void)[]> = {};
  webContents = {
    on: () => {},
    once: () => {},
    send: (ch: string, v: unknown) => this.sent.push([ch, v]),
  };
  constructor(opts: { width: number; height: number }) {
    this.bounds = { x: 0, y: 0, width: opts.width, height: opts.height };
    FakeWindow.all.push(this);
  }
  on(ev: string, fn: () => void) {
    (this.handlers[ev] ??= []).push(fn);
  }
  once(ev: string, fn: () => void) {
    this.on(ev, fn);
  }
  async loadURL(url: string) {
    if (url.includes("/missing")) throw new Error("ERR_FAILED (-2)");
    this.url = url;
  }
  isDestroyed() {
    return this.destroyed;
  }
  /** What Electron does when the page has painted (`ready-to-show`), which may come late. */
  paint() {
    for (const fn of this.handlers["ready-to-show"] ?? []) fn();
  }
  destroy() {
    this.destroyed = true;
    for (const fn of this.handlers.closed ?? []) fn();
  }
  close() {
    this.destroy();
  }
  getSize() {
    return [this.bounds.width, this.bounds.height];
  }
  getBounds() {
    return { ...this.bounds };
  }
  /**
   * Windows with monitors at different scaling: Electron's setBounds on the other monitor can land
   * at a size scaled by the ratio of the two (a commander's report, 2026-10-02). 1 = no distortion.
   */
  static secondScreenSizeFactor = 1;
  setBounds(b: Partial<FakeWindow["bounds"]>) {
    this.bounds = { ...this.bounds, ...b };
    if (b.height != null && this.bounds.x >= SECOND.x) {
      this.bounds.height = Math.round(b.height * FakeWindow.secondScreenSizeFactor);
    }
  }
  hide() {
    this.visible = false;
  }
  show() {
    this.visible = true;
  }
  showInactive() {
    this.visible = true;
  }
  setAlwaysOnTop() {}
  moveTop() {}
  ignoresMouse = true;
  setIgnoreMouseEvents(v: boolean) {
    this.ignoresMouse = v;
  }
  setVisibleOnAllWorkspaces() {}
}

let dir: string;
let layoutFile: string;
let runtime: { getLocalBaseUrl: () => string } | null;
let changes: number;

function make(): Huds {
  const huds = hw.createHudWindows({
    electron: {
      app: { getPath: () => dir },
      BrowserWindow: FakeWindow,
      screen: {
        getPrimaryDisplay: () => ({ workArea: WORK }),
        getDisplayNearestPoint: nearestDisplay,
        getCursorScreenPoint: () => ({ ...cursor }),
        on: () => {},
      },
    },
    getRuntime: () => runtime,
    preloadPath: "preload.cjs",
    onChange: () => (changes += 1),
  });
  huds.setLayoutPathResolver(() => layoutFile);
  return huds;
}
const live = () => FakeWindow.all.filter((w) => !w.destroyed);

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "edexo-hudwin-"));
  layoutFile = path.join(dir, "hud-layout.json");
  runtime = { getLocalBaseUrl: () => "http://127.0.0.1:7111" };
  changes = 0;
  FakeWindow.all = [];
  FakeWindow.secondScreenSizeFactor = 1;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("reading an overlay request", () => {
  it("fills the same defaults for the IPC channels and the HTTP bridge", () => {
    expect(hw.hudPathFrom({})).toBe("/distance-overlay.html");
    expect(hw.hudPathFrom({ pathname: "fss-scan-overlay.html" })).toBe("/fss-scan-overlay.html");
    expect(hw.hudPathFrom({}, "/hud-overlay.html")).toBe("/hud-overlay.html");
    expect(hw.hudWidthFrom({ width: "512.7" })).toBe(512);
    expect(hw.hudWidthFrom({ width: -3 })).toBe(404);
    expect(hw.hudHeightFrom(null)).toBe(330);
    expect(hw.hudSlotKey("/hud-overlay.html?s=fss,distance")).toBe("/hud-overlay.html");
  });
});

describe("the stack", () => {
  it("opens windows at the server's URL and stacks them in the top-right corner, one width", async () => {
    const huds = make();
    await huds.request("/fss-scan-overlay.html", 380, 120, null, "open");
    await huds.request("/distance-overlay.html", 404, 330, null, "open");
    expect(huds.paths()).toEqual(["/fss-scan-overlay.html", "/distance-overlay.html"]);
    const [a, b] = live();
    expect(a!.url).toBe("http://127.0.0.1:7111/fss-scan-overlay.html");
    // The widest asked for sets the column; right-aligned 14 px in, 6 px between windows.
    expect(a!.bounds).toMatchObject({ x: 1920 - 14 - 404, y: 14, width: 404 });
    expect(b!.bounds).toMatchObject({ x: 1920 - 14 - 404, y: 14 + 120 + 6, width: 404 });
    expect(changes).toBeGreaterThan(0);
  });

  it("follows the chosen corner and order, and keeps the column on screen", async () => {
    const huds = make();
    await huds.request("/fss-scan-overlay.html", 404, 120, null, "open");
    await huds.request("/distance-overlay.html", 404, 330, null, "open");
    huds.setLayout({ corner: "bl", order: ["/distance-overlay.html"] });
    const [fss, dist] = live();
    // Bottom-anchored: the first in `order` is outermost, so it sits at the very bottom.
    expect(dist!.bounds).toMatchObject({ x: 14, y: 1080 - 14 - 330 });
    expect(fss!.bounds.y).toBe(1080 - 14 - 330 - 6 - 120);
    expect(JSON.parse(readFileSync(layoutFile, "utf8")).corner).toBe("bl");
  });

  it("closes a page on a second toggle, and a `set` navigates the open window instead of adding one", async () => {
    const huds = make();
    await huds.request("/distance-overlay.html", 404, 330, null, "toggle");
    expect(huds.count()).toBe(1);
    await huds.request("/distance-overlay.html", 404, 330, null, "toggle");
    expect(huds.count()).toBe(0);

    await huds.request("/hud-overlay.html?s=fss", 404, 300, null, "set");
    const r = await huds.request("/hud-overlay.html?s=fss,distance", 404, 500, null, "set");
    expect(r.opened).toBe(true);
    expect(live()).toHaveLength(1);
    expect(live()[0]!.url).toBe("http://127.0.0.1:7111/hud-overlay.html?s=fss,distance");
  });

  it("keeps at most the limit, dropping the oldest", async () => {
    const huds = make();
    for (let i = 0; i <= hw.MAX_HUD_OVERLAYS; i += 1)
      await huds.request(`/p${i}.html`, 404, 100, null, "open");
    expect(huds.count()).toBe(hw.MAX_HUD_OVERLAYS);
    expect(huds.paths()[0]).toBe("/p1.html");
  });

  it("answers 'not ready' before the server is up, and drops a page that will not load", async () => {
    runtime = null;
    const huds = make();
    expect(await huds.request("/distance-overlay.html", 404, 330, null, "open")).toMatchObject({
      opened: false,
      error: "Server not ready yet.",
    });
    runtime = { getLocalBaseUrl: () => "http://127.0.0.1:7111" };
    const r = await huds.request("/missing-overlay.html", 404, 330, null, "open");
    expect(r.opened).toBe(false);
    expect(r.error).toMatch(/ERR_FAILED/);
    expect(huds.count()).toBe(0);
  });

  it("closes one page by path, and all of them at shutdown", async () => {
    const huds = make();
    await huds.request("/fss-scan-overlay.html", 404, 120, null, "open");
    await huds.request("/distance-overlay.html", 404, 330, null, "open");
    expect(huds.close("/fss-scan-overlay.html")).toEqual({ closed: true, paths: ["/distance-overlay.html"] });
    expect(huds.close("/nope.html").closed).toBe(false);
    huds.destroyAll();
    expect(live()).toHaveLength(0);
  });
});

describe("hiding and showing (the hotkey)", () => {
  it("hides every window, and showing puts them back", async () => {
    const huds = make();
    await huds.request("/distance-overlay.html", 404, 330, null, "open");
    expect(huds.toggleVisibility()).toBe(true);
    expect(live()[0]!.visible).toBe(false);
    expect(huds.toggleVisibility()).toBe(false);
    expect(live()[0]!.visible).toBe(true);
    huds.toggleVisibility(true); // leave no keep-on-top timer running
  });

  it("reopens the remembered set when there is nothing on screen to show", async () => {
    const huds = make();
    await huds.request("/distance-overlay.html", 404, 330, null, "open");
    huds.destroyAll();
    huds.toggleVisibility(true);
    huds.toggleVisibility(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(huds.paths()).toEqual(["/distance-overlay.html"]);
    huds.toggleVisibility(true);
  });

  it("steps aside while the game is away and comes back with it, without touching the saved choice", async () => {
    const huds = make();
    await huds.request("/distance-overlay.html", 404, 330, null, "open");
    huds.setGameAway(true);
    expect(live()[0]!.visible).toBe(false);
    expect(huds.isHidden()).toBe(false); // the commander's own choice is unchanged
    expect(JSON.parse(readFileSync(layoutFile, "utf8")).hidden).toBe(false);
    huds.setGameAway(false);
    expect(live()[0]!.visible).toBe(true);
    // Hidden by the hotkey stays hidden when the game comes back.
    huds.toggleVisibility(true);
    huds.setGameAway(true);
    huds.setGameAway(false);
    expect(live()[0]!.visible).toBe(false);
    huds.toggleVisibility(true);
  });

  it("steps aside while another window is in front, unless that option is off (owner, 2026-09-30)", async () => {
    const huds = make();
    await huds.request("/distance-overlay.html", 404, 330, null, "open");
    const win = live()[0]!;
    huds.setFocusAway(true);
    expect(win.visible).toBe(false);
    huds.setFocusAway(false);
    expect(win.visible).toBe(true);
    // Off: the game losing focus changes nothing; the option is saved with the layout.
    huds.setLayout({ hideUnfocused: false });
    expect(JSON.parse(readFileSync(layoutFile, "utf8")).hideUnfocused).toBe(false);
    huds.setFocusAway(true);
    expect(win.visible).toBe(true);
    // Turning it back on while away hides at once.
    huds.setLayout({ hideUnfocused: true });
    expect(win.visible).toBe(false);
    // The hotkey shows them anyway, and forgets the away state.
    expect(huds.toggleVisibility()).toBe(false);
    expect(win.visible).toBe(true);
    expect(huds.isFocusAway()).toBe(false);
    huds.toggleVisibility(true);
  });

  it("shows on the hotkey while the game is away (and forgets the away state)", async () => {
    const huds = make();
    await huds.request("/distance-overlay.html", 404, 330, null, "open");
    huds.setGameAway(true);
    expect(huds.toggleVisibility()).toBe(false);
    expect(live()[0]!.visible).toBe(true);
    expect(huds.isGameAway()).toBe(false);
    huds.toggleVisibility(true);
  });

  it("un-hides when the commander asks for a HUD from the picker", async () => {
    const huds = make();
    huds.toggleVisibility(true);
    await huds.request("/distance-overlay.html", 404, 330, null, "toggle");
    expect(huds.isHidden()).toBe(false);
    huds.toggleVisibility(true);
  });
});

describe("free move (owner, 2026-10-02: the HUD anywhere, on any screen)", () => {
  const twoHuds = async (huds: Huds) => {
    await huds.request("/fss-scan-overlay.html", 404, 120, null, "open");
    await huds.request("/distance-overlay.html", 404, 330, null, "open");
    return live();
  };

  it("switched on, the stack stays where it was and the spot is saved", async () => {
    const huds = make();
    const [a] = await twoHuds(huds);
    const before = { ...a!.bounds };
    huds.setLayout({ freeOn: true });
    expect(a!.bounds).toMatchObject({ x: before.x, y: before.y });
    const file = JSON.parse(readFileSync(layoutFile, "utf8"));
    expect(file.freeOn).toBe(true);
    expect(file.free).toMatchObject({ x: before.x, y: before.y, bottom: false });
  });

  it("placing: the windows take the mouse and show the frame, a drag moves the whole stack, Done ends it", async () => {
    const huds = make();
    const [a, b] = await twoHuds(huds);
    huds.setLayout({ freeOn: true });
    huds.toggleVisibility(true);
    expect(huds.setMoveMode(true)).toBe(true);
    // Shown while placing, whatever hid them; click-through off; the page told.
    expect(a!.visible).toBe(true);
    expect(a!.ignoresMouse).toBe(false);
    expect(b!.sent).toContainEqual(["edexo:hud-move-mode", { on: true }]);
    const start = { ...a!.bounds };
    cursor = { x: 1600, y: 40 };
    expect(huds.dragFromPage(b, "start").ok).toBe(true);
    cursor = { x: 900, y: 240 };
    huds.dragFromPage(b, "move");
    expect(a!.bounds).toMatchObject({ x: start.x - 700, y: start.y + 200 });
    expect(b!.bounds).toMatchObject({ x: start.x - 700, y: start.y + 200 + 120 + 6 });
    huds.dragFromPage(b, "end");
    expect(JSON.parse(readFileSync(layoutFile, "utf8")).free).toMatchObject({ x: start.x - 700, y: start.y + 200, bottom: false });
    huds.dragFromPage(b, "done");
    expect(huds.isMoving()).toBe(false);
    expect(a!.ignoresMouse).toBe(true);
    // Hidden again: the commander's choice was hidden before placing.
    expect(a!.visible).toBe(false);
  });

  it("dropped in the lower half of the second screen it hangs from its bottom edge and grows upwards", async () => {
    const huds = make();
    const [a, b] = await twoHuds(huds);
    huds.setLayout({ freeOn: true });
    huds.setMoveMode(true);
    cursor = { x: 0, y: 0 };
    huds.dragFromPage(a, "start");
    const start = { ...a!.bounds };
    cursor = { x: 2400 - start.x, y: 900 - start.y };
    huds.dragFromPage(a, "move");
    huds.dragFromPage(a, "end");
    const free = JSON.parse(readFileSync(layoutFile, "utf8")).free;
    expect(free).toEqual({ x: 2400, y: 900 + 120 + 6 + 330, bottom: true });
    // A taller page keeps the bottom edge where it was dropped.
    huds.resizeFromPage(b, { height: 400 });
    expect(b!.bounds.y + b!.bounds.height).toBe(free.y);
    expect(a!.bounds.x).toBe(2400);
    huds.setMoveMode(false);
  });

  /*
    A commander's report (2026-10-02): moved to another screen, the merged HUD grew taller and taller,
    to the height of the screen; unmerged, the windows piled on top of each other. On that screen
    setBounds landed at a scaled size, and the stack read every window's size back and set it again,
    so each relayout scaled it once more.
  */
  it("on a screen where a set size lands scaled, the merged panel does not keep growing", async () => {
    FakeWindow.secondScreenSizeFactor = 1.25;
    const huds = make();
    await huds.request("/hud-overlay.html", 404, 330, null, "open");
    const [w] = live();
    huds.setLayout({ freeOn: true, free: { x: 2400, y: 100 } });
    const heights: number[] = [];
    for (let i = 0; i < 20; i++) {
      // The page reports its content as it changes (a timer, a distance), and the stack relayouts.
      huds.resizeFromPage(w, { height: 500 + (i % 3) });
      huds.relayout();
      heights.push(w!.bounds.height);
    }
    expect(Math.max(...heights)).toBeLessThanOrEqual(Math.round(502 * 1.25));
    expect(heights.at(-1)).toBeLessThan(SECOND.height);
  });

  it("on that screen, separate windows do not pile on top of each other", async () => {
    FakeWindow.secondScreenSizeFactor = 1.25;
    const huds = make();
    const [a, b] = await twoHuds(huds);
    huds.setLayout({ freeOn: true, free: { x: 2400, y: 100 } });
    for (let i = 0; i < 5; i++) {
      huds.resizeFromPage(a, { height: 120 });
      huds.resizeFromPage(b, { height: 330 });
      huds.relayout();
    }
    expect(b!.bounds.y).toBeGreaterThanOrEqual(a!.bounds.y + a!.bounds.height);
    expect(a!.bounds.height).toBeLessThanOrEqual(Math.round(120 * 1.25));
    expect(b!.bounds.height).toBeLessThanOrEqual(Math.round(330 * 1.25));
  });

  it("a spot off every screen comes back onto the nearest one", async () => {
    const huds = make();
    const [a] = await twoHuds(huds);
    huds.setLayout({ freeOn: true, free: { x: 9000, y: -500 } });
    expect(a!.bounds.x).toBe(SECOND.x + SECOND.width - 404);
    expect(a!.bounds.y).toBe(0);
  });

  it("listens to drags only while placing and only from a HUD window; no placing without free move", async () => {
    const huds = make();
    const [a] = await twoHuds(huds);
    expect(huds.setMoveMode(true)).toBe(false);
    huds.setLayout({ freeOn: true });
    expect(huds.dragFromPage(a, "start").ok).toBe(false);
    huds.setMoveMode(true);
    expect(huds.dragFromPage({}, "start").ok).toBe(false);
    // Free move off ends placing and returns the stack to its corner.
    huds.setLayout({ freeOn: false });
    expect(huds.isMoving()).toBe(false);
    expect(a!.bounds).toMatchObject({ x: 1920 - 14 - 404, y: 14 });
  });

  it("comes back from the layout file at the saved spot", async () => {
    writeFileSync(layoutFile, JSON.stringify({ corner: "tr", order: [], freeOn: true, free: { x: 300, y: 200, bottom: false } }));
    const huds = make();
    huds.loadLayout();
    const [a] = await twoHuds(huds);
    expect(a!.bounds).toMatchObject({ x: 300, y: 200 });
  });
});

describe("the layout file", () => {
  const saved = (extra: Record<string, unknown>) =>
    writeFileSync(
      layoutFile,
      "\uFEFF" +
        JSON.stringify({
          corner: "tl",
          order: [],
          open: [{ pathname: "/fss-scan-overlay.html", width: 380, height: 120 }],
          scale: 1.5,
          ...extra,
        }),
      "utf8",
    );

  it("restores last session's HUDs shown when they were left shown, reading a file with a byte-order mark", async () => {
    saved({ hidden: false });
    const huds = make();
    huds.loadLayout();
    expect(huds.layout().corner).toBe("tl");
    await huds.restore(null);
    live()[0]!.paint();
    expect(huds.paths()).toEqual(["/fss-scan-overlay.html"]);
    expect(huds.isHidden()).toBe(false);
    expect(live()[0]!.visible).toBe(true);
    // Scale 1.5 widens the column: 380 × 1.5.
    expect(live()[0]!.bounds).toMatchObject({ x: 14, width: 570 });
    huds.toggleVisibility(true);
  });

  /*
    The owner's report (2026-09-28): after a restart the HUDs were on screen although he had hidden
    them, and the hotkey "sometimes did not work". The window painted after the restore had hidden
    it, and painting raised it — on screen while the app believed it hidden, so the next press only
    flipped the flag. A window that paints while hidden now stays hidden.
  */
  it("keeps them hidden when they were left hidden, however late a window paints", async () => {
    saved({ hidden: true });
    const huds = make();
    huds.loadLayout();
    await huds.restore(null);
    live()[0]!.paint();
    expect(huds.isHidden()).toBe(true);
    expect(live()[0]!.visible).toBe(false);
    // So the hotkey's first press really shows them.
    expect(huds.toggleVisibility()).toBe(false);
    expect(live()[0]!.visible).toBe(true);
    huds.toggleVisibility(true);
    expect(JSON.parse(readFileSync(layoutFile, "utf8")).hidden).toBe(true);
  });

  /*
    The owner's report (2026-09-30): with the game closed the overlays still came up. The process
    check answers before the restore, so the restore is what has to respect "the game is away".
  */
  it("keeps restored HUDs hidden while the game is away, through paint, page reports and relayout", async () => {
    saved({ hidden: false });
    const huds = make();
    huds.loadLayout();
    huds.setGameAway(true);
    await huds.restore(null);
    const win = live()[0]!;
    win.paint();
    huds.resizeFromPage(win, { height: 200, idle: false });
    huds.resizeFromPage(win, { height: 220 });
    huds.relayout();
    expect(win.visible).toBe(false);
    huds.setGameAway(false);
    expect(win.visible).toBe(true);
    huds.toggleVisibility(true);
  });

  it("does not record 'hidden' over a restore that brought nothing back", async () => {
    saved({ hidden: true, open: [{ pathname: "/missing-overlay.html", width: 404, height: 330 }] });
    const huds = make();
    huds.loadLayout();
    await huds.restore(null);
    expect(huds.count()).toBe(0);
    expect(huds.isHidden()).toBe(false);
  });
});

describe("what the pages report", () => {
  it("clamps a page's height, ignores jitter, and a scale change widens the column", async () => {
    const huds = make();
    await huds.request("/distance-overlay.html", 404, 330, null, "open");
    const win = live()[0]!;
    expect(huds.resizeFromPage(win, { height: 5000 })).toEqual({ ok: true });
    expect(win.bounds.height).toBe(hw.HUD_MAX_HEIGHT);
    huds.resizeFromPage(win, { height: 10 });
    expect(win.bounds.height).toBe(hw.HUD_MIN_HEIGHT);
    huds.resizeFromPage(win, { height: hw.HUD_MIN_HEIGHT + 1 });
    expect(win.bounds.height).toBe(hw.HUD_MIN_HEIGHT); // within 2 px: left alone
    huds.resizeFromPage(win, { height: 200, scale: 1.25 });
    expect(win.bounds.width).toBe(505);
    expect(JSON.parse(readFileSync(layoutFile, "utf8")).scale).toBe(1.25);
    expect(huds.resizeFromPage(null, { height: 200 })).toEqual({ ok: false });
  });

  it("an idle page steps out of the stack and stays out through the hotkey and the game; it returns on its own", async () => {
    const huds = make();
    await huds.request("/fss-scan-overlay.html", 404, 100, null, "open");
    await huds.request("/distance-overlay.html", 404, 200, null, "open");
    const [fssWin, distWin] = live() as [FakeWindow, FakeWindow];
    huds.relayout();
    const topY = fssWin.bounds.y;
    expect(distWin.bounds.y).toBeGreaterThan(topY);

    expect(huds.resizeFromPage(fssWin, { idle: true })).toEqual({ ok: true });
    expect(fssWin.visible).toBe(false);
    expect(distWin.bounds.y).toBe(topY); // the others close up
    expect(huds.idlePaths()).toEqual(["/fss-scan-overlay.html"]);

    huds.toggleVisibility(true);
    huds.toggleVisibility(false);
    expect(fssWin.visible).toBe(false);
    expect(distWin.visible).toBe(true);
    huds.setGameAway(true);
    huds.setGameAway(false);
    expect(fssWin.visible).toBe(false);

    huds.resizeFromPage(fssWin, { idle: false });
    expect(fssWin.visible).toBe(true);
    expect(fssWin.bounds.y).toBe(topY);
    expect(distWin.bounds.y).toBeGreaterThan(topY);
    // While the stack is hidden a page that wakes up stays hidden.
    huds.resizeFromPage(fssWin, { idle: true });
    huds.toggleVisibility(true);
    huds.resizeFromPage(fssWin, { idle: false });
    expect(fssWin.visible).toBe(false);
    huds.toggleVisibility(true);
  });

  it("passes the launcher's HUD settings to every open overlay", async () => {
    const huds = make();
    await huds.request("/fss-scan-overlay.html", 404, 120, null, "open");
    await huds.request("/distance-overlay.html", 404, 330, null, "open");
    huds.pushPrefs({ scale: 1.1 });
    huds.pushPrefs("nonsense");
    for (const w of live()) expect(w.sent).toEqual([["edexo:hud-prefs", { scale: 1.1 }]]);
  });
});

describe("the foreground check (electron/foregroundWatch.cjs)", () => {
  const fg = require("../electron/foregroundWatch.cjs") as { isGameOrOwn: (n: string, own: string[]) => boolean };
  it("the game and this app keep the overlays; anything else does not; unreadable never hides", () => {
    const own = ["edexocompare", "electron"];
    expect(fg.isGameOrOwn("EliteDangerous64", own)).toBe(true);
    expect(fg.isGameOrOwn("EDExoCompare", own)).toBe(true);
    expect(fg.isGameOrOwn("", own)).toBe(true);
    expect(fg.isGameOrOwn("Discord", own)).toBe(false);
    expect(fg.isGameOrOwn("chrome", own)).toBe(false);
  });
});
