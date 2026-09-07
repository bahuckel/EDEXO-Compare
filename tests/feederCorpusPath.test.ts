/**
 * The feeder corpus must be findable from a packaged build.
 *
 * Reported by the owner 2026-09-07: *"Feeder is nowhere to be seen yet."* It had shipped, and it
 * could not appear. The toolbar entry is gated on `feederDataDirExists()`, which looked in exactly
 * two places, both relative to `PROJECT_ROOT`:
 *
 *   <PROJECT_ROOT>/feeder-data
 *   <PROJECT_ROOT>/../exomastery-feeder/data
 *
 * In the installed app `PROJECT_ROOT` is the resources directory inside `win-unpacked`, so both
 * resolve to folders that will never exist. The owner's corpus sits beside the *repository*, which
 * the exe has no way to find and no business guessing at. The dev server found it and the shipped
 * app never could — a feature that merged correctly was invisible to the only person with a corpus.
 *
 * A remembered path fixes it, and its rung in the search order is what these tests pin.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  configuredFeederDataDir,
  feederDataDirCandidates,
  feederDataDirConfigPath,
  feederDataDirExists,
  feederDataDir,
  setConfiguredFeederDataDir,
  setFeederDataDirForTests,
} from "../src/feeder/paths.js";

let home: string;
let corpus: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "edexo-userdata-"));
  corpus = mkdtempSync(path.join(tmpdir(), "edexo-corpus-"));
  // `resolveUserSettingsJsonPath` reads this on every call, so the pointer file lands in a scratch
  // directory rather than the developer's real profile.
  process.env.EDEXO_USER_DATA_DIR = home;
  delete process.env.EDEXO_FEEDER_DATA_DIR;
  setFeederDataDirForTests(null); // drop the cached answer from the previous case
});

afterEach(() => {
  delete process.env.EDEXO_USER_DATA_DIR;
  delete process.env.EDEXO_FEEDER_DATA_DIR;
  setFeederDataDirForTests(null);
  rmSync(home, { recursive: true, force: true });
  rmSync(corpus, { recursive: true, force: true });
});

describe("remembering where the corpus lives", () => {
  it("saves a folder and reads it back", () => {
    expect(setConfiguredFeederDataDir(corpus).ok).toBe(true);
    expect(configuredFeederDataDir()).toBe(path.resolve(corpus));
    expect(feederDataDir()).toBe(path.resolve(corpus));
    expect(feederDataDirExists()).toBe(true);
  });

  /**
   * A pointer to nothing is indistinguishable from no pointer at the next boot, so the commander
   * would be told their choice took effect and then find the feeder still hidden.
   */
  it("refuses a path that does not exist rather than storing it", () => {
    const r = setConfiguredFeederDataDir(path.join(corpus, "nope"));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/does not exist/i);
    expect(configuredFeederDataDir()).toBeNull();
  });

  it("refuses a file where a folder belongs", () => {
    const f = path.join(corpus, "a-file.txt");
    writeFileSync(f, "x", "utf8");
    expect(setConfiguredFeederDataDir(f).ok).toBe(false);
  });

  it("forgets the path when cleared, falling back to the search", () => {
    setConfiguredFeederDataDir(corpus);
    expect(configuredFeederDataDir()).toBe(path.resolve(corpus));
    expect(setConfiguredFeederDataDir(null).ok).toBe(true);
    expect(configuredFeederDataDir()).toBeNull();
  });

  it("treats an unreadable pointer file as no pointer, rather than throwing", () => {
    mkdirSync(path.dirname(feederDataDirConfigPath()), { recursive: true });
    writeFileSync(feederDataDirConfigPath(), "{not json", "utf8");
    expect(configuredFeederDataDir()).toBeNull();
  });

  it("survives a stored folder that was later deleted", () => {
    setConfiguredFeederDataDir(corpus);
    rmSync(corpus, { recursive: true, force: true });
    expect(configuredFeederDataDir()).toBeNull();
  });
});

describe("search order", () => {
  /**
   * The env var stays ahead of the remembered path: it is the escape hatch for a one-off run against
   * a different corpus, and a saved setting should not silently win over an explicit override.
   */
  it("puts the environment override ahead of the remembered path", () => {
    const other = mkdtempSync(path.join(tmpdir(), "edexo-corpus2-"));
    try {
      setConfiguredFeederDataDir(corpus);
      process.env.EDEXO_FEEDER_DATA_DIR = other;
      setFeederDataDirForTests(null);
      expect(feederDataDirCandidates()[0]).toBe(path.resolve(other));
      expect(feederDataDirCandidates()[1]).toBe(path.resolve(corpus));
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("still reports the built-in locations, so an empty feeder can say where it looked", () => {
    const dirs = feederDataDirCandidates();
    expect(dirs.some((d) => d.endsWith("feeder-data"))).toBe(true);
    expect(dirs.some((d) => d.includes("exomastery-feeder"))).toBe(true);
  });
});
