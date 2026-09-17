"use strict";

const { app, BrowserWindow, nativeImage, dialog, ipcMain, screen, globalShortcut, Tray, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const MAX_HUD_OVERLAYS = 8; // was 3; the owner wants every HUD selectable at once
const HUD_STACK_GAP = 6;
/** Ctrl+Alt+H hides and shows every HUD window at once (menus, screenshots), checked free by the owner. */
const HUD_TOGGLE_SHORTCUT = "Control+Alt+H";

/*
  An overlay window is transparent, so any height it has beyond its content reads as empty space
  between it and the next one — the owner's "spacing between them is too large" was mostly windows
  bigger than what they were drawing. They ask to be resized to their own content instead, which
  also fixes the opposite failure: the distance HUD grew a radar and was being cut off by a window
  sized before the radar existed.
*/
const HUD_MIN_HEIGHT = 90;
const HUD_MAX_HEIGHT = 900;

/**
 * Some electron-builder targets report `app.isPackaged === false` even though resources are laid out
 * like a packaged app. Detect layout from disk so we load the right server bundle and env for `paths.ts`.
 */
function applyPackagedResourcesEnv() {
  const res = process.resourcesPath;
  if (!res) return;
  const bundle = path.join(res, "edexo", "app.cjs");
  const indexHtml = path.join(res, "web", "index.html");
  if (fs.existsSync(bundle) && fs.existsSync(indexHtml)) {
    process.env.EDEXO_ELECTRON_PACKAGED = "1";
    process.env.EDEXO_RESOURCES_ROOT = res;
  }
}

/**
 * Species JSON + exomastery live under a writable tree. Packaged builds read bundled resources as
 * project root, so point this at your clone's data/species (or keep data/species next to the .exe).
 */
function applySpeciesDataDirFromElectron() {
  if (process.env.EDEXO_SPECIES_DATA_DIR?.trim()) return;
  try {
    const exeDir = path.dirname(app.getPath("exe"));
    const portable = path.join(exeDir, "data", "species");
    if (fs.existsSync(portable) && fs.statSync(portable).isDirectory()) {
      process.env.EDEXO_SPECIES_DATA_DIR = portable;
      return;
    }
  } catch {
    /* ignore */
  }
  try {
    const ud = app.getPath("userData");
    const cfg = path.join(ud, "species-data-dir.json");
    if (!fs.existsSync(cfg)) return;
    const raw = fs.readFileSync(cfg, "utf8");
    const j = JSON.parse(raw);
    const p = typeof j.speciesDataDir === "string" ? j.speciesDataDir.trim() : "";
    if (!p) return;
    const resolved = path.resolve(p);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      process.env.EDEXO_SPECIES_DATA_DIR = resolved;
    }
  } catch {
    /* ignore invalid JSON or missing file */
  }
}

function serverBundlePath() {
  const res = process.resourcesPath;
  const fromResources = res ? path.join(res, "edexo", "app.cjs") : null;
  if (fromResources && fs.existsSync(fromResources)) {
    return fromResources;
  }
  return path.join(__dirname, "..", "build", "app.cjs");
}

function detectMode() {
  if (process.argv.includes("--local") || process.argv.includes("--client")) return "client";
  const base = path.basename(app.getPath("exe")).toLowerCase();
  if (base.includes("client") && !base.includes("server")) return "client";
  return "server";
}

let mainWindow = null;
/** @type {{ win: Electron.BrowserWindow, pathname: string }[]} */
let hudOverlayStack = [];
let runtime = null;
let footOverlayIpcRegistered = false;

function hudPathsFiltered() {
  return hudOverlayStack.filter((s) => s.win && !s.win.isDestroyed()).map((s) => s.pathname);
}

function destroyHudWindow(win) {
  if (!win || win.isDestroyed()) return;
  try {
    win.destroy();
  } catch {
    try {
      win.close();
    } catch {
      /* ignore */
    }
  }
}

