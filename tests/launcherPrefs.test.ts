/**
 * The launcher's "open the UI in…" choice lives in user data, so a rebuilt exe keeps it (owner,
 * 2026-09-26). Tests run with a temporary EDEXO_USER_DATA_DIR (tests/setup).
 */
import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isLauncherOpenMode,
  launcherPrefsPath,
  readLauncherOpenMode,
  writeLauncherOpenMode,
} from "../src/server/launcherPrefs.js";

describe("launcher prefs", () => {
  it("is null until saved, then reads back what was saved", () => {
    rmSync(launcherPrefsPath(), { force: true });
    expect(readLauncherOpenMode()).toBeNull();
    writeLauncherOpenMode("window");
    expect(readLauncherOpenMode()).toBe("window");
    writeLauncherOpenMode("phone");
    expect(readLauncherOpenMode()).toBe("phone");
    rmSync(launcherPrefsPath(), { force: true });
  });

  it("accepts only the three destinations", () => {
    expect(isLauncherOpenMode("browser")).toBe(true);
    expect(isLauncherOpenMode("window")).toBe(true);
    expect(isLauncherOpenMode("elsewhere")).toBe(false);
    expect(isLauncherOpenMode(1)).toBe(false);
  });
});
