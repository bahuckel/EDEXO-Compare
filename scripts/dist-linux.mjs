/**
 * The Linux tarball (owner, 2026-09-28; docs/linux-plan-28092026.md Phase A): the server and client
 * console builds for linux-x64, the web UI, the data tree, two `.sh` launchers, LICENSE / NOTICE and a
 * README — `dist/linux/EDExoCompare-<version>-linux-x64.tar.gz`, one folder inside.
 *
 * Built from Windows. pkg makes the Linux binaries without running them (`--no-bytecode --public`:
 * a Windows machine cannot run the Linux Node that bytecode compilation needs). The archive is a
 * tarball, not a zip, because the launchers and binaries must arrive executable — a zip made on
 * Windows loses the bit, and a commander would meet "Permission denied" on the first double-click.
 * GNU tar (Git for Windows ships it, a Linux machine has it) sets the modes explicitly.
 *
 *   npm run dist:linux
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runPkg, writeCliLaunchers } from "./cliPack.mjs";
import { mergeDataOverlays } from "./mergeDataOverlay.mjs";
import { copyDataTree } from "./packagedData.mjs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const target = process.env.EDEXO_PKG_TARGET ?? "node22-linux-x64";
const folder = `ED Exo Compare ${version}`;
const outRoot = join("dist", "linux");
const outDir = join(outRoot, folder);
const tarball = join(outRoot, `EDExoCompare-${version}-linux-x64.tar.gz`);
const TAG = "dist:linux";

if (existsSync(outRoot)) rmSync(outRoot, { recursive: true, maxRetries: 10, retryDelay: 200 });
mkdirSync(outDir, { recursive: true });

const { server, client } = writeCliLaunchers();
const cross = process.platform === "linux" ? [] : ["--no-bytecode", "--public"];
runPkg(TAG, "Server (console)", server, join(outDir, "edexo-server"), target, cross);
runPkg(TAG, "Client (console)", client, join(outDir, "edexo-client"), target, cross);

cpSync(join("dist", "web"), join(outDir, "web"), { recursive: true });
copyDataTree(join(outDir, "data"));
mergeDataOverlays(join(outDir, "data"));
cpSync("LICENSE", join(outDir, "LICENSE"));
cpSync("NOTICE.md", join(outDir, "NOTICE.md"));
cpSync("data/LICENSE-DATA.txt", join(outDir, "LICENSE-DATA.txt"));

/*
  The launchers. `readlink -f` so a symlink on the desktop still runs from the real folder, where
  `web/` and `data/` are; `exec` so the terminal's Ctrl+C reaches the server itself.
*/
const sh = (binary, what) => `#!/usr/bin/env bash
# ED Exo Compare — ${what}
# Flags pass through: --local (this PC only), --port <n>, --lan.
set -euo pipefail
here="$(dirname "$(readlink -f "$0")")"
cd "$here"
exec ./${binary} "$@"
`;
writeFileSync(
  join(outDir, "edexo-server.sh"),
  sh("edexo-server", "server on 0.0.0.0:7111: this PC, your LAN and your phone. Open the printed address."),
  { encoding: "utf8" },
);
writeFileSync(
  join(outDir, "edexo-client.sh"),
  sh("edexo-client", "this PC only (127.0.0.1:7111), and opens your browser on the app."),
  { encoding: "utf8" },
);

const readme = `ED Exo Compare ${version} — Linux (browser UI)

UNTESTED: the first Linux release, not yet tried on a real desktop with the game running. What
worked and what did not (distro, desktop, X11 or Wayland) is welcome as a GitHub issue:
https://github.com/bahuckel/EDEXO-Compare/issues

Run one of the launchers in this folder, from a terminal or your file manager:

  ./edexo-client.sh   this PC only (127.0.0.1:7111), and opens your browser on the app
  ./edexo-server.sh   0.0.0.0:7111 — this PC, your LAN and your phone; open the address it prints

Flags pass through: --local, --lan, --port <number>.

JOURNALS
The game runs in a Proton or Wine prefix, and the app looks for its journals there: every Steam
library (native, Flatpak and Snap Steam), Heroic and Lutris prefixes. When it finds several it takes
the one with the newest journal. If yours is somewhere else, set it in the launcher (Journal folder),
or start with ED_JOURNAL_DIR=/path/to/Elite\\ Dangerous ./edexo-client.sh

HUD
This build is the browser UI; the HUD pages work in any browser: open /hud-overlay.html on a second
screen or a phone (start ./edexo-server.sh and use the address it prints).
Elite must run in Borderless: nothing can draw over an exclusive fullscreen game.

YOUR DATA
Settings and caches: ~/.config/edexo-compare (or $XDG_CONFIG_HOME/edexo-compare).
Keep this folder layout: the two programs plus "web" and "data" next to them.

Licence: code MIT (LICENSE); data CC BY-NC-SA 3.0 (LICENSE-DATA.txt); the species photographs
are Elite Dangerous screenshots, Frontier's art under Frontier's terms (NOTICE.md).
`;
writeFileSync(join(outDir, "README.txt"), readme, "utf8");

/* ------------------------------------------------------------------------------------ the tarball */
function gnuTar() {
  if (process.platform === "linux") return { cmd: "tar", gzip: "gzip", env: process.env };
  const git = "C:\\Program Files\\Git\\usr\\bin";
  if (existsSync(join(git, "tar.exe")) && existsSync(join(git, "gzip.exe"))) {
    return {
      cmd: join(git, "tar.exe"),
      gzip: join(git, "gzip.exe"),
      env: { ...process.env, PATH: `${git};${process.env.PATH ?? ""}` },
    };
  }
  throw new Error("GNU tar not found: install Git for Windows, or run this on Linux.");
}

const EXECUTABLE = ["edexo-server", "edexo-client", "edexo-server.sh", "edexo-client.sh"].map(
  (f) => `${folder}/${f}`,
);
const tar = gnuTar();
// `-f` is opened from where tar starts, before `-C` moves it: a path from the repo root.
const plainTar = tarball.replace(/\.gz$/, "").replace(/\\/g, "/");
const common = ["--owner=0", "--group=0", "--numeric-owner", "--format=gnu", "-C", "dist/linux"];
const run = (args) => {
  const r = spawnSync(tar.cmd, args, { stdio: "inherit", env: tar.env });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
};
// Everything readable, folders enterable, nothing else executable...
run([
  "-cf",
  plainTar,
  ...common,
  "--mode=u=rwX,go=rX",
  ...EXECUTABLE.flatMap((f) => ["--exclude", f]),
  folder,
]);
// ...then the four that must run, executable.
run(["-rf", plainTar, ...common, "--mode=0755", ...EXECUTABLE]);
const gz = spawnSync(tar.gzip, ["-9", "-f", plainTar], { stdio: "inherit", env: tar.env });
if (gz.status !== 0) process.exit(gz.status ?? 1);
console.info(`\n[${TAG}] ${tarball}`);
