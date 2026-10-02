"use strict";

const {
  app,
  BrowserWindow,
  nativeImage,
  dialog,
  ipcMain,
  screen,
  globalShortcut,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { WINDOW_MIN, createWindowState, enableZoom } = require("./windowState.cjs");
const { childWindowKind, galaxyWindowBounds } = require("./childWindows.cjs");
const {
  createHudWindows,
  hudPathFrom,
  hudWidthFrom,
  hudHeightFrom,
} = require("./hudWindows.cjs");
const { createTrayControl } = require("./tray.cjs");
const { createKeybinds } = require("./keybinds.cjs");
const updater = require("./updater.cjs");
const { watchForeground, isGameOrOwn } = require("./foregroundWatch.cjs");
const { guardWindowNavigation, restrictPermissions } = require("./windowGuards.cjs");
/** The app's own origin once the server listens (windowGuards.cjs). */
const ownBase = () => (runtime ? runtime.getLocalBaseUrl() : null);
/** The foreground watcher (foregroundWatch.cjs), started with the HUDs. */
let foreground = null;

/*
  Diagnostics, in the diagnostic build only (`npm run dist:win:diag`; owner, 2026-09-25). A public
  build does not pack `diag.cjs`, so the require fails and this stays null. See `diag.cjs`.
*/
let diag = null;
function startDiagnostics() {
  try {
    const outDir = path.join(
      process.env.EDEXO_USER_DATA_DIR ||
        path.join(process.env.LOCALAPPDATA || app.getPath("appData"), "ED Exo Compare"),
      "diag",
    );
    diag = require("./diag.cjs").start({ outDir });
  } catch (e) {
    if (!e || e.code !== "MODULE_NOT_FOUND") console.warn("[edexo-compare] diagnostics failed to start:", e);
    diag = null;
  }
}

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
let runtime = null;
let footOverlayIpcRegistered = false;

/** The HUD overlay windows: hudWindows.cjs owns the stack, its layout file and its visibility. */
const huds = createHudWindows({
  electron: { app, BrowserWindow, screen },
  getRuntime: () => runtime,
  getDiag: () => diag,
  preloadPath: path.join(__dirname, "preload.cjs"),
  guardWindow: (win) => guardWindowNavigation(win, ownBase, shell),
  onChange: () => {
    trayControl.refresh();
    // The launcher's Shown / Hidden buttons follow the hotkey and the tray as well as their own clicks.
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const l = huds.layout();
        mainWindow.webContents.send("edexo:hud-visibility", {
          hidden: huds.isHidden(),
          count: huds.count(),
          gameAway: l.gameAway,
          focusAway: l.focusAway && l.hideUnfocused,
          moving: l.moving,
        });
      } catch {
        /* the launcher reloading */
      }
    }
  },
});

function showLauncher() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** The tray (tray.cjs): the launcher, the HUD toggle, the UI in the browser, quit. */
/*
  Key binds (owner, 2026-10-02): the HUD toggle and previous / next body tab, set in the launcher
  (electron/keybinds.cjs). The body keys go through the server to every app page.
*/
const keybinds = createKeybinds({
  globalShortcut,
  fs,
  filePath: () => path.join(path.dirname(huds.layoutPath()), "edexo-keybinds.json"),
  handlers: {
    hudToggle: () => huds.toggleVisibility(),
    bodyPrev: () => runtime?.uiCommand?.({ cmd: "bodyTab", dir: -1 }),
    bodyNext: () => runtime?.uiCommand?.({ cmd: "bodyTab", dir: 1 }),
  },
});

const trayControl = createTrayControl({
  showLauncher,
  huds,
  getUiUrl: () => (runtime ? `${runtime.getLocalBaseUrl()}/` : null),
  hudShortcut: () => keybinds.bindFor("hudToggle"),
});

/*
  "App window" (owner, 2026-09-26): the exobiology UI in its own window.

  The launcher's old "This window" navigated the launcher itself to the app, so closing the app
  closed the launcher with it. This is a second window instead: close it and the launcher is still
  there. One at a time — asking again brings the open one forward.
*/
const { readWindowStates, readWindowState, trackWindowState, windowStatePath } = createWindowState(() =>
  path.dirname(huds.layoutPath()),
);

let appUiWindow = null;
const APP_WINDOW_PARTITION = "persist:app-window";

