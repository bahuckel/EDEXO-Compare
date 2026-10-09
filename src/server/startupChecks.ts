/**
 * Start-up checks: the packaged resources are where they should be, and fatal errors are shown and logged. Split out of edexoBootstrap.ts (code review D, 2026-09-28).
 */
import { getProjectRoot, getSpeciesDataDir, getWebRoot } from "./paths.js";
import path from "node:path";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";

export function showEdexoNativeFixInfo(message: string): boolean {
  if (process.env.EDEXO_ELECTRON !== "1") return false;
  // The server's own process has no `dialog`: the main process shows it (serverChild.ts).
  const port = (process as unknown as { parentPort?: { postMessage(m: unknown): void } }).parentPort;
  if (process.env.EDEXO_SERVER_CHILD === "1" && port) {
    port.postMessage({ type: "dialog", title: "ED Exo Compare — Fix", message });
    return true;
  }
  try {
    const electron = require("electron") as typeof import("electron");
    electron.dialog.showMessageBoxSync({
      type: "info",
      title: "ED Exo Compare — Fix",
      message,
    });
    return true;
  } catch {
    return false;
  }
}

export function logFatal(lines: string[]): never {
  const text = lines.join("\n");
  console.error(text);
  try {
    const logPath = path.join(path.dirname(process.execPath), "edexo-compare-startup-error.log");
    writeFileSync(logPath, `${text}\n`, "utf8");
  } catch {
    /* ignore */
  }
  if (process.env.EDEXO_ELECTRON === "1") {
    throw new Error(text);
  }
  process.exit(1);
}

export function assertResourceLayout(): void {
  const root = getProjectRoot();
  const webRoot = getWebRoot(root);
  const indexHtml = path.join(webRoot, "index.html");
  const speciesTree = getSpeciesDataDir(root);
  const missing: string[] = [];
  if (!existsSync(indexHtml)) {
    missing.push(`UI not found: ${indexHtml}`);
  }
  if (!existsSync(speciesTree) || !statSync(speciesTree).isDirectory()) {
    missing.push(`Species data folder not found: ${speciesTree}`);
  } else {
    let hasGenusJson = false;
    try {
      for (const name of readdirSync(speciesTree)) {
        const p = path.join(speciesTree, name);
        if (!statSync(p).isDirectory()) continue;
        for (const f of readdirSync(p)) {
          if (f.toLowerCase().endsWith(".json") && f.toLowerCase() !== "package.json") {
            hasGenusJson = true;
            break;
          }
        }
        if (hasGenusJson) break;
      }
    } catch {
      hasGenusJson = false;
    }
    if (!hasGenusJson) {
      missing.push(
        `No genus .json under: ${speciesTree} — add data/species/<Genus>/<genus>.json (and optional <Genus>-notes.txt, <Genus>_photos/).`,
      );
    }
  }
  if (missing.length) {
    const lines = [
      "ED Exo Compare — cannot start.",
      ...missing,
      "",
      'Keep "web" and "data" next to the app; species live in data/species/<genus>/.',
      "(Development: npm run build)",
    ];
    if (process.env.EDEXO_ELECTRON === "1") {
      throw new Error(lines.join("\n"));
    }
    logFatal(lines);
  }
}
