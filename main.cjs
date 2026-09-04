"use strict";

const { app, BrowserWindow, nativeImage, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

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
    /* ignore */
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
  const base = path.basename(app.getPath("exe")).toLowerCase();
  if (base.includes("server")) return "server";
  return "client";
}

let mainWindow = null;
let runtime = null;

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

  const url = `${runtime.getLocalBaseUrl()}/launcher.html`;
  mainWindow = new BrowserWindow({
    width: 548,
    height: 768,
    backgroundColor: "#050507",
    autoHideMenuBar: true,
    icon: winIcon,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadURL(url);
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
  if (runtime && typeof runtime.shutdown === "function") {
    void runtime.shutdown();
  }
});
