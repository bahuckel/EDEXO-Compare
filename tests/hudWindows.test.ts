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
  restore: (icon: unknown) => Promise<void>;
  destroyAll: () => void;
  pushPrefs: (p: unknown) => void;
  resizeFromPage: (win: unknown, o: unknown) => { ok: boolean };
  setLayoutPathResolver: (fn: () => string) => void;
  loadLayout: () => void;
  relayout: () => void;
};

const WORK = { x: 0, y: 0, width: 1920, height: 1080 };

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
  setBounds(b: Partial<FakeWindow["bounds"]>) {
    this.bounds = { ...this.bounds, ...b };
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
  setIgnoreMouseEvents() {}
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
      screen: { getPrimaryDisplay: () => ({ workArea: WORK }), on: () => {} },
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

  it("un-hides when the commander asks for a HUD from the picker", async () => {
    const huds = make();
    huds.toggleVisibility(true);
    await huds.request("/distance-overlay.html", 404, 330, null, "toggle");
    expect(huds.isHidden()).toBe(false);
    huds.toggleVisibility(true);
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

  it("passes the launcher's HUD settings to every open overlay", async () => {
    const huds = make();
    await huds.request("/fss-scan-overlay.html", 404, 120, null, "open");
    await huds.request("/distance-overlay.html", 404, 330, null, "open");
    huds.pushPrefs({ scale: 1.1 });
    huds.pushPrefs("nonsense");
    for (const w of live()) expect(w.sent).toEqual([["edexo:hud-prefs", { scale: 1.1 }]]);
  });
});