function removeHudSlotForWindow(win) {
  const next = hudOverlayStack.filter((s) => s.win !== win);
  if (next.length === hudOverlayStack.length) return;
  hudOverlayStack = next;
  relayoutHudStack();
}

function destroyAllHudOverlays() {
  for (const s of hudOverlayStack) destroyHudWindow(s.win);
  hudOverlayStack = [];
}

/*
  Where the stack lives and in what order — the owner's choice, remembered across launches in
  userData/hud-layout.json. `corner` is tl / tr / bl / br; `order` lists page keys (query string
  aside), first = outermost (top of a top-anchored stack, bottom of a bottom-anchored one). Pages not
  in the list follow in the order they were opened.
*/
let hudLayout = { corner: "tr", order: [] };
let hudHidden = false;
/** The HUD size multiplier from the launcher's slider; the pages report it, the stack width follows. */
let hudScale = 1;

/**
 * The HUDs that were open when the app last ran, restored on the next launch — hidden, so the
 * hotkey brings back exactly the set the owner left (owner, 2026-09-13). Same file as the layout.
 */
let hudRestoreList = [];
function hudLayoutPath() {
  return path.join(app.getPath("userData"), "hud-layout.json");
}
function loadHudLayout() {
  try {
    const j = JSON.parse(fs.readFileSync(hudLayoutPath(), "utf8"));
    if (j && typeof j === "object") {
      setHudLayout(j, false);
      if (Number.isFinite(Number(j.scale))) hudScale = Math.min(2, Math.max(0.5, Number(j.scale)));
      if (Array.isArray(j.open)) {
        hudRestoreList = j.open
          .filter((o) => o && typeof o === "object" && typeof o.pathname === "string" && o.pathname.startsWith("/"))
          .slice(0, MAX_HUD_OVERLAYS)
          .map((o) => ({
            pathname: o.pathname,
            width: Number.isFinite(Number(o.width)) && Number(o.width) > 0 ? Math.floor(Number(o.width)) : 404,
            height: Number.isFinite(Number(o.height)) && Number(o.height) > 0 ? Math.floor(Number(o.height)) : 330,
          }));
      }
    }
  } catch {
    /* first run, or unreadable: defaults */
  }
}
function persistHudFile() {
  try {
    const open = hudOverlayStack.map((s) => ({ pathname: s.pathname, width: s.width, height: s.height }));
    fs.writeFileSync(
      hudLayoutPath(),
      JSON.stringify({ ...hudLayout, open, hidden: hudHidden, scale: hudScale }),
      "utf8",
    );
  } catch {
    /* ignore */
  }
}
function setHudLayout(next, persist) {
  const corner = typeof next.corner === "string" && /^(tl|tr|bl|br)$/.test(next.corner) ? next.corner : hudLayout.corner;
  const order = Array.isArray(next.order) ? next.order.filter((k) => typeof k === "string").slice(0, 16) : hudLayout.order;
  hudLayout = { corner, order };
  if (persist) persistHudFile();
  relayoutHudStack();
  return hudLayout;
}
/** Reopen last session's HUDs, hidden; the hotkey shows them as they were. */
async function restoreHudOverlays(iconForChild) {
  const list = hudRestoreList;
  hudRestoreList = [];
  if (!list.length) return;
  for (const o of list) {
    try {
      await requestHudOverlaySlot(o.pathname, o.width, o.height, iconForChild, "open");
    } catch {
      /* a page that no longer exists: skip it */
    }
  }
  toggleHudVisibility(true);
}

/**
 * Stack the HUD windows in the chosen corner, in the chosen order.
 *
 * Every HUD in the stack gets the same width — the widest one asked for — so the panels line up
 * as one column instead of four different boxes. The pages fill whatever width they are given.
 */
