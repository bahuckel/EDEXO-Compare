import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mergeDataOverlays } from "./mergeDataOverlay.mjs";

const require = createRequire(import.meta.url);

const staging = join("dist", "eb-staging");

function sleepSync(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* busy-wait for EBUSY unlock without adding async */
  }
}

function rimraf(p) {
  if (existsSync(p)) rmSync(p, { recursive: true, maxRetries: 6, retryDelay: 120 });
}

/** Windows AV / Explorer often briefly lock `*.nsis.7z` after a failed or interrupted build. */
function rimrafRetry(p, attempts = 12, delayMs = 400) {
  for (let i = 0; i < attempts; i++) {
    try {
      if (existsSync(p)) rmSync(p, { recursive: true, maxRetries: 8, retryDelay: 200 });
      return;
    } catch (e) {
      const code = /** @type {NodeJS.ErrnoException} */ (e).code;
      const retriable = code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY";
      if (retriable && i < attempts - 1) {
        sleepSync(delayMs);
        continue;
      }
      console.error(
        `\nCould not remove "${p}" (${code}). Close Explorer windows on dist/, stop any running EDExoCompare *.exe, and retry. ` +
          `If it persists, add a Defender exclusion for this repo folder.\n`,
      );
      throw e;
    }
  }
}

rimraf(staging);
mkdirSync(join(staging, "web"), { recursive: true });
mkdirSync(join(staging, "data"), { recursive: true });

cpSync(join("dist", "web"), join(staging, "web"), { recursive: true });
cpSync("data", join(staging, "data"), { recursive: true });
mergeDataOverlays(join(staging, "data"));

const readme = `ED Exo Compare — Windows Electron build (single portable + unpacked folder)

Output: dist/electron-out/
- EDExoCompare.exe — portable launcher (journal + HUD). Default: binds 0.0.0.0:7111 (LAN + this PC).
- win-unpacked/ — unpacked tree; species JSON lives under win-unpacked/resources/data/species/<Genus>/
  Large exomastery packs: keep them under data/species/ in the repo, OR put the same tree under ./exomastery-overlay/ (or EDEXO_DATA_OVERLAY=path) so each build merges them into the pack — do not copy only into win-unpacked (rebuilds wipe it).

Localhost-only: run EDExoCompare.exe --local  (binds 127.0.0.1:7111).

Console-only builds: npm run dist:win:cli  → dist/cli-pack/EDExoCompare-*-CLI.exe

If something fails, check edexo-compare-startup-error.log or edexo-compare-crash.log next to the .exe.
`;

const mkIco = spawnSync(process.execPath, ["scripts/make-ico.mjs"], { stdio: "inherit", cwd: process.cwd() });
if (mkIco.status !== 0) process.exit(mkIco.status ?? 1);

let ebCli;
try {
  ebCli = require.resolve("electron-builder/cli.js");
} catch {
  try {
    ebCli = require.resolve("electron-builder/out/cli/cli.js");
  } catch {
    console.error("Install devDependencies: electron electron-builder png-to-ico");
    process.exit(1);
  }
}

function runBuilder(label) {
  console.info(
    `\n[dist:win] ${label}: packaging portable .exe (7-Zip + NSIS; often several minutes with little or no new log lines).\n`,
  );
  const defaultSelfPfx = join(process.cwd(), "build", "self-signed-codesign.pfx");
  const hasPwd = Boolean(
    process.env.BAHUCKEL_CODESIGN_PASSWORD ||
      process.env.CSC_KEY_PASSWORD ||
      process.env.EDEXO_SELFSIGN_PASSWORD,
  );
  const wantsSign = Boolean(
    process.env.EDEXO_WIN_CODESIGN === "1" &&
      hasPwd &&
      (process.env.BAHUCKEL_CODESIGN_PFX ||
        process.env.CSC_LINK ||
        existsSync(defaultSelfPfx)),
  );
  if (wantsSign) {
    const selfMsg = existsSync(defaultSelfPfx) ? " (PFX path includes dev self-signed if present)" : "";
    console.info(
      `[dist:win] Authenticode: signing enabled — electron-builder will sign EDExoCompare.exe${selfMsg}.\n`,
    );
    if (process.env.EDEXO_PRE_SIGN_DELAY_MS === undefined) {
      console.info(
        "[dist:win] Pre-sign delay before signtool avoids AV locking the exe after rcedit (override with EDEXO_PRE_SIGN_DELAY_MS=0).\n",
      );
    }
  }
  const compressionLevel =
    process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL ??
    // 3 = much faster than default -mx=7/-mx=9 on large Electron trees; increase for smaller intermediates
    "3";
  const r = spawnSync(process.execPath, [ebCli, "--win", "portable", "--config", "electron-builder.cjs"], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
      /** Avoid Windows store auto-pick when no PFX is configured (prevents hangs); explicit PFX in electron-builder.cjs still signs. */
      CSC_IDENTITY_AUTO_DISCOVERY: wantsSign ? process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? "false" : "false",
      /** After rcedit, before signtool; electron-builder afterPack runs too early for this race. */
      EDEXO_PRE_SIGN_DELAY_MS:
        process.env.EDEXO_PRE_SIGN_DELAY_MS ?? (wantsSign ? "5000" : ""),
      ELECTRON_BUILDER_COMPRESSION_LEVEL: compressionLevel,
    },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
}

rimrafRetry(join("dist", "electron-out"));
delete process.env.EDEXO_ELECTRON_MODE;

runBuilder("Portable (server+client in one folder)");

const out = join("dist", "electron-out");
if (existsSync(out)) writeFileSync(join(out, "README.txt"), readme, "utf8");

console.info("\nPackaged:");
console.info(" ", out);
