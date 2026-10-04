import { cpSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runPkg as runPkgShared, writeCliLaunchers } from "./cliPack.mjs";
import { mergeDataOverlays } from "./mergeDataOverlay.mjs";
import { copyDataTree } from "./packagedData.mjs";
import { signWindowsArtifactsIfConfigured } from "./sign-windows-artifacts.mjs";

const outDir = join("dist", "cli-pack");
const target = process.env.EDEXO_PKG_TARGET ?? "node22-win-x64";

function rimrafSync(p) {
  if (existsSync(p)) rmSync(p, { recursive: true, maxRetries: 10, retryDelay: 200 });
}

rimrafSync(outDir);
mkdirSync(outDir, { recursive: true });

// The argv wrappers and the pkg call live in cliPack.mjs, shared with the Linux build.
writeCliLaunchers();
const runPkg = (label, entry, exeName) =>
  runPkgShared("dist:win:cli", label, entry, join(outDir, exeName), target);

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
