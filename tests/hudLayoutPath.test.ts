/**
 * The HUD layout lives with the rest of the user data, and follows EDEXO_USER_DATA_DIR.
 *
 * It was the one piece of app state the override did not cover: Electron wrote it to its own
 * `app.getPath("userData")`. So an "isolated" second instance — the exact thing the override exists
 * for — rewrote the real app's overlay set, and a cold-test recipe written the day before was wrong
 * because of it. Found by driving the CLI overlay commands at a test instance and watching the
 * commander's own HUD sections change.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { resolveHudLayoutPath, resolveUserSettingsJsonPath } from "../src/server/paths.js";

let userDir = "";
let prior: string | undefined;

beforeEach(() => {
  userDir = mkdtempSync(join(tmpdir(), "edexo-hudpath-"));
  prior = process.env.EDEXO_USER_DATA_DIR;
  process.env.EDEXO_USER_DATA_DIR = userDir;
});

afterEach(() => {
  if (prior === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = prior;
  rmSync(userDir, { recursive: true, force: true });
});

describe("where the HUD layout is written", () => {
  it("follows the override, so an isolated run cannot touch a real profile", () => {
    // THE ONE THAT MATTERS. Everything else in this file is shape; this is the guarantee.
    expect(resolveHudLayoutPath().startsWith(userDir)).toBe(true);
  });

  it("sits beside the user settings, like every other piece of user data", () => {
    expect(dirname(resolveHudLayoutPath())).toBe(dirname(resolveUserSettingsJsonPath()));
  });

  it("keeps the name Electron used, so a carried-over file needs no rewriting", () => {
    expect(resolveHudLayoutPath().endsWith("hud-layout.json")).toBe(true);
  });
});