/**
 * The app window's session is new, so its view settings (body sort, last tab, …) start empty. Copy
 * the launcher session's localStorage across once — same site, so the launcher can read it — and
 * reload. Marked done in window-state.json so it never runs again.
 */
async function carryAppStorageOver(win) {
  const all = readWindowStates();
  if (all.appStorageCarried === true) return;
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const dump = await mainWindow.webContents.executeJavaScript(
      "JSON.stringify(Object.assign({}, window.localStorage))",
    );
    const n = await win.webContents.executeJavaScript(
      `(() => { const o = JSON.parse(${JSON.stringify(dump)}); let n = 0;` +
        ` for (const k of Object.keys(o)) { if (localStorage.getItem(k) === null) { localStorage.setItem(k, o[k]); n++; } }` +
        ` return n; })()`,
    );
    const now = readWindowStates();
    now.appStorageCarried = true;
    fs.mkdirSync(path.dirname(windowStatePath()), { recursive: true });
    fs.writeFileSync(windowStatePath(), JSON.stringify(now, null, 2), "utf8");
    if (n > 0 && !win.isDestroyed()) win.webContents.reload();
  } catch (e) {
    console.warn("[edexo-compare] could not carry the app window's settings over:", e);
  }
}

/** The galaxy map's window while it is open (one at a time; see childWindows.cjs). */
let galaxyWindow = null;

function openAppUiWindow(iconForChild) {
  if (!runtime) return { opened: false, error: "Server not ready yet." };
  if (appUiWindow && !appUiWindow.isDestroyed()) {
    if (appUiWindow.isMinimized()) appUiWindow.restore();
    appUiWindow.show();
    appUiWindow.focus();
    return { opened: true, focused: true };
  }
  const base = runtime.getLocalBaseUrl();
  const saved = readWindowState("app");
  const area = screen.getPrimaryDisplay().workArea;
  const width = saved?.width ?? Math.min(1480, Math.round(area.width * 0.9));
  const height = saved?.height ?? Math.min(940, Math.round(area.height * 0.9));
  const preloadPath = path.join(__dirname, "preload.cjs");
  const win = new BrowserWindow({
    width,
    height,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: WINDOW_MIN.app.w,
    minHeight: WINDOW_MIN.app.h,
    backgroundColor: "#050507",
    autoHideMenuBar: true,
    title: "ED Exo Compare",
    icon: iconForChild,
    webPreferences: {
      // No spell-check: Electron can fetch its dictionaries from Google (owner, 2026-09-29).
      spellcheck: false,
      contextIsolation: true,
      nodeIntegration: false,
      partition: APP_WINDOW_PARTITION,
      preload: fs.existsSync(preloadPath) ? preloadPath : undefined,
    },
  });
  appUiWindow = win;
  diag?.watchWindow(win, "app");
  if (saved?.maximized) win.maximize();
  trackWindowState("app", win);
  enableZoom(win);
  /*
    Links out of the app (Spansh, EDSM, the site) go to the commander's browser; the app's own pages
    may still open in a window of their own, as they did when the UI ran in the launcher.
  */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`${base}/`) || url === base) {
      if (childWindowKind(url) !== "galaxy") return { action: "allow" };
      // One map window: a second click brings the open one forward instead of loading another.
      if (galaxyWindow && !galaxyWindow.isDestroyed()) {
        if (galaxyWindow.isMinimized()) galaxyWindow.restore();
        galaxyWindow.show();
        galaxyWindow.focus();
        return { action: "deny" };
      }
      const saved = readWindowState("galaxy");
      const area = screen.getDisplayMatching(win.getBounds()).workArea;
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          ...galaxyWindowBounds(saved, area),
          minWidth: WINDOW_MIN.galaxy.w,
          minHeight: WINDOW_MIN.galaxy.h,
          backgroundColor: "#050507",
          autoHideMenuBar: true,
          title: "Galaxy map — ED Exo Compare",
          icon: iconForChild,
        },
      };
    }
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("did-create-window", (child, { url }) => {
    if (childWindowKind(url) !== "galaxy") return;
    galaxyWindow = child;
    if (readWindowState("galaxy")?.maximized) child.maximize();
    trackWindowState("galaxy", child);
    enableZoom(child);
    child.on("closed", () => {
      if (galaxyWindow === child) galaxyWindow = null;
    });
  });
  win.webContents.once("did-finish-load", () => void carryAppStorageOver(win));
  win.on("closed", () => {
    if (appUiWindow === win) appUiWindow = null;
  });
  void win.loadURL(`${base}/`);
  return { opened: true, focused: false };
}