function relayoutHudStack() {
  const d = screen.getPrimaryDisplay();
  const wa = d.workArea;
  const margin = 14;
  hudOverlayStack = hudOverlayStack.filter((s) => s.win && !s.win.isDestroyed());
  const rank = (s) => {
    const i = hudLayout.order.indexOf(s.key);
    return i < 0 ? 1000 + hudOverlayStack.indexOf(s) : i;
  };
  const ordered = hudOverlayStack.slice().sort((a, b) => rank(a) - rank(b));
  const w = Math.round((Math.max(0, ...hudOverlayStack.map((s) => s.width || 0)) || 404) * hudScale);
  const atBottom = hudLayout.corner.startsWith("b");
  const atRight = hudLayout.corner.endsWith("r");
  const x = atRight ? Math.floor(wa.x + wa.width - margin - w) : wa.x + margin;
  let y = atBottom ? wa.y + wa.height - margin : wa.y + margin;
  /*
    Clamped into the work area, always.

    A stack taller than the screen used to run off the bottom (or off the top, anchored at a bottom
    corner) and the windows down there are simply gone — click-through, frameless, no taskbar entry,
    nothing to drag back. The same arithmetic put every window off the side when the work area
    shrank under it, which is the failure this clamp exists for: see the display listener below.
  */
  const fit = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  for (const slot of ordered) {
    let sz;
    try {
      sz = slot.win.getSize();
    } catch {
      continue;
    }
    const h = sz[1];
    if (atBottom) y -= h;
    try {
      slot.win.setBounds({
        x: fit(x, wa.x, Math.max(wa.x, wa.x + wa.width - w)),
        y: fit(y, wa.y, Math.max(wa.y, wa.y + wa.height - h)),
        width: w,
        height: h,
        animate: false,
      });
    } catch {
      /* ignore */
    }
    y = atBottom ? y - HUD_STACK_GAP : y + h + HUD_STACK_GAP;
  }
}

/**
 * Put the stack back on the screen when the screen changes underneath it.
 *
 * The HUDs are positioned from `screen.getPrimaryDisplay().workArea` and were only ever repositioned
 * when something in the app happened to call {@link relayoutHudStack}. Nothing listened to the
 * display itself — so when the work area changed, the windows stayed at coordinates computed for a
 * screen that no longer existed, which on a shrink means **off the edge and unreachable**.
 *
 * Elite does this routinely: it changes resolution going fullscreen, changes it back on exit, and a
 * monitor waking or sleeping does the same. That is the "now and again" in the owner's report — the
 * overlay disappears, the hotkey cannot bring it back because hiding and showing does not move
 * anything, and the only way out is to make a *new* window, which is what unticking "merge into one
 * panel" and re-ticking it does.
 *
 * Coalesced, because Windows emits several of these for one resolution change.
 */
let relayoutTimer = null;
function scheduleHudRelayout() {
  if (relayoutTimer) clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(() => {
    relayoutTimer = null;
    relayoutHudStack();
  }, 250);
}

function watchDisplaysForHudRelayout() {
  for (const ev of ["display-metrics-changed", "display-added", "display-removed"]) {
    try {
      screen.on(ev, scheduleHudRelayout);
    } catch {
      /* a platform without it: the stack simply keeps its position */
    }
  }
}

