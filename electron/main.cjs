"use strict";

const { app, BrowserWindow, nativeImage, dialog, ipcMain, screen, globalShortcut } = require("electron");
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
function hudLayoutPath() {
  return path.join(app.getPath("userData"), "hud-layout.json");
}
function loadHudLayout() {
  try {
    const j = JSON.parse(fs.readFileSync(hudLayoutPath(), "utf8"));
    if (j && typeof j === "object") setHudLayout(j, false);
  } catch {
    /* first run, or unreadable: defaults */
  }
}
function setHudLayout(next, persist) {
  const corner = typeof next.corner === "string" && /^(tl|tr|bl|br)$/.test(next.corner) ? next.corner : hudLayout.corner;
  const order = Array.isArray(next.order) ? next.order.filter((k) => typeof k === "string").slice(0, 16) : hudLayout.order;
  hudLayout = { corner, order };
  if (persist) {
    try {
      fs.writeFileSync(hudLayoutPath(), JSON.stringify(hudLayout), "utf8");
    } catch {
      /* ignore */
    }
  }
  relayoutHudStack();
  return hudLayout;
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
  const w = Math.max(0, ...hudOverlayStack.map((s) => s.width || 0)) || 404;
  const atBottom = hudLayout.corner.startsWith("b");
  const atRight = hudLayout.corner.endsWith("r");
  const x = atRight ? Math.floor(wa.x + wa.width - margin - w) : wa.x + margin;
  let y = atBottom ? wa.y + wa.height - margin : wa.y + margin;
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
      slot.win.setBounds({ x, y, width: w, height: h, animate: false });
    } catch {
      /* ignore */
    }
    y = atBottom ? y - HUD_STACK_GAP : y + h + HUD_STACK_GAP;
  }
}

/** Hide or show every HUD window (the global shortcut). Windows keep their state; only visibility changes. */
function toggleHudVisibility(force) {
  hudHidden = typeof force === "boolean" ? force : !hudHidden;
  for (const s of hudOverlayStack) {
    if (!s.win || s.win.isDestroyed()) continue;
    try {
      if (hudHidden) s.win.hide();
      else s.win.showInactive();
    } catch {
      /* ignore */
    }
  }
  return hudHidden;
}

/** The slot identity: the page, not its query string (the merged HUD changes sections via the query). */
function hudSlotKey(pathNorm) {
  return String(pathNorm).split("?")[0];
}

/** @param {number} width @param {number} height @param {Electron.BrowserWindow | null} parentWin */
function createHudOverlayWindow(width, height, iconForChild, parentWin) {
  const win = new BrowserWindow({
    parent: parentWin ?? undefined,
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
 * @param {string} pathNorm
 * @param {number} width
 * @param {number} height
 * @param {"toggle" | "open" | "set"} mode toggle: same page closes; open: already-open page is a
 *   no-op; set: an already-open page is pointed at the new URL (query string changes)
 */
async function requestHudOverlaySlot(pathNorm, width, height, iconForChild, mode) {
  if (!runtime) return { opened: false, paths: hudPathsFiltered(), error: "Server not ready yet." };

  const key = hudSlotKey(pathNorm);
  const existing = hudOverlayStack.findIndex((s) => s.key === key);
  if (existing >= 0) {
    const slot = hudOverlayStack[existing];
    if (mode === "toggle") {
      hudOverlayStack.splice(existing, 1);
      destroyHudWindow(slot.win);
      relayoutHudStack();
      return { opened: false, paths: hudPathsFiltered() };
    }
    if (mode === "set" && slot.pathname !== pathNorm) {
      slot.pathname = pathNorm;
      slot.width = Math.max(slot.width || 0, width);
      try {
        await slot.win.loadURL(`${runtime.getLocalBaseUrl()}${pathNorm}`);
        relayoutHudStack();
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
  hudOverlayStack.push({ win, pathname: pathNorm, key, width });

  win.webContents.once("did-fail-load", (_e, code, desc) => {
    console.error("[edexo-compare] HUD overlay failed to load:", url, code, desc);
  });

  try {
    await win.loadURL(url);
    relayoutHudStack();
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
    try {
      const [w, h] = win.getSize();
      // A pixel or two of jitter from a font metric must not start a resize loop.
      if (Math.abs(h - height) <= 2) return { ok: true };
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
  mainWindow.on("close", () => {
    destroyAllHudOverlays();
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
  if (runtime && typeof runtime.shutdown === "function") {
    void runtime.shutdown();
  }
  killSiblingEdexoProcesses();
});