/*
  Close to tray (owner, 2026-10-01; was "Minimise to tray" from 2026-09-28): an option in the
  launcher, on Windows and Linux, remembered in window-state.json as `closeToTray`. A system with no
  tray (GNOME without the AppIndicator extension) greys it out: hiding the launcher there would leave
  nothing to bring it back with.

  The X hides the launcher in the tray, the way Discord does; minimise is always an ordinary minimise
  to the taskbar. A guild tester minimised the launcher, did not know what "the tray" was, and took
  the app for crashed; the minimise button that made a window vanish was the confusing part. Off
  unless the commander turns it on; the old `minimiseToTray` key meant something else and is ignored.
  Quitting goes through the tray menu (or any app.quit), which sets `appQuitting` first.
*/
let appQuitting = false;
/** Once per run: the first close to the tray says where the app went. */
let closeToTrayExplained = false;
let linuxTrayHost = null;
let hotkeyRegistered = null;

function trayAvailability() {
  if (!trayControl.exists()) return { available: false, reason: "This system has no tray." };
  if (process.platform === "linux" && linuxTrayHost === false) {
    return {
      available: false,
      reason: "Your desktop shows no tray icons (GNOME needs the AppIndicator extension).",
    };
  }
  return { available: true };
}

function closeToTray() {
  return readWindowStates().closeToTray === true;
}

function setCloseToTray(on) {
  try {
    const all = readWindowStates();
    all.closeToTray = on;
    fs.mkdirSync(path.dirname(windowStatePath()), { recursive: true });
    fs.writeFileSync(windowStatePath(), JSON.stringify(all, null, 2), "utf8");
  } catch (e) {
    console.warn("[edexo-compare] could not save the tray setting:", e);
  }
}

