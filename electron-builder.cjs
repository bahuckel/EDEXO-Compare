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

const usePfx = Boolean(
  winCodesign && pfx && existsSync(pfx) && pfxPassword.length > 0,
);
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
    signtoolOptions.timeStampServer =
      process.env.BAHUCKEL_TIMESTAMP_URL || "http://timestamp.digicert.com";
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
  files: ["electron/main.cjs", "electron/preload.cjs", "package.json"],
  extraResources: [
    { from: "build/app.cjs", to: "edexo/app.cjs" },
    { from: "dist/eb-staging/web", to: "web" },
    { from: "dist/eb-staging/data", to: "data" },
    { from: "public/edexo-icon.png", to: "edexo/icon.png" },
  ],
  win,
  portable: {
    artifactName: "${productName}.exe",
    unpackDirName: "EDExoPortable",
  },
  npmRebuild: false,
};
