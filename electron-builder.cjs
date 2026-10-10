"use strict";

const { existsSync } = require("node:fs");
const path = require("node:path");

/** Dev-only PFX from scripts/create-self-signed-codesign-cert.ps1 — gitignored under /build/. */
const defaultSelfPfxPath = path.resolve(__dirname, "build", "self-signed-codesign.pfx");

const explicitPfx = process.env.BAHUCKEL_CODESIGN_PFX || process.env.CSC_LINK || "";
const pfx = explicitPfx
  ? path.resolve(explicitPfx)
  : existsSync(defaultSelfPfxPath)
    ? defaultSelfPfxPath
    : "";

const pfxPassword =
  process.env.BAHUCKEL_CODESIGN_PASSWORD ||
  process.env.CSC_KEY_PASSWORD ||
  process.env.EDEXO_SELFSIGN_PASSWORD ||
  "";

/** Opt-in so `npm run dist:win` stays fast; use `npm run dist:win:signed` or set EDEXO_WIN_CODESIGN=1. */
const winCodesign = process.env.EDEXO_WIN_CODESIGN === "1";

const usePfx = Boolean(winCodesign && pfx && existsSync(pfx) && pfxPassword.length > 0);
const isSelfSignedDevPfx = usePfx && path.resolve(pfx) === defaultSelfPfxPath;

if (winCodesign && !usePfx) {
  console.warn(
    "[electron-builder] EDEXO_WIN_CODESIGN=1 but Authenticode is not configured: need a .pfx " +
      "(build/self-signed-codesign.pfx or BAHUCKEL_CODESIGN_PFX / CSC_LINK) and " +
      "EDEXO_SELFSIGN_PASSWORD / CSC_KEY_PASSWORD / BAHUCKEL_CODESIGN_PASSWORD.",
  );
}

const copyright = process.env.EDEXO_COPYRIGHT || "Copyright © Bahuckel — ED Exo Compare";

const win = {
  target: [{ target: "portable", arch: ["x64"] }],
  icon: "build/icon.ico",
};

if (usePfx) {
  /** electron-builder 26+: signing fields belong under `win.signtoolOptions`, not on `win` directly. */
  const signtoolOptions = {
    certificateFile: pfx,
    certificatePassword: pfxPassword,
    signingHashAlgorithms: ["sha256"],
    publisherName: process.env.BAHUCKEL_PUBLISHER_NAME || "Bahuckel",
    /** Runs after rcedit edits, right before signtool (afterPack is too early). See scripts/electron-pre-sign-delay.cjs */
    sign: path.resolve(__dirname, "scripts", "electron-pre-sign-delay.cjs"),
  };
  /** Public TSAs often reject or flake on self-signed chains — skip for the default dev PFX only. */
  const skipTs =
    isSelfSignedDevPfx ||
    process.env.EDEXO_SELFSIGN_NO_TIMESTAMP === "1" ||
    process.env.EDEXO_SELFSIGN_WITH_TIMESTAMP === "0";
  if (!skipTs) {
    signtoolOptions.timeStampServer = process.env.BAHUCKEL_TIMESTAMP_URL || "http://timestamp.digicert.com";
  }
  win.signtoolOptions = signtoolOptions;
}

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "com.edexo.compare",
  productName: "EDExoCompare",
  copyright,
  directories: {
    output: "dist/electron-out",
    buildResources: "build",
  },
  /*
    `electron/diag.cjs` (the stall logger + boot CPU profile) goes into the diagnostic build only —
    `npm run dist:win:diag` sets EDEXO_DIAG=1. A public release must never carry it (owner,
    2026-09-25); `tests/electronBuilderConfig.test.ts` holds the default build to that.
  */
  files: [
    "electron/main.cjs",
    "electron/preload.cjs",
    "electron/windowState.cjs",
    "electron/hudWindows.cjs",
    "electron/tray.cjs",
    "electron/childWindows.cjs",
    "electron/foregroundWatch.cjs",
    "electron/windowGuards.cjs",
    "electron/keybinds.cjs",
    "electron/tabWindows.cjs",
    "electron/updater.cjs",
    // The server's own process (2026-10-09): main.cjs starts app.cjs through it.
    "electron/serverChild.cjs",
    "electron/atomicWrite.cjs",
    ...(process.env.EDEXO_DIAG === "1" ? ["electron/diag.cjs"] : []),
    "package.json",
  ],
  extraResources: [
    { from: "build/app.cjs", to: "edexo/app.cjs" },
    { from: "dist/eb-staging/web", to: "web" },
    { from: "dist/eb-staging/data", to: "data" },
    { from: "public/edexo-icon.png", to: "edexo/icon.png" },
    /*
      The window icon, as an .ico rather than only the 1024px source.

      Windows asks a window for 16, 24, 32 and 48 pixel icons for the taskbar button, the alt-tab
      list and the title bar. `nativeImage` from a single 1024px PNG has to scale to each of those,
      and the result at 24px is a smudge that reads as a different -- older -- logo. The .ico built
      by `scripts/make-ico.mjs` carries drawn frames at every one of those sizes, from the same
      artwork, so Windows picks instead of resampling.
    */
    { from: "build/icon.ico", to: "edexo/icon.ico" },
    // The self-update swap (electron/updater.cjs): PowerShell cannot read a script inside the asar.
    { from: "electron/update-apply.ps1", to: "edexo/update-apply.ps1" },
    // sql.js's WebAssembly for the feeder database (in-app dump import); feederDb.ts `wasmPath`.
    { from: "node_modules/sql.js/dist/sql-wasm.wasm", to: "sql-wasm/sql-wasm.wasm" },
  ],
  win,
  /*
    Chromium's own menu and dialog texts in English only (owner, 2026-10-06): the app is English, and
    the other 54 locale packs were 47 MB of the install. Number and date formatting is ICU
    (icudtl.dat), not these packs.
  */
  electronLanguages: ["en-US"],
  /*
    Linux (owner, 2026-09-28; docs/linux-plan-28092026.md Phase B): an AppImage, built in WSL by
    scripts/dist-linux-appimage.mjs. `executableName` lower-case, as Linux expects; main.cjs runs it
    under XWayland so the HUD stack can be placed and kept on top.
  */
  linux: {
    target: [{ target: "AppImage", arch: ["x64"] }],
    category: "Game",
    icon: "public/edexo-icon.png",
    executableName: "edexo-compare",
    artifactName: "EDExoCompare-${version}-x86_64.${ext}",
    synopsis: "Exobiology companion for Elite Dangerous: journal-linked predictions and HUD overlays",
    desktop: { entry: { StartupWMClass: "EDExoCompare" } },
  },
  portable: {
    artifactName: "${productName}.exe",
    unpackDirName: "EDExoPortable",
  },
  npmRebuild: false,
};