function registerFootOverlayIpc(iconForChild) {
  if (footOverlayIpcRegistered) return;
  footOverlayIpcRegistered = true;

  ipcMain.handle("edexo:foot-overlay-state", () => ({
    opened: huds.paths().length > 0,
    paths: huds.paths(),
  }));

  ipcMain.handle("edexo:hud-overlay-state", () => ({ paths: huds.paths() }));

  ipcMain.handle("edexo:open-app-window", () => openAppUiWindow(iconForChild));

  ipcMain.handle("edexo:get-tray-pref", () => ({ enabled: closeToTray(), ...trayAvailability() }));
  ipcMain.handle("edexo:set-tray-pref", (_evt, opts) => {
    setCloseToTray(!!(opts && typeof opts === "object" && opts.enabled));
    return { enabled: closeToTray(), ...trayAvailability() };
  });
  ipcMain.handle("edexo:hotkey-status", () => ({
    shortcut: keybinds.bindFor("hudToggle"),
    registered: hotkeyRegistered,
  }));
  ipcMain.handle("edexo:get-keybinds", () => keybinds.get());
  ipcMain.handle("edexo:pause-keybinds", (_evt, opts) => keybinds.pause(!!(opts && typeof opts === "object" && opts.on)));
  ipcMain.handle("edexo:set-keybinds", (_evt, next) => {
    const r = keybinds.set(next && typeof next === "object" ? next : {});
    hotkeyRegistered = keybinds.statusFor("hudToggle") === "ok";
    trayControl.refresh();
    return r;
  });

  ipcMain.handle("edexo:open-hud-overlay", async (_evt, opts) =>
    huds.request(hudPathFrom(opts), hudWidthFrom(opts), hudHeightFrom(opts), iconForChild, "open"),
  );

  ipcMain.handle("edexo:toggle-hud-overlay", async (_evt, opts) =>
    huds.request(hudPathFrom(opts), hudWidthFrom(opts), hudHeightFrom(opts), iconForChild, "toggle"),
  );

  /*
    The merged HUD. One window, its sections chosen by the query string; changing the sections is
    a `set` (the open window navigates) rather than a close-and-reopen, so it does not blink.
  */
  ipcMain.handle("edexo:set-hud-overlay", async (_evt, opts) =>
    huds.request(
      hudPathFrom(opts, "/hud-overlay.html"),
      hudWidthFrom(opts),
      hudHeightFrom(opts),
      iconForChild,
      "set",
    ),
  );

  ipcMain.handle("edexo:close-hud-overlay", async (_evt, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    if (typeof o.pathname !== "string" || !o.pathname.trim()) {
      return { closed: false, paths: huds.paths() };
    }
    return huds.close(hudPathFrom(o));
  });

  ipcMain.handle("edexo:get-hud-layout", () => huds.layout());
  ipcMain.handle("edexo:set-hud-layout", (_evt, opts) =>
    huds.setLayout(opts && typeof opts === "object" ? opts : {}),
  );
  ipcMain.handle("edexo:toggle-hud-visibility", (_evt, opts) => {
    const o = opts && typeof opts === "object" ? opts : {};
    return { hidden: huds.toggleVisibility(typeof o.hidden === "boolean" ? o.hidden : undefined) };
  });

  /*
    Exomastery downloads (§S): a Save dialog rather than Chromium's download shelf, starting in
    Downloads with the name the server chose. Only the launcher may ask, and only for text.
  */
  ipcMain.handle("edexo:save-text-file", async (evt, opts) => {
    if (!mainWindow || evt.sender !== mainWindow.webContents) return { saved: false, error: "Not allowed." };
    const text = opts && typeof opts.text === "string" ? opts.text : null;
    const rawName = opts && typeof opts.defaultName === "string" ? opts.defaultName : "EDEXO.json";
    const name = path.basename(rawName).replace(/[<>:"|?*]/g, "_") || "EDEXO.json";
    if (text == null) return { saved: false, error: "Nothing to save." };
    const r = await dialog.showSaveDialog(mainWindow, {
      title: "Save",
      defaultPath: path.join(app.getPath("downloads"), name),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (r.canceled || !r.filePath) return { saved: false };
    try {
      fs.writeFileSync(r.filePath, text, "utf8");
      return { saved: true, path: r.filePath };
    } catch (e) {
      return { saved: false, error: e && e.message ? e.message : String(e) };
    }
  });

  /*
    Backups (owner, 2026-09-28): a folder picker for where they go and where journals are restored,
    and a restart that finishes a restore (it is applied at start, before anything reads the data).
    The portable exe runs from a temporary copy; relaunching that copy would start an exe the
    wrapper is about to delete, so the restart goes through the original file when there is one.
  */
  ipcMain.handle("edexo:pick-folder", async (evt, opts) => {
    if (!mainWindow || evt.sender !== mainWindow.webContents) return { path: null };
    const start = opts && typeof opts.defaultPath === "string" && opts.defaultPath ? opts.defaultPath : app.getPath("documents");
    const r = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a folder",
      defaultPath: start,
      properties: ["openDirectory", "createDirectory"],
    });
    return { path: r.canceled || !r.filePaths[0] ? null : r.filePaths[0] };
  });
  /*
    "Restart to update": the server has the newer release downloaded and checked; it goes in on the
    way out (will-quit), and the new copy starts. With a backup running, quitting asks first, and
    "Keep the app open" calls this off like a plain restart.
  */
  ipcMain.handle("edexo:install-update", (evt) => {
    if (!mainWindow || evt.sender !== mainWindow.webContents) return { ok: false };
    const staged = runtime && typeof runtime.stagedUpdate === "function" ? runtime.stagedUpdate() : null;
    if (!selfUpdateFormValue || !staged) return { ok: false, error: "No downloaded update is waiting." };
    installUpdateOnQuit = staged;
    relaunchOnQuit = false;
    app.quit();
    return { ok: true };
  });
  ipcMain.handle("edexo:relaunch", (evt) => {
    if (!mainWindow || evt.sender !== mainWindow.webContents) return { ok: false };
    /*
      Armed here, registered in will-quit (combined plan 1.6c): with a backup running, quitting asks
      first, and "Keep the app open" used to leave the relaunch armed for the next ordinary quit.
    */
    relaunchOnQuit = true;
    app.quit();
    return { ok: true };
  });

  // The launcher's HUD settings, forwarded to every overlay as they change (see preload `pushHudPrefs`).
  ipcMain.on("edexo:push-hud-prefs", (evt, prefs) => {
    if (!mainWindow || evt.sender !== mainWindow.webContents) return;
    huds.pushPrefs(prefs);
  });

  // An overlay reporting how tall it actually is (hudWindows.cjs `resizeFromPage`).
  ipcMain.handle("edexo:resize-hud-overlay", (evt, opts) =>
    huds.resizeFromPage(BrowserWindow.fromWebContents(evt.sender), opts),
  );
  // Free move: the launcher starts and ends placing; a HUD page reports its drag (only HUD windows
  // in placing mode are listened to, see hudWindows.dragFromPage).
  ipcMain.handle("edexo:set-hud-move-mode", (_evt, opts) => ({
    moving: huds.setMoveMode(!!(opts && typeof opts === "object" && opts.on === true)),
  }));
  ipcMain.handle("edexo:hud-drag", (evt, opts) => {
    const phase = opts && typeof opts === "object" ? opts.phase : null;
    if (!["start", "move", "end", "done"].includes(phase)) return { ok: false };
    return huds.dragFromPage(BrowserWindow.fromWebContents(evt.sender), phase);
  });

  ipcMain.handle("edexo:toggle-foot-overlay", async () => {
    try {
      return await huds.request("/distance-overlay.html", 404, 330, iconForChild, "toggle");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { opened: false, paths: huds.paths(), error: msg };
    }
  });
}

async function start() {
  startDiagnostics();
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

  /*
    Self-update (owner, 2026-10-02): only a packaged copy this file knows how to swap — the portable
    exe, the program folder, the AppImage (updater.cjs). The server downloads only when told so here.
    The copy the last update moved aside goes now.
  */
  selfUpdateFormValue = updater.selfUpdateForm({
    isPackaged: app.isPackaged || process.env.EDEXO_ELECTRON_PACKAGED === "1",
  });
  if (selfUpdateFormValue) {
    process.env.EDEXO_SELF_UPDATE = "1";
    updater.removeOldCopy(selfUpdateFormValue);
  }

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

  const {
    startEdexoFromElectronMode,
    setHudBridge,
    resolveHudLayoutPath,
    reapplySpeciesDataDirDiscoveryFromDisk,
    linuxProbes,
  } = require(bundle);
  // GNOME without the AppIndicator extension has no tray: asked once, for "Close to tray".
  if (process.platform === "linux" && linuxProbes && typeof linuxProbes.trayHost === "function") {
    try {
      linuxTrayHost = linuxProbes.trayHost();
    } catch {
      linuxTrayHost = null;
    }
  }
  huds.setLayoutPathResolver(resolveHudLayoutPath);

  /*
    Where the species tree lives, decided by the server's own discovery rather than a copy of it.

    This file used to carry its own version — portable `<exeDir>/data/species`, then
    `species-data-dir.json` in Electron's userData — and `paths.ts` carried the same walk against the
    directory everything else uses. Two implementations of one rule, and only the Electron one looked
    in a directory `EDEXO_USER_DATA_DIR` does not cover, so an isolated instance read the real
    profile's species tree.

    It must run before the server starts, because it works by setting `EDEXO_SPECIES_DATA_DIR`.
  */
  if (typeof reapplySpeciesDataDirDiscoveryFromDisk === "function") {
    reapplySpeciesDataDirDiscoveryFromDisk();
  }
  const mode = detectMode();
  runtime = await startEdexoFromElectronMode(mode);
  diag?.mark("server started");

  const res = process.resourcesPath;
  let winIcon;
  /*
    The .ico first, the PNG as the fallback.

    Reported from the field: the taskbar button kept showing "the old icon" while the folder showed
    the new one. The artwork was never two different files -- `build/icon.ico` and this window icon
    are both built from `public/edexo-icon.png` -- but the two paths reach the screen differently.
    The exe's icon is an .ico, so Windows draws the 32px frame somebody drew at 32px. The window's
    was a 1024px PNG, which Electron downsamples to whatever the taskbar asks for, and a 1024 -> 24
    resample of a ringed logo loses the ring and reads as another mark entirely.

    Same art, sharp at the sizes Windows actually asks for.
  */
  const iconCandidates = [
    res && path.join(res, "edexo", "icon.ico"),
    path.join(__dirname, "..", "build", "icon.ico"),
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

  huds.setChildIcon(winIcon);
  registerFootOverlayIpc(winIcon);

  /*
    Hand the HTTP layer a way into these windows.

    The overlay controls were `ipcMain` channels only, which the app's own UI can invoke and nothing
    else can — so a console build, a phone, or a second terminal had no way to open a HUD. Registered
    here rather than passed into the server, because the server is already listening by the time
    these windows exist. See `src/server/hudBridge.ts`.
  */
  if (typeof setHudBridge === "function") {
    setHudBridge({
      state: () => ({ paths: huds.paths() }),
      open: (o) => huds.request(hudPathFrom(o), hudWidthFrom(o), hudHeightFrom(o), huds.childIcon(), "open"),
      toggle: (o) =>
        huds.request(hudPathFrom(o), hudWidthFrom(o), hudHeightFrom(o), huds.childIcon(), "toggle"),
      set: (o) =>
        huds.request(
          hudPathFrom(o, "/hud-overlay.html"),
          hudWidthFrom(o),
          hudHeightFrom(o),
          huds.childIcon(),
          "set",
        ),
      close: (o) => huds.close(hudPathFrom(o)),
      getLayout: () => huds.layout(),
      setLayout: (o) => huds.setLayout(o || {}),
      toggleVisibility: (o) => ({
        hidden: huds.toggleVisibility(o && typeof o.hidden === "boolean" ? o.hidden : undefined),
      }),
    });
  }

  huds.loadLayout();
  huds.watchDisplays();
  keybinds.load();
  const kbStatus = keybinds.apply();
  hotkeyRegistered = kbStatus.hudToggle === "ok";
  for (const [k, st] of Object.entries(kbStatus)) {
    if (st === "taken") console.warn("[edexo-compare] could not register", keybinds.bindFor(k), `(${k}; taken by another app)`);
  }

  const preloadPath = path.join(__dirname, "preload.cjs");
  const url = `${runtime.getLocalBaseUrl()}/launcher.html`;

  const launcherSaved = readWindowState("launcher");
  // First run (no saved size): as tall as the screen allows, within reason, instead of a fixed 768 px
  // that left most of a 1440p screen empty and put the page behind a scrollbar (tester, 2026-09-30).
  const launcherArea = screen.getPrimaryDisplay().workArea;
  const launcherDefaultH = Math.max(768, Math.min(1000, launcherArea.height - 80));
  // A saved 548 × 768 is the old default nobody chose: treat it as "never resized".
  const launcherUntouched = !launcherSaved || (launcherSaved.width === 548 && launcherSaved.height === 768);
  mainWindow = new BrowserWindow({
    width: launcherSaved?.width ?? 548,
    height: launcherUntouched ? launcherDefaultH : launcherSaved.height,
    ...(launcherSaved
      ? {
          x: launcherSaved.x,
          // Taller than it was saved: keep its bottom on the screen.
          y: launcherUntouched
            ? Math.max(
                launcherArea.y,
                Math.min(launcherSaved.y, launcherArea.y + launcherArea.height - launcherDefaultH),
              )
            : launcherSaved.y,
        }
      : {}),
    backgroundColor: "#050507",
    autoHideMenuBar: true,
    icon: winIcon,
    webPreferences: {
      // No spell-check: Electron can fetch its dictionaries from Google (owner, 2026-09-29).
      spellcheck: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: fs.existsSync(preloadPath) ? preloadPath : undefined,
    },
  });
  diag?.watchWindow(mainWindow, "launcher");
  guardWindowNavigation(mainWindow, ownBase, shell);
  if (launcherSaved?.maximized) mainWindow.maximize();
  trackWindowState("launcher", mainWindow);
  enableZoom(mainWindow);
  mainWindow.loadURL(url);
  trayControl.create(winIcon);
  // Overlays step aside while Elite is not running and come back with it (server gamePresence.ts;
  // guild tester report, 2026-09-30). The hotkey still shows them on demand.
  if (runtime && typeof runtime.onGameRunning === "function") {
    if (runtime.gameRunning() === false) huds.setGameAway(true);
    runtime.onGameRunning((running) => {
      console.log(`[edexo-compare] Elite ${running ? "running" : "not running"}: overlays ${running ? "back" : "hidden"}`);
      huds.setGameAway(!running);
    });
  }
  /*
    ...and while it runs but another program is in front (owner, 2026-09-30). A short wait before
    hiding, so alt-tabbing past something does not flicker them; back at once with the game. This
    app's own windows count as the game's side: the app on a second screen keeps the overlays.
  */
  {
    const own = [path.basename(process.execPath, ".exe").toLowerCase(), "electron"];
    let hideTimer = null;
    foreground = watchForeground((name) => {
      if (isGameOrOwn(name, own)) {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = null;
        huds.setFocusAway(false);
        return;
      }
      if (hideTimer) return;
      hideTimer = setTimeout(() => {
        hideTimer = null;
        huds.setFocusAway(true);
      }, 1500);
    });
  }
  void huds.restore(winIcon);
  mainWindow.on("close", (e) => {
    // With "Close to tray" on (and a tray to come back from), the X hides the launcher in the tray;
    // the server, the HUDs and the app window carry on. Quitting (tray menu) closes it for real.
    if (!appQuitting && closeToTray() && trayAvailability().available) {
      e.preventDefault();
      mainWindow.hide();
      if (!closeToTrayExplained) {
        closeToTrayExplained = true;
        trayControl.notify(
          "ED Exo Compare is still running",
          "It is in the tray (the arrow next to the clock). Click its icon to bring the launcher back, or right-click it to quit.",
        );
      }
      return;
    }
    // A backup being written would be thrown away (owner, 2026-09-29): ask first.
    if (holdExitForBackup(e)) return;
    huds.destroyAll();
    trayControl.destroy();
    // The launcher is still the app: closing it closes the app window too, as it always quit.
    if (appUiWindow && !appUiWindow.isDestroyed()) appUiWindow.close();
  });
  /*
    Windows logoff or shutdown ends the app without before-quit (combined plan 1.6d), so the clean
    shutdown never ran and the on-foot catalog's last second was lost. Flush what is buffered now.
  */
  mainWindow.on("session-end", () => {
    try {
      if (runtime && typeof runtime.flushNow === "function") runtime.flushNow();
    } catch {
      /* the session is ending either way */
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/**
 * Tell Windows who this application is, before any window exists.
 *
 * The taskbar keys a button's identity — its grouping, its pin, and the icon it draws — on the
 * Application User Model ID, not on the exe path. Without this call Electron leaves the default,
 * which for a portable build is derived from the running process, so Windows can hold an icon
 * association from an older run and redraw it over a window whose own icon has since changed. That
 * is the taskbar half of the icon report; the .ico above is the other half.
 *
 * `com.edexo.compare` is the same id `electron-builder.cjs` publishes as `appId`, deliberately: two
 * different ids would make the packaged app and the dev run two different applications to the shell.
 */
/*
  Linux: run under XWayland (docs/linux-plan-28092026.md). Electron 38+ starts as a native Wayland
  client on a Wayland desktop, and Wayland lets no app place its windows or keep them above another —
  the HUD stack would pile up wherever the compositor likes, under the game. Under XWayland both work,
  and so does the global hotkey while Elite (itself an XWayland window under Proton) has focus.
  Only when an X display exists: forced onto X11 without one, Electron would not start at all, and
  the start-up check explains what is missing instead.
*/
if (
  process.platform === "linux" &&
  process.env.DISPLAY &&
  !process.argv.some((a) => a.startsWith("--ozone-platform"))
) {
  app.commandLine.appendSwitch("ozone-platform", "x11");
}

if (process.platform === "win32") {
  try {
    app.setAppUserModelId("com.edexo.compare");
  } catch (e) {
    console.warn("[edexo-compare] could not set the app user model id:", e);
  }
}

/*
  One copy (owner, 2026-10-01). A tester's launcher was hidden in the tray; starting the app again
  ran a second copy that never showed a window. Now a second start hands over to the running copy,
  which brings its launcher back — from the tray, from the taskbar, or from behind other windows —
  and the second copy quits.

  A deliberate second copy still works: `--port` (the documented way to run one beside another) or
  an isolated profile (`EDEXO_USER_DATA_DIR`) skip the lock.
*/
const separateCopy = process.argv.includes("--port") || !!process.env.EDEXO_USER_DATA_DIR;
let gotSingleInstanceLock = true;
if (!separateCopy) {
  gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    // exit, not quit: this copy has nothing to close, and before-quit is the running copy's business.
    app.exit(0);
  } else {
    app.on("second-instance", () => {
      // Still starting (no launcher yet): it shows itself when it is made.
      showLauncher();
    });
  }
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  // Every session the windows use: the launcher's, the app window's, the HUDs' (windowGuards.cjs).
  try {
    const { session } = require("electron");
    for (const ses of [session.defaultSession, session.fromPartition(APP_WINDOW_PARTITION), session.fromPartition("persist:hud")]) {
      restrictPermissions(ses);
    }
  } catch (e) {
    console.warn("[edexo-compare] could not restrict permissions:", e);
  }
  void start().catch((e) => {
    console.error(e);
    try {
      let msg = e instanceof Error ? e.message : String(e);
      if (/EADDRINUSE|already in use/i.test(msg)) {
        /*
          Name the port that is actually taken. It was hard-coded at 7111, which was true for as
          long as --port was being ignored; now that the flag works, a commander who moved the port
          and hit a clash would be sent to look at the wrong one.
        */
        const i = process.argv.indexOf("--port");
        const port = i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "7111";
        msg +=
          `\n\nPort ${port} is in use — often EDExoCompare-*-CLI.exe or another copy of this app. ` +
          `Close that copy, or start this one on a different port with --port <number>.`;
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

/*
  Exit while a backup is being written (owner, 2026-09-29): a red warning, not a silent loss. The
  launcher's close and every other way out (tray Quit, the restart after a restore) pass through here.
  "Wait, then close" lets the backup finish and closes by itself; "Exit now" throws the backup away
  (its half-written file is cleared at the next start).
*/
let exitAllowed = false;
/** "Restart now" asked for a relaunch; done in will-quit, once the quit is really going ahead. */
let relaunchOnQuit = false;
/** "Restart to update" asked for this staged update to go in; installed in will-quit. */
let installUpdateOnQuit = null;
/** This copy's self-update form (updater.cjs), or null where it cannot replace itself. */
let selfUpdateFormValue = null;

function relaunchAsUsual() {
  const portable = process.env.PORTABLE_EXECUTABLE_FILE;
  app.relaunch(portable ? { execPath: portable, args: process.argv.slice(1) } : undefined);
}

app.on("will-quit", () => {
  if (installUpdateOnQuit) {
    const staged = installUpdateOnQuit;
    installUpdateOnQuit = null;
    try {
      // From the update folder, not resources: the portable stub deletes its unpacked copy on exit.
      const scriptPath = path.join(staged.dir, "update-apply.ps1");
      if (process.platform === "win32") {
        fs.copyFileSync(path.join(process.resourcesPath, "edexo", "update-apply.ps1"), scriptPath);
      }
      const r = updater.installOnQuit(staged, {
        form: selfUpdateFormValue,
        scriptPath,
        logPath: path.join(staged.dir, "update.log"),
        // The portable launcher stub waits for this process; its exe is the file being replaced.
        pids: [process.pid, selfUpdateFormValue === "portable" ? process.ppid : 0],
      });
      if (r.how === "relaunch") app.relaunch({ execPath: r.execPath, args: process.argv.slice(1) });
      else if (r.how === "none") relaunchAsUsual();
    } catch (e) {
      console.error("[edexo-compare] update install failed, restarting the installed copy:", e);
      relaunchAsUsual();
    }
    return;
  }
  if (!relaunchOnQuit) return;
  relaunchOnQuit = false;
  relaunchAsUsual();
});
let exitAsking = false;
let exitWhenBackupDone = false;

function holdExitForBackup(e) {
  if (exitAllowed || !runtime || typeof runtime.backupRunning !== "function" || !runtime.backupRunning()) return false;
  e.preventDefault();
  if (exitAsking || exitWhenBackupDone) return true;
  exitAsking = true;
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  if (parent) {
    if (parent.isMinimized()) parent.restore();
    parent.show();
  }
  const opts = {
    type: "error",
    title: "Backup in progress",
    message: "A backup is being written right now.",
    detail:
      "If you exit now, this backup will be lost. Please wait — it usually takes a few seconds, and the app can close by itself when it is done.",
    buttons: ["Wait, then close", "Keep the app open", "Exit now — lose this backup"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
  void (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts)).then(({ response }) => {
    exitAsking = false;
    // "Keep the app open": a "Restart now" that started this quit is called off with it.
    if (response === 1) {
      relaunchOnQuit = false;
      installUpdateOnQuit = null;
    }
    if (response === 2) {
      exitAllowed = true;
      app.quit();
    } else if (response === 0) {
      exitWhenBackupDone = true;
      void runtime.whenBackupDone().then(() => {
        exitAllowed = true;
        app.quit();
      });
    }
  });
  return true;
}

app.on("before-quit", (e) => {
  if (holdExitForBackup(e)) return;
  // From here the launcher's X closes it for real, whatever "Close to tray" says.
  appQuitting = true;
  diag?.stop("quit");
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore */
  }
  huds.destroyAll();
  foreground?.stop();
  trayControl.destroy();
  if (runtime && typeof runtime.shutdown === "function") {
    void runtime.shutdown();
  }
});
