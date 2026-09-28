/**
 * The diagnostic logger (`electron/diag.cjs`) is for testing builds only (owner, 2026-09-25): the
 * default build must not pack it, and only `EDEXO_DIAG=1` (`npm run dist:win:diag`) may.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const configPath = require.resolve("../electron-builder.cjs");
const prior = process.env.EDEXO_DIAG;

function loadConfig(diag: string | undefined): { files: string[] } {
  if (diag === undefined) delete process.env.EDEXO_DIAG;
  else process.env.EDEXO_DIAG = diag;
  delete require.cache[configPath];
  return require(configPath) as { files: string[] };
}

afterEach(() => {
  if (prior === undefined) delete process.env.EDEXO_DIAG;
  else process.env.EDEXO_DIAG = prior;
  delete require.cache[configPath];
});

describe("electron-builder files", () => {
  it("leaves the diagnostics out of a normal build", () => {
    expect(loadConfig(undefined).files).not.toContain("electron/diag.cjs");
    expect(loadConfig("0").files).not.toContain("electron/diag.cjs");
  });

  it("packs them only into the diagnostic build", () => {
    expect(loadConfig("1").files).toContain("electron/diag.cjs");
  });

  /*
    Every file the Electron main process loads has to be packed, or the packaged app dies at start
    with "Cannot find module" while the dev run works. main.cjs was split into hudWindows.cjs and
    tray.cjs on 2026-09-28; this walks the requires from main.cjs so the next split cannot forget one.
  */
  it("packs every local file the main process requires", () => {
    const files = loadConfig(undefined).files;
    const seen = new Set<string>();
    const walk = (rel: string) => {
      if (seen.has(rel)) return;
      seen.add(rel);
      const src = readFileSync(path.resolve(__dirname, "..", rel), "utf8");
      for (const m of src.matchAll(/require\("\.\/([\w.-]+\.cjs)"\)/g)) walk(`electron/${m[1]}`);
    };
    walk("electron/main.cjs");
    seen.delete("electron/diag.cjs");
    expect(seen.size).toBeGreaterThanOrEqual(4);
    for (const f of seen) expect(files, f).toContain(f);
  });
});
