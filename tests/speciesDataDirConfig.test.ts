/**
 * Where the chosen species tree is remembered, and who looks for it.
 *
 * `electron/main.cjs` carried its own copy of this discovery — portable `<exeDir>/data/species`,
 * then `species-data-dir.json` in **Electron's** userData — while `paths.ts` carried the same walk
 * against the directory every other entry point uses. Two implementations of one rule, and only the
 * Electron one read a directory `EDEXO_USER_DATA_DIR` does not cover, so an isolated instance would
 * quietly pick up the real profile's species tree.
 *
 * There is one implementation now. These cases cover the part that is easy to get wrong: an upgrade,
 * where the file is still in the old place.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  SPECIES_DATA_DIR_CONFIG,
  reapplySpeciesDataDirDiscoveryFromDisk,
  resolveSpeciesDataDirConfigPath,
  resolveUserSettingsJsonPath,
} from "../src/server/paths.js";

let userDir = "";
let legacyDir = "";
let speciesDir = "";
let prior: Record<string, string | undefined> = {};

const writeConfig = (dir: string, speciesDataDir: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, SPECIES_DATA_DIR_CONFIG), JSON.stringify({ speciesDataDir }), "utf8");
};

beforeEach(() => {
  userDir = mkdtempSync(join(tmpdir(), "edexo-sdd-user-"));
  legacyDir = mkdtempSync(join(tmpdir(), "edexo-sdd-legacy-"));
  speciesDir = mkdtempSync(join(tmpdir(), "edexo-sdd-tree-"));
  prior = {
    user: process.env.EDEXO_USER_DATA_DIR,
    legacy: process.env.EDEXO_LEGACY_USER_DATA_DIR,
    species: process.env.EDEXO_SPECIES_DATA_DIR,
  };
  process.env.EDEXO_USER_DATA_DIR = userDir;
  delete process.env.EDEXO_LEGACY_USER_DATA_DIR;
  delete process.env.EDEXO_SPECIES_DATA_DIR;
});

afterEach(() => {
  for (const [k, v] of [
    ["EDEXO_USER_DATA_DIR", prior.user],
    ["EDEXO_LEGACY_USER_DATA_DIR", prior.legacy],
    ["EDEXO_SPECIES_DATA_DIR", prior.species],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const d of [userDir, legacyDir, speciesDir]) rmSync(d, { recursive: true, force: true });
});

describe("the config file", () => {
  it("is resolved beside the user settings, so the override covers it", () => {
    expect(dirname(resolveSpeciesDataDirConfigPath())).toBe(dirname(resolveUserSettingsJsonPath()));
    expect(resolveSpeciesDataDirConfigPath().startsWith(userDir)).toBe(true);
  });
});

describe("discovery", () => {
  it("reads the config beside the user settings", () => {
    writeConfig(userDir, speciesDir);
    reapplySpeciesDataDirDiscoveryFromDisk();
    expect(process.env.EDEXO_SPECIES_DATA_DIR).toBe(speciesDir);
  });

  it("still finds one left in Electron's old directory, which is what an upgrade looks like", () => {
    /*
      THE ONE THAT MATTERS. `migrateLegacyUserData` copies the file across, but it runs inside
      `startEdexo` — after this discovery has already decided. Without the fallback, the first launch
      after an upgrade would read the shipped species tree instead of the commander's own, and
      nothing would say why the exomastery numbers had changed.
    */
    process.env.EDEXO_LEGACY_USER_DATA_DIR = legacyDir;
    writeConfig(legacyDir, speciesDir);
    reapplySpeciesDataDirDiscoveryFromDisk();
    expect(process.env.EDEXO_SPECIES_DATA_DIR).toBe(speciesDir);
  });

  it("prefers the current location when both exist", () => {
    const newer = mkdtempSync(join(tmpdir(), "edexo-sdd-newer-"));
    try {
      process.env.EDEXO_LEGACY_USER_DATA_DIR = legacyDir;
      writeConfig(legacyDir, speciesDir);
      writeConfig(userDir, newer);
      reapplySpeciesDataDirDiscoveryFromDisk();
      expect(process.env.EDEXO_SPECIES_DATA_DIR).toBe(newer);
    } finally {
      rmSync(newer, { recursive: true, force: true });
    }
  });

  it("leaves an explicit environment setting alone", () => {
    process.env.EDEXO_SPECIES_DATA_DIR = speciesDir;
    writeConfig(userDir, legacyDir);
    reapplySpeciesDataDirDiscoveryFromDisk();
    expect(process.env.EDEXO_SPECIES_DATA_DIR).toBe(speciesDir);
  });

  it("ignores a config pointing at a folder that is not there", () => {
    writeConfig(userDir, join(speciesDir, "gone"));
    reapplySpeciesDataDirDiscoveryFromDisk();
    expect(process.env.EDEXO_SPECIES_DATA_DIR).toBeUndefined();
  });
});
