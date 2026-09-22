import { cpSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mergeDataOverlays } from "./mergeDataOverlay.mjs";
import { copyDataTree } from "./packagedData.mjs";
import { signWindowsArtifactsIfConfigured } from "./sign-windows-artifacts.mjs";

const require = createRequire(import.meta.url);

const outDir = join("dist", "cli-pack");
const pkgBin = require.resolve("@yao-pkg/pkg/lib-es5/bin.js");
const target = process.env.EDEXO_PKG_TARGET ?? "node18-win-x64";

function rimrafSync(p) {
  if (existsSync(p)) rmSync(p, { recursive: true, maxRetries: 10, retryDelay: 200 });
}

rimrafSync(outDir);
mkdirSync(outDir, { recursive: true });

/**
 * Thin argv wrappers so @yao-pkg/pkg can build two entrypoints from one bundle.
 *
 * These supply **defaults**, and it matters that they are not overrides. They used to push
 * `--host` unconditionally, and `parseHost` only looks at `--local` / `--lan` when no `--host` is
 * present — so `EDExoCompare-Server-CLI.exe --local` bound `0.0.0.0` anyway, minted a LAN key and
 * printed "On your phone" links, having been asked for loopback only. A flag that is silently
 * ignored is worse than one that is rejected. Found by running the packaged exe, which nothing had
 * done before the first release.
 */
const hostDefault = (host) =>
  `if (!process.argv.some((a) => a === "--host" || a === "--lan" || a === "--local")) process.argv.push("--host", "${host}");\n`;
const portDefault = `if (!process.argv.includes("--port")) process.argv.push("--port", "7111");\n`;

const launchServer = `${hostDefault("0.0.0.0")}${portDefault}require("./app.cjs");\n`;
const launchClient = `${hostDefault("127.0.0.1")}${portDefault}if (!process.argv.includes("--open")) process.argv.push("--open");\nrequire("./app.cjs");\n`;

writeFileSync(join("build", "launch-server.cjs"), launchServer, "utf8");
writeFileSync(join("build", "launch-client.cjs"), launchClient, "utf8");

function runPkg(label, entry, exeName) {
  const outFile = join(outDir, exeName);
  console.info(`[dist:win:cli] ${label} → ${outFile} (pkg ${target})`);
  /** Pkg pulls deps that still `require("punycode")` (Node built-in); Node emits DEP0040 during the packaging run. */
  const prevOpts = process.env.NODE_OPTIONS?.trim() ?? "";
  const pkgNodeOptions = prevOpts ? `${prevOpts} --no-deprecation` : "--no-deprecation";
  const r = spawnSync(process.execPath, [pkgBin, entry, "--targets", target, "--output", outFile], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: { ...process.env, NODE_OPTIONS: pkgNodeOptions },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
}

runPkg("Server (console)", join("build", "launch-server.cjs"), "EDExoCompare-Server-CLI.exe");
runPkg("Client (console)", join("build", "launch-client.cjs"), "EDExoCompare-Client-CLI.exe");

signWindowsArtifactsIfConfigured([
  join(outDir, "EDExoCompare-Server-CLI.exe"),
  join(outDir, "EDExoCompare-Client-CLI.exe"),
]);

cpSync(join("dist", "web"), join(outDir, "web"), { recursive: true });
copyDataTree(join(outDir, "data"));
mergeDataOverlays(join(outDir, "data"));

const readme = `ED Exo Compare — Windows CLI build (no Electron, console stays open)

Run one of the executables in this folder:

- EDExoCompare-Server-CLI.exe — listens on 0.0.0.0:7111 (LAN + this PC).
- EDExoCompare-Client-CLI.exe — 127.0.0.1:7111 and opens your browser to the app.

Keep this folder layout: the .exe plus "web" and "data" next to it.

Edit species under data/species/<Genus>/ and prices in data/price-list.json.

Logs on errors: edexo-compare-startup-error.log / edexo-compare-crash.log next to the .exe.
`;
writeFileSync(join(outDir, "README.txt"), readme, "utf8");

console.info("\nCLI pack output:", outDir);