/*
  The tray (owner, 2026-09-13): minimising the launcher hides it to the tray; the tray menu shows
  it again, toggles the HUDs, opens the UI in the browser, quits. One instance, rebuilt when the
  HUD visibility changes so the label reads right.
*/
let tray = null;
function showLauncher() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: "Show launcher", click: showLauncher },
    {
      label: hudHidden ? "Show HUDs" : "Hide HUDs",
      accelerator: HUD_TOGGLE_SHORTCUT,
      enabled: hudOverlayStack.length > 0,
      click: () => toggleHudVisibility(),
    },
    {
      label: "Open exobiology UI",
      click: () => {
        if (runtime) void shell.openExternal(`${runtime.getLocalBaseUrl()}/`);
      },
    },
    { type: "separator" },
    { label: "Quit ED Exo Compare", click: () => app.quit() },
  ]);
}
function refreshTrayMenu() {
  if (!tray) return;
  try {
    tray.setContextMenu(buildTrayMenu());
  } catch {
    /* ignore */
  }
}
function createTray(iconImage) {
  if (tray) return;
  try {
    let img = iconImage && !iconImage.isEmpty() ? iconImage : nativeImage.createEmpty();
    if (!img.isEmpty() && process.platform === "win32") img = img.resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.setToolTip("ED Exo Compare");
    tray.setContextMenu(buildTrayMenu());
    tray.on("click", showLauncher);
    tray.on("double-click", showLauncher);
  } catch (e) {
    console.warn("[edexo-compare] tray unavailable:", e);
    tray = null;
  }
}
function destroyTray() {
  if (!tray) return;
  try {
    tray.destroy();
  } catch {
    /* ignore */
  }
  tray = null;
}

/** Hide or show every HUD window (the global shortcut). Windows keep their state; only visibility changes. */
function toggleHudVisibility(force) {
  hudHidden = typeof force === "boolean" ? force : !hudHidden;
  persistHudFile();
  refreshTrayMenu();
  for (const s of hudOverlayStack) {
    if (!s.win || s.win.isDestroyed()) continue;
    try {
      if (hudHidden) s.win.hide();
      else s.win.showInactive();
    } catch {
      /* ignore */
    }
  }
  /*
    Showing is also a rescue, so it repositions.

    The hotkey is what a commander reaches for when a HUD is not where it should be, and hiding and
    showing a window parked off the edge of a changed work area brings back exactly nothing — which
    is what the owner reported. One relayout here means the reflex works.
  */
  if (!hudHidden) relayoutHudStack();
  return hudHidden;
}

/** The slot identity: the page, not its query string (the merged HUD changes sections via the query). */
function hudSlotKey(pathNorm) {
  return String(pathNorm).split("?")[0];
}

/** @param {number} width @param {number} height @param {Electron.BrowserWindow | null} parentWin */
function createHudOverlayWindow(width, height, iconForChild, parentWin) {
  // No `parent`: a child window is minimised together with its parent on Windows, which took every
  // HUD off the screen whenever the launcher was minimised (owner, 2026-09-12). The HUDs are
  // always-on-top, click-through windows of their own; the launcher closing still closes them
  // through the app's own shutdown path.
  void parentWin;
  const win = new BrowserWindow({
    width,
    height,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    focusable: false,
    thickFrame: false,
    icon: iconForChild ?? undefined,
    titleBarStyle: "hidden",
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // The same bridge the launcher gets. Without it `window.edexoElectron` is undefined in the
      // overlay pages, `resizeHudOverlay` silently no-ops, and every HUD stays at the size it was
      // opened with — which is why the tracker's radar was cut off at the bottom.
      preload: path.join(__dirname, "preload.cjs"),
      // `sandbox: false` is the only explicit opt-out in the app. The overlays are frameless,
      // transparent, always-on-top windows whose rendering cannot be verified from a test or a
      // headless run, and changing the packaged app on an untested assumption is how §31 happened.
      // Flip it, launch the app, and open the overlays before committing.
      sandbox: false,
    },
  });

  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    try {
      win.setVisibleOnAllWorkspaces(true);
    } catch {
      /* ignore */
    }
  }

  win.once("ready-to-show", () => {
    relayoutHudStack();
    try {
      win.showInactive();
    } catch {
      win.show();
    }
    try {
      win.setAlwaysOnTop(true, "screen-saver");
    } catch {
      win.setAlwaysOnTop(true, "floating");
    }
    try {
      win.moveTop();
    } catch {
      /* ignore */
    }
  });

  win.on("closed", () => {
    removeHudSlotForWindow(win);
  });

  win.webContents.on("did-finish-load", () => {
    if (!win || win.isDestroyed()) return;
    try {
      win.setIgnoreMouseEvents(true);
    } catch {
      /* ignore */
    }
  });

  return win;
}

