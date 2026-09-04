import { cpSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mergeDataOverlays } from "./mergeDataOverlay.mjs";
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

/** Thin argv wrappers so @yao-pkg/pkg can build two entrypoints from one bundle. */
const launchServer = `process.argv.push("--host","0.0.0.0","--port","7111");\nrequire("./app.cjs");\n`;
const launchClient = `process.argv.push("--host","127.0.0.1","--port","7111","--open");\nrequire("./app.cjs");\n`;

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
cpSync("data", join(outDir, "data"), { recursive: true });
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
