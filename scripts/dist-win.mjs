import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mergeDataOverlays } from "./mergeDataOverlay.mjs";

const require = createRequire(import.meta.url);

const staging = join("dist", "eb-staging");

/**
 * Block this thread without burning the CPU while doing it.
 *
 * This used to be a `while (Date.now() < until)` spin. What it waits for is almost always Windows
 * Defender finishing with a file it is scanning, and spinning a core competes with the scanner for
 * exactly the CPU it needs to finish and let go — the wait made itself longer. `Atomics.wait` on a
 * throwaway buffer is a real sleep and stays synchronous, which is what the rest of this script is
 * built on.
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function rimraf(p) {
  if (existsSync(p)) rmSync(p, { recursive: true, maxRetries: 6, retryDelay: 120 });
}

/**
 * Remove a build directory, waiting out whatever is holding it.
 *
 * Windows AV and Explorer lock files here routinely. The budget used to be twelve tries 400 ms
 * apart — about five seconds — and that turned out to be short of what actually happens: after a
 * successful build Defender scans the 370 MB portable exe this script has just written, and a
 * rebuild started while that is still going fails on a `.pak` deep inside `win-unpacked`.
 *
 * That failure is expensive in a way an ordinary build error is not. The wipe runs **first**, so by
 * the time it gives up it has already deleted most of the previous build: the commander is left
 * with no exe at all, having had a working one a minute earlier. Waiting half a minute for a lock
 * that usually clears in five seconds is free; giving up early is not. Measured once in the field:
 * the same directory removed cleanly on the second attempt of a two-second loop, well after this
 * had abandoned it.
 *
 * The delay grows, so a lock that clears immediately still costs almost nothing.
 */
function rimrafRetry(p, attempts = 24, delayMs = 400) {
  for (let i = 0; i < attempts; i++) {
    try {
      if (existsSync(p)) rmSync(p, { recursive: true, maxRetries: 8, retryDelay: 200 });
      return;
    } catch (e) {
      const code = /** @type {NodeJS.ErrnoException} */ (e).code;
      const retriable = code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY";
      if (retriable && i < attempts - 1) {
        // Say something once it is clearly not instant, so a long wait does not look like a hang.
        if (i === 5) console.log(`Waiting for "${p}" to be released (${code})…`);
        sleepSync(Math.min(2000, delayMs + i * 150));
        continue;
      }
      console.error(
        `\nCould not remove "${p}" (${code}) after ${attempts} attempts. This is usually antivirus ` +
          `still scanning the previous build — wait a minute and retry. Otherwise close Explorer ` +
          `windows on dist/, stop any running EDExoCompare *.exe, or add a Defender exclusion for ` +
          `this repo folder.\n`,
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
    (process.env.BAHUCKEL_CODESIGN_PFX || process.env.CSC_LINK || existsSync(defaultSelfPfx)),
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
      CSC_IDENTITY_AUTO_DISCOVERY: wantsSign ? (process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? "false") : "false",
      /** After rcedit, before signtool; electron-builder afterPack runs too early for this race. */
      EDEXO_PRE_SIGN_DELAY_MS: process.env.EDEXO_PRE_SIGN_DELAY_MS ?? (wantsSign ? "5000" : ""),
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