/**
 * Load a HUD overlay's page, retrying a couple of times before giving up.
 *
 * The owner hit `ERR_FAILED (-2) loading 'http://127.0.0.1:7111/fss-scan-overlay.html'` on a server
 * that serves that page perfectly well a second later. `runtime` being set means the HTTP server
 * has been created, not that the listening socket is answering yet, and opening the merged stack
 * fires several `loadURL` calls at once — so the first one through can lose a race it would win on
 * any later attempt.
 *
 * One failed load used to destroy the window and report the raw Chromium string, which put the
 * commander in front of an error for something that had not actually gone wrong. Three attempts
 * over roughly half a second; a page that is genuinely missing still fails, just three times.
 *
 * @param {import("electron").BrowserWindow} win
 * @param {string} url
 */
async function loadHudUrlWithRetry(win, url) {
  const ATTEMPTS = 3;
  const BACKOFF_MS = 200;
  let last;
  for (let i = 0; i < ATTEMPTS; i += 1) {
    if (win.isDestroyed()) throw last ?? new Error("Overlay window closed while loading.");
    try {
      await win.loadURL(url);
      return;
    } catch (e) {
      last = e;
      if (i < ATTEMPTS - 1) {
        console.warn(`[edexo-compare] HUD overlay load attempt ${i + 1} failed, retrying:`, url, String(e));
        await new Promise((r) => setTimeout(r, BACKOFF_MS * (i + 1)));
      }
    }
  }
  throw last ?? new Error("Overlay failed to load.");
}

/**
 * @param {string} pathNorm
 * @param {number} width
 * @param {number} height
 * @param {"toggle" | "open" | "set"} mode toggle: same page closes; open: already-open page is a
 *   no-op; set: an already-open page is pointed at the new URL (query string changes)
 */
