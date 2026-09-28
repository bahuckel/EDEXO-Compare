/**
 * The Linux AppImage (owner, 2026-09-28; docs/linux-plan-28092026.md Phase B): the Electron launcher,
 * app window, tray and HUD overlays with the server inside, one file.
 *
 * Runs **on Linux** (the AppImage tools are Linux programs) — here, in WSL, from a copy of the tree
 * with its own Linux node_modules. Expects `npm run build && npm run bundle` to have run first
 * (`npm run dist:linux:appimage` does all three).
 *
 *   dist/linux/EDExoCompare-<version>-x86_64.AppImage
 */
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mergeDataOverlays } from "./mergeDataOverlay.mjs";
import { copyDataTree } from "./packagedData.mjs";

if (process.platform !== "linux") {
  console.error(
    "[dist:linux:appimage] build this on Linux (WSL here): the AppImage tools are Linux programs.",
  );
  process.exit(1);
}

const require = createRequire(import.meta.url);
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const staging = join("dist", "eb-staging");
const out = join("dist", "electron-out-linux");

rmSync(staging, { recursive: true, force: true });
mkdirSync(join(staging, "web"), { recursive: true });
mkdirSync(join(staging, "data"), { recursive: true });
cpSync(join("dist", "web"), join(staging, "web"), { recursive: true });
copyDataTree(join(staging, "data"));
mergeDataOverlays(join(staging, "data"));

// The config's extraResources list the Windows icon too; build it, it is pure JS.
const ico = spawnSync(process.execPath, ["scripts/make-ico.mjs"], { stdio: "inherit" });
if (ico.status !== 0) process.exit(ico.status ?? 1);

rmSync(out, { recursive: true, force: true });
const eb = require.resolve("electron-builder/cli.js");
const r = spawnSync(
  process.execPath,
  [
    eb,
    "--linux",
    "AppImage",
    "--x64",
    "--config",
    "electron-builder.cjs",
    `--config.directories.output=${out}`,
  ],
  { stdio: "inherit", env: { ...process.env, NODE_NO_WARNINGS: "1" } },
);
if (r.error) throw r.error;
if (r.status !== 0) process.exit(r.status ?? 1);

const built = join(out, `EDExoCompare-${version}-x86_64.AppImage`);
if (!existsSync(built)) {
  console.error(`[dist:linux:appimage] expected ${built}`);
  process.exit(1);
}
mkdirSync(join("dist", "linux"), { recursive: true });
const dest = join("dist", "linux", `EDExoCompare-${version}-x86_64.AppImage`);
renameSync(built, dest);
console.info(`\n[dist:linux:appimage] ${dest}`);
