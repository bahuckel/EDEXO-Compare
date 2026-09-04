"use strict";

const { app, BrowserWindow, nativeImage, dialog, ipcMain, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const MAX_HUD_OVERLAYS = 3;
const HUD_STACK_GAP = 8;

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

/** Right edge, stacked top → bottom; first opened sits highest. */
function relayoutHudStack() {
  const d = screen.getPrimaryDisplay();
  const wa = d.workArea;
  const margin = 14;
  let y = wa.y + margin;
  const rightX = wa.x + wa.width - margin;
  hudOverlayStack = hudOverlayStack.filter((s) => s.win && !s.win.isDestroyed());
  for (const slot of hudOverlayStack) {
    let sz;
    try {
      sz = slot.win.getSize();
    } catch {
      continue;
    }
    const w = sz[0];
    const h = sz[1];
    const x = Math.floor(rightX - w);
    try {
      slot.win.setBounds({ x, y, width: w, height: h, animate: false });
    } catch {
      /* ignore */
    }
    y += h + HUD_STACK_GAP;
  }
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
 * @param {"toggle" | "open"} mode toggle: same path closes; open: already-open path is no-op
 */
async function requestHudOverlaySlot(pathNorm, width, height, iconForChild, mode) {
  if (!runtime) return { opened: false, paths: hudPathsFiltered(), error: "Server not ready yet." };

  const existing = hudOverlayStack.findIndex((s) => s.pathname === pathNorm);
  if (existing >= 0) {
    if (mode === "toggle") {
      const victim = hudOverlayStack[existing];
      hudOverlayStack.splice(existing, 1);
      destroyHudWindow(victim.win);
      relayoutHudStack();
      return { opened: false, paths: hudPathsFiltered() };
    }
    return { opened: true, paths: hudPathsFiltered() };
  }

  while (hudOverlayStack.length >= MAX_HUD_OVERLAYS) {
    const drop = hudOverlayStack.shift();
    if (drop) destroyHudWindow(drop.win);
  }

  const url = `${runtime.getLocalBaseUrl()}${pathNorm}`;
  const win = createHudOverlayWindow(width, height, iconForChild, mainWindow);
  hudOverlayStack.push({ win, pathname: pathNorm });

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
      typeof o.pathname === "string" && o.pathname.trim()
        ? o.pathname.trim()
        : "/distance-overlay.html";
    const pathNorm = pathname.startsWith("/") ? pathname : `/${pathname}`;
    const w = Number(o.width);
    const h = Number(o.height);
    const width = Number.isFinite(w) && w > 0 ? Math.floor(w) : 404;
    const height = Number.isFinite(h) && h > 0 ? Math.floor(h) : 274;
    return requestHudOverlaySlot(pathNorm, width, height, iconForChild, "open");
  });

  ipcMain.handle("edexo:toggle-hud-overlay", async (_evt, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    const pathname =
      typeof o.pathname === "string" && o.pathname.trim()
        ? o.pathname.trim()
        : "/distance-overlay.html";
    const pathNorm = pathname.startsWith("/") ? pathname : `/${pathname}`;
    const w = Number(o.width);
    const h = Number(o.height);
    const width = Number.isFinite(w) && w > 0 ? Math.floor(w) : 404;
    const height = Number.isFinite(h) && h > 0 ? Math.floor(h) : 274;
    return requestHudOverlaySlot(pathNorm, width, height, iconForChild, "toggle");
  });

  ipcMain.handle("edexo:toggle-foot-overlay", async () => {
    try {
      return await requestHudOverlaySlot("/distance-overlay.html", 404, 274, iconForChild, "toggle");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { opened: false, paths: hudPathsFiltered(), error: msg };
    }
  });
}

async function start() {
  try {
    const ud = app.getPath("userData");
    fs.mkdirSync(ud, { recursive: true });
    process.env.EDEXO_USER_DATA_DIR = ud;
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
        msg += "\n\nPort 7111 is in use — often EDExoCompare-*-CLI.exe or a second Electron build. Close that copy or set PORT in the environment.";
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
  destroyAllHudOverlays();
  if (runtime && typeof runtime.shutdown === "function") {
    void runtime.shutdown();
  }
  killSiblingEdexoProcesses();
});