async function requestHudOverlaySlot(pathNorm, width, height, iconForChild, mode) {
  if (!runtime) return { opened: false, paths: hudPathsFiltered(), error: "Server not ready yet." };

  /*
    Asking for a HUD is asking to see it.

    `restoreHudOverlays` reopens last session's set and then hides the stack, so the hotkey brings
    back exactly what the commander left. That leaves `hudHidden` true for the rest of the run, and
    nothing in the launcher ever cleared it — the launcher has no visibility control at all. So every
    overlay opened from the picker was hidden the instant it loaded (see the `hudHidden` check further
    down), the picker ticked it as on, and the commander saw nothing. Toggling anything else in the
    picker only opened more invisible windows.

    `open` is exempt because that *is* the restore path, and un-hiding there would defeat the point of
    restoring quietly. A `toggle` or a `set` is somebody clicking.
  */
  if (mode !== "open" && hudHidden) toggleHudVisibility(false);

  const key = hudSlotKey(pathNorm);
  /*
    A dead window must not answer for a live one.

    `closed` prunes the slot when a window is destroyed normally, but a renderer that goes away some
    other way leaves the slot behind — and then `set` finds it, sees the pathname already matches,
    and returns `opened: true` having done nothing at all. The launcher ticks the row, the commander
    sees nothing, and no amount of clicking helps because every click takes the same early return.
  */
  hudOverlayStack = hudOverlayStack.filter((s) => s.win && !s.win.isDestroyed());
  const existing = hudOverlayStack.findIndex((s) => s.key === key);
  if (existing >= 0) {
    const slot = hudOverlayStack[existing];
    if (mode === "toggle") {
      hudOverlayStack.splice(existing, 1);
      destroyHudWindow(slot.win);
      relayoutHudStack();
      persistHudFile();
      refreshTrayMenu();
      return { opened: false, paths: hudPathsFiltered() };
    }
    if (mode === "set" && slot.pathname !== pathNorm) {
      slot.pathname = pathNorm;
      slot.width = Math.max(slot.width || 0, width);
      slot.height = Math.max(slot.height || 0, height);
      try {
        await loadHudUrlWithRetry(slot.win, `${runtime.getLocalBaseUrl()}${pathNorm}`);
        relayoutHudStack();
        persistHudFile();
      } catch (e) {
        return { opened: true, paths: hudPathsFiltered(), error: e instanceof Error ? e.message : String(e) };
      }
    }
    return { opened: true, paths: hudPathsFiltered() };
  }

  while (hudOverlayStack.length >= MAX_HUD_OVERLAYS) {
    const drop = hudOverlayStack.shift();
    if (drop) destroyHudWindow(drop.win);
  }

  const url = `${runtime.getLocalBaseUrl()}${pathNorm}`;
  const win = createHudOverlayWindow(width, height, iconForChild, mainWindow);
  hudOverlayStack.push({ win, pathname: pathNorm, key, width, height });
  refreshTrayMenu();

  win.webContents.on("did-fail-load", (_e, code, desc) => {
    // Logged at every attempt, not just the first: a retry that succeeds leaves one of these behind
    // and it should not read like the failure that was reported to the commander.
    console.error("[edexo-compare] HUD overlay failed to load:", url, code, desc);
  });

  try {
    await loadHudUrlWithRetry(win, url);
    relayoutHudStack();
    if (hudHidden) win.hide();
    persistHudFile();
    return { opened: true, paths: hudPathsFiltered() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const idx = hudOverlayStack.findIndex((s) => s.win === win);
    if (idx >= 0) hudOverlayStack.splice(idx, 1);
    destroyHudWindow(win);
    relayoutHudStack();
    return { opened: false, paths: hudPathsFiltered(), error: msg };
  }
}

/** Windows only: kill other processes with same image name (stray Electron/CLI copies). */
function killSiblingEdexoProcesses() {
  if (process.platform !== "win32") return;
  try {
    const exe = path.basename(process.execPath).replace(/'/g, "''");
    const myPid = process.pid;
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "Name='${exe}'" -ErrorAction SilentlyContinue | Where-Object { $_.ProcessId -ne ${myPid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ],
      { stdio: "ignore", windowsHide: true },
    );
  } catch {
    /* ignore */
  }
}

function registerFootOverlayIpc(iconForChild) {
  if (footOverlayIpcRegistered) return;
  footOverlayIpcRegistered = true;

  ipcMain.handle("edexo:foot-overlay-state", () => ({
    opened: hudPathsFiltered().length > 0,
    paths: hudPathsFiltered(),
  }));

  ipcMain.handle("edexo:hud-overlay-state", () => ({ paths: hudPathsFiltered() }));

  ipcMain.handle("edexo:open-hud-overlay", async (_evt, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    const pathname =
      typeof o.pathname === "string" && o.pathname.trim() ? o.pathname.trim() : "/distance-overlay.html";
    const pathNorm = pathname.startsWith("/") ? pathname : `/${pathname}`;
    const w = Number(o.width);
    const h = Number(o.height);
    const width = Number.isFinite(w) && w > 0 ? Math.floor(w) : 404;
    const height = Number.isFinite(h) && h > 0 ? Math.floor(h) : 330;
    return requestHudOverlaySlot(pathNorm, width, height, iconForChild, "open");
  });

  ipcMain.handle("edexo:toggle-hud-overlay", async (_evt, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    const pathname =
      typeof o.pathname === "string" && o.pathname.trim() ? o.pathname.trim() : "/distance-overlay.html";
    const pathNorm = pathname.startsWith("/") ? pathname : `/${pathname}`;
    const w = Number(o.width);
    const h = Number(o.height);
    const width = Number.isFinite(w) && w > 0 ? Math.floor(w) : 404;
    const height = Number.isFinite(h) && h > 0 ? Math.floor(h) : 330;
    return requestHudOverlaySlot(pathNorm, width, height, iconForChild, "toggle");
  });

  /*
    The merged HUD. One window, its sections chosen by the query string; changing the sections is
    a `set` (the open window navigates) rather than a close-and-reopen, so it does not blink.
  */
  ipcMain.handle("edexo:set-hud-overlay", async (_evt, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    const pathname = typeof o.pathname === "string" && o.pathname.trim() ? o.pathname.trim() : "/hud-overlay.html";
    const pathNorm = pathname.startsWith("/") ? pathname : `/${pathname}`;
    const w = Number(o.width);
    const h = Number(o.height);
    const width = Number.isFinite(w) && w > 0 ? Math.floor(w) : 404;
    const height = Number.isFinite(h) && h > 0 ? Math.floor(h) : 330;
    return requestHudOverlaySlot(pathNorm, width, height, iconForChild, "set");
  });

  ipcMain.handle("edexo:close-hud-overlay", async (_evt, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    const pathname = typeof o.pathname === "string" ? o.pathname.trim() : "";
    if (!pathname) return { closed: false, paths: hudPathsFiltered() };
    const key = hudSlotKey(pathname.startsWith("/") ? pathname : `/${pathname}`);
    const idx = hudOverlayStack.findIndex((s) => s.key === key);
    if (idx < 0) return { closed: false, paths: hudPathsFiltered() };
    const slot = hudOverlayStack[idx];
    hudOverlayStack.splice(idx, 1);
    destroyHudWindow(slot.win);
    relayoutHudStack();
    persistHudFile();
    refreshTrayMenu();
    return { closed: true, paths: hudPathsFiltered() };
  });

  ipcMain.handle("edexo:get-hud-layout", () => ({ ...hudLayout, hidden: hudHidden, shortcut: HUD_TOGGLE_SHORTCUT }));
  ipcMain.handle("edexo:set-hud-layout", (_evt, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    return { ...setHudLayout(o, true), hidden: hudHidden, shortcut: HUD_TOGGLE_SHORTCUT };
  });
  ipcMain.handle("edexo:toggle-hud-visibility", (_evt, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    return { hidden: toggleHudVisibility(typeof o.hidden === "boolean" ? o.hidden : undefined) };
  });

  /**
   * An overlay reporting how tall it actually is.
   *
   * The page is the only thing that knows: its height depends on what the game is doing — a sample
   * in progress draws rows an idle one does not. Width is left alone, because that *is* a layout
   * choice and a HUD that changes width as data arrives would be unreadable.
   */
  ipcMain.handle("edexo:resize-hud-overlay", (evt, opts) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win || win.isDestroyed()) return { ok: false };
    const raw = Number(opts && typeof opts === "object" ? opts.height : NaN);
    if (!Number.isFinite(raw)) return { ok: false };
    const height = Math.max(HUD_MIN_HEIGHT, Math.min(HUD_MAX_HEIGHT, Math.ceil(raw)));
    // The page's scale rides along; a change widens every window in the stack together.
    const sc = Number(opts && typeof opts === "object" ? opts.scale : NaN);
    let scaleChanged = false;
    if (Number.isFinite(sc)) {
      const next = Math.min(2, Math.max(0.5, sc));
      if (Math.abs(next - hudScale) > 0.004) {
        hudScale = next;
        scaleChanged = true;
        persistHudFile();
      }
    }
    try {
      const [w, h] = win.getSize();
      // A pixel or two of jitter from a font metric must not start a resize loop.
      if (!scaleChanged && Math.abs(h - height) <= 2) return { ok: true };
      win.setBounds({ ...win.getBounds(), width: w, height }, false);
      relayoutHudStack();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle("edexo:toggle-foot-overlay", async () => {
    try {
      return await requestHudOverlaySlot("/distance-overlay.html", 404, 330, iconForChild, "toggle");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { opened: false, paths: hudPathsFiltered(), error: msg };
    }
  });
}

async function start() {
  try {
    // Electron's userData is %APPDATA%\edexo-compare on Windows, while the dev server, the CLI and
    // every probe use %LOCALAPPDATA%\ED Exo Compare. Forcing this one made the packaged app keep a
    // second copy of everything — including the miss log the predictor is measured against, and a
    // 7.6 MB journal cache in a roaming profile. So: hand the old directory over to be migrated,
    // and let the server pick the single location the same way every other entry point does.
    const ud = app.getPath("userData");
    fs.mkdirSync(ud, { recursive: true });
    process.env.EDEXO_LEGACY_USER_DATA_DIR = ud;
  } catch (e) {
    console.error("[edexo-compare] Could not create Electron userData dir:", e);
  }

  applyPackagedResourcesEnv();
  applySpeciesDataDirFromElectron();

  const bundle = serverBundlePath();
  if (!fs.existsSync(bundle)) {
    const detail = [
      `Expected server bundle at:\n${bundle}`,
      `resourcesPath=${process.resourcesPath || "(empty)"}`,
      `app.isPackaged=${app.isPackaged}`,
      `__dirname=${__dirname}`,
    ].join("\n");
    try {
      dialog.showErrorBox("ED Exo Compare — missing server bundle", detail);
    } catch {
      /* ignore */
    }
    app.exit(1);
    return;
  }

  process.env.EDEXO_SKIP_DEVENTRY_AUTOSTART = "1";

  const { startEdexoFromElectronMode } = require(bundle);
  const mode = detectMode();
  runtime = await startEdexoFromElectronMode(mode);

  const res = process.resourcesPath;
  let winIcon;
  const iconCandidates = [
    res && path.join(res, "edexo", "icon.png"),
    path.join(__dirname, "..", "public", "edexo-icon.png"),
  ].filter(Boolean);
  for (const p of iconCandidates) {
    try {
      if (fs.existsSync(p)) {
        const img = nativeImage.createFromPath(p);
        if (img && !img.isEmpty()) {
          winIcon = img;
          break;
        }
      }
    } catch {
      /* ignore */
    }
  }

  registerFootOverlayIpc(winIcon);
  loadHudLayout();
  watchDisplaysForHudRelayout();
  try {
    if (!globalShortcut.register(HUD_TOGGLE_SHORTCUT, () => toggleHudVisibility())) {
      console.warn("[edexo-compare] could not register", HUD_TOGGLE_SHORTCUT, "(taken by another app)");
    }
  } catch (e) {
    console.warn("[edexo-compare] global shortcut failed:", e);
  }

  const preloadPath = path.join(__dirname, "preload.cjs");
  const url = `${runtime.getLocalBaseUrl()}/launcher.html`;

  mainWindow = new BrowserWindow({
    width: 548,
    height: 768,
    backgroundColor: "#050507",
    autoHideMenuBar: true,
    icon: winIcon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: fs.existsSync(preloadPath) ? preloadPath : undefined,
    },
  });
  mainWindow.loadURL(url);
  createTray(winIcon);
  void restoreHudOverlays(winIcon);
  mainWindow.on("minimize", (e) => {
    // Minimise means "get out of the way": the window goes to the tray, the HUDs stay where they are.
    e.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on("close", () => {
    destroyAllHudOverlays();
    destroyTray();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  void start().catch((e) => {
    console.error(e);
    try {
      let msg = e instanceof Error ? e.message : String(e);
      if (/EADDRINUSE|already in use/i.test(msg)) {
        msg +=
          "\n\nPort 7111 is in use — often EDExoCompare-*-CLI.exe or a second Electron build. Close that copy or set PORT in the environment.";
      }
      dialog.showErrorBox("ED Exo Compare — startup failed", msg);
    } catch {
      /* ignore */
    }
    app.exit(1);
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore */
  }
  destroyAllHudOverlays();
  destroyTray();
  if (runtime && typeof runtime.shutdown === "function") {
    void runtime.shutdown();
  }
  killSiblingEdexoProcesses();
});
