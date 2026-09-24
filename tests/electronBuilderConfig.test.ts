/**
 * The diagnostic logger (`electron/diag.cjs`) is for testing builds only (owner, 2026-09-25): the
 * default build must not pack it, and only `EDEXO_DIAG=1` (`npm run dist:win:diag`) may.
 */
import { createRequire } from "node:module";
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
});
