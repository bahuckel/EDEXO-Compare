"use strict";

/*
  Tab view's windows (owner, 2026-10-06, stage 3: "drag-drop outside and inside to exclude them and
  include them in the main window, how Chrome tabs work"). The app window ("main") and any number of
  detached windows, each a whole app page showing its own tabs (src/client/tabs/tabStore.ts; a detached
  window has no Main tab). Main process side:

  - every window reports its tabs; the registry goes back to all of them, so opening a screen that
    lives in another window brings that window forward instead of opening it twice;
  - a tab dropped outside any window opens a new window there, holding it;
  - a tab dropped on another window's strip moves there: the window it left closes it, and an empty
    detached window closes itself;
  - detached windows are remembered (window-state.json `tabWindows` + their bounds) and come back
    with the app window; closing the app window closes them.
*/

const DETACHED = { w: 1180, h: 780 };

/**
 * @param {{
 *   BrowserWindow: typeof import("electron").BrowserWindow,
 *   ipcMain: import("electron").IpcMain,
 *   baseUrl: () => string | null,
 *   preloadPath: string | undefined,
 *   partition: string,
 *   icon: unknown,
 *   readWindowStates: () => Record<string, unknown>,
 *   readWindowState: (name: string) => ({ x: number, y: number, width: number, height: number, maximized: boolean } | null),
 *   writeWindowStates: (all: Record<string, unknown>) => void,
 *   trackWindowState: (name: string, win: import("electron").BrowserWindow) => void,
 *   enableZoom: (win: import("electron").BrowserWindow) => void,
 *   onExternalLink: (url: string) => void,
 * }} d
 */
function createTabWindows(d) {
  /** key → window; "main" is the app window. */
  const windows = new Map();
  /** key → the tab kinds it shows. */
  const registry = new Map();
  let seq = 0;
  /** The app window is closing (or the app quitting): the list of detached windows is kept as it is. */
  let frozen = false;

  const live = (w) => w && !w.isDestroyed();
  const keyOf = (wc) => {
    for (const [k, w] of windows) if (live(w) && w.webContents === wc) return k;
    return null;
  };
  function broadcast() {
    const reg = Object.fromEntries(registry);
    for (const w of windows.values()) if (live(w)) w.webContents.send("edexo:tab-registry", reg);
  }
  function remember() {
    if (frozen) return;
    try {
      const all = d.readWindowStates();
      all.tabWindows = [...windows.keys()].filter((k) => k !== "main" && live(windows.get(k)));
      d.writeWindowStates(all);
    } catch {
      /* the next start opens the app window alone */
    }
  }

  function attachMain(win) {
    frozen = false;
    windows.set("main", win);
    win.on("close", () => {
      frozen = true;
    });
    win.on("closed", () => {
      windows.delete("main");
      registry.delete("main");
      // The app window is the app: its detached windows go with it (they come back with it).
      for (const [k, w] of windows) if (k !== "main" && live(w)) w.close();
    });
  }

  /** A detached window: `key` names its tabs' storage; `open` is the tab it is made for (a drag-out). */
  function openDetached(key, opts = {}) {
    const base = d.baseUrl();
    if (!base) return null;
    const saved = d.readWindowState(`tab:${key}`);
    const custom = process.platform === "win32";
    const win = new d.BrowserWindow({
      width: saved?.width ?? DETACHED.w,
      height: saved?.height ?? DETACHED.h,
      ...(opts.at
        ? { x: Math.round(opts.at.x - 120), y: Math.round(opts.at.y - 16) }
        : saved
          ? { x: saved.x, y: saved.y }
          : {}),
      minWidth: 640,
      minHeight: 420,
      backgroundColor: "#050507",
      autoHideMenuBar: true,
      title: "ED Exo Compare",
      icon: d.icon,
      ...(custom
        ? {
            titleBarStyle: "hidden",
            titleBarOverlay: { color: "#07060a", symbolColor: "#f0a050", height: 34 },
          }
        : {}),
      webPreferences: {
        spellcheck: false,
        contextIsolation: true,
        nodeIntegration: false,
        partition: d.partition,
        preload: d.preloadPath,
        additionalArguments: custom ? ["--edexo-custom-titlebar"] : [],
      },
    });
    windows.set(key, win);
    if (saved?.maximized && !opts.at) win.maximize();
    d.trackWindowState(`tab:${key}`, win);
    d.enableZoom(win);
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url) && !url.startsWith(`${base}/`)) d.onExternalLink(url);
      return { action: "deny" };
    });
    win.on("closed", () => {
      windows.delete(key);
      registry.delete(key);
      broadcast();
      remember();
    });
    const q = new URLSearchParams({ tabwin: key });
    if (opts.open) q.set("open", opts.open);
    void win.loadURL(`${base}/?${q}`);
    remember();
    return win;
  }

  d.ipcMain.on("edexo:tabs-report", (ev, tabs) => {
    const k = keyOf(ev.sender);
    if (!k || !Array.isArray(tabs)) return;
    registry.set(
      k,
      tabs.filter((t) => typeof t === "string"),
    );
    broadcast();
  });
  d.ipcMain.handle("edexo:tab-registry", () => Object.fromEntries(registry));
  // Bring the window holding a tab forward, the tab in front. False: no other window has it.
  d.ipcMain.handle("edexo:tab-focus", (ev, kind) => {
    const from = keyOf(ev.sender);
    for (const [k, tabs] of registry) {
      if (k === from || !tabs.includes(kind)) continue;
      const w = windows.get(k);
      if (!live(w)) continue;
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
      w.webContents.send("edexo:tab-activate", kind);
      return true;
    }
    return false;
  });
  // A tab dropped outside every window: a new window at the drop point holds it.
  d.ipcMain.handle("edexo:tab-detach", (ev, req) => {
    const from = keyOf(ev.sender);
    if (!from || !req || typeof req.kind !== "string") return false;
    const key = `w${Date.now().toString(36)}${(seq++).toString(36)}`;
    const win = openDetached(key, { open: req.kind, at: { x: Number(req.x) || 0, y: Number(req.y) || 0 } });
    if (!win) return false;
    ev.sender.send("edexo:tab-remove", req.kind);
    return true;
  });
  // A tab dropped on another window's strip: the window it came from lets go of it.
  d.ipcMain.on("edexo:tab-moved", (ev, req) => {
    const from = windows.get(req?.from);
    if (live(from) && from.webContents !== ev.sender) from.webContents.send("edexo:tab-remove", req.kind);
  });
  // A detached window whose last tab left.
  d.ipcMain.on("edexo:tab-window-empty", (ev) => {
    const k = keyOf(ev.sender);
    if (k && k !== "main") windows.get(k)?.close();
  });

  return {
    attachMain,
    /** The app is quitting: keep the list of detached windows for the next start. */
    freeze() {
      frozen = true;
    },
    /** The detached windows there were last time, with the app window. */
    restore() {
      const keys = d.readWindowStates().tabWindows;
      if (!Array.isArray(keys)) return;
      for (const k of keys) if (typeof k === "string" && !windows.has(k)) openDetached(k);
    },
  };
}

module.exports = { createTabWindows };
