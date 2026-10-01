/**
 * The launcher's "LAN access" switch (owner, 2026-10-01): a new install listens on this PC only, an
 * existing one keeps the network it had, and the answer is saved once so it never flips by itself.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let dir: string;
const prevDir = process.env.EDEXO_USER_DATA_DIR;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-lan-"));
  process.env.EDEXO_USER_DATA_DIR = dir;
});
afterEach(() => {
  if (prevDir === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = prevDir;
  rmSync(dir, { recursive: true, force: true });
});

describe("LAN access", () => {
  it("is off for a new install and saved that way", async () => {
    const { resolveLanAccess, readLanAccess } = await import("../src/server/launcherPrefs.js");
    expect(resolveLanAccess(() => false)).toBe(false);
    expect(readLanAccess()).toBe(false);
  });

  it("stays on for an existing install, and is saved so it does not flip later", async () => {
    const { resolveLanAccess, readLanAccess } = await import("../src/server/launcherPrefs.js");
    expect(resolveLanAccess(() => true)).toBe(true);
    expect(readLanAccess()).toBe(true);
    // Next start: the saved choice wins whatever the install looks like.
    expect(resolveLanAccess(() => false)).toBe(true);
  });

  it("follows the switch once it is set, and keeps the other launcher prefs", async () => {
    const m = await import("../src/server/launcherPrefs.js");
    m.writeLauncherOpenMode("window");
    m.writeLanAccess(true);
    expect(m.resolveLanAccess(() => false)).toBe(true);
    m.writeLanAccess(false);
    expect(m.resolveLanAccess(() => true)).toBe(false);
    expect(m.readLauncherOpenMode()).toBe("window");
  });

  it("recognises an install that has run before by its files", async () => {
    const { isExistingInstall, writeLauncherOpenMode } = await import("../src/server/launcherPrefs.js");
    expect(isExistingInstall()).toBe(false);
    writeLauncherOpenMode("browser");
    expect(isExistingInstall()).toBe(true);
  });
});
