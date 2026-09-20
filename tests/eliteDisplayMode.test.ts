/**
 * Telling the commander why his HUD cannot be seen, and only when it is true.
 *
 * An always-on-top window draws over a **borderless** game and cannot draw over an **exclusive
 * fullscreen** one. That is a Windows rule: in exclusive fullscreen the game owns the display and
 * the compositor is not in the picture, so no amount of `setAlwaysOnTop` helps.
 *
 * This exists because of the evening it nearly cost. The HUD stopped appearing, the report read as
 * the hotkey breaking, and the cause was the window sitting underneath the game — always-on-top was
 * asserted once at `ready-to-show` and never again. He was in borderless, so re-asserting fixed it
 * (`raiseHudWindow`). Had he been in fullscreen there would have been nothing to fix and no way for
 * the app to say so.
 *
 * The warning is deliberately narrow. It reads the game's own
 * `Options\Graphics\DisplaySettings.xml`, and **says nothing at all** unless that file says
 * Fullscreen — a commander whose Elite lives somewhere this cannot find must not be told his
 * overlays are broken on the strength of a file that was never read.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  eliteDisplaySettingsPath,
  eliteDisplayWarning,
  readEliteDisplayMode,
} from "../src/server/eliteDisplayMode.js";

let dir: string;
let prior: string | undefined;

/** Write a DisplaySettings.xml under a fake Options directory and return its path. */
function withSetting(xml: string): string {
  const graphics = path.join(dir, "Graphics");
  mkdirSync(graphics, { recursive: true });
  const file = path.join(graphics, "DisplaySettings.xml");
  writeFileSync(file, xml, "utf8");
  return file;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-display-"));
  prior = process.env.EDEXO_ELITE_OPTIONS_DIR;
  process.env.EDEXO_ELITE_OPTIONS_DIR = dir;
});

afterEach(() => {
  if (prior === undefined) delete process.env.EDEXO_ELITE_OPTIONS_DIR;
  else process.env.EDEXO_ELITE_OPTIONS_DIR = prior;
  rmSync(dir, { recursive: true, force: true });
});

const SAMPLE = (value: number) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<DisplayConfig>
\t<ScreenWidth>3440</ScreenWidth>
\t<ScreenHeight>1440</ScreenHeight>
\t<FullScreen>${value}</FullScreen>
\t<Monitor>0</Monitor>
</DisplayConfig>`;

describe("reading the game's own setting", () => {
  it("reads borderless, which is the mode the HUDs work in", () => {
    // The owner's real file, at the time this was written.
    const status = readEliteDisplayMode(withSetting(SAMPLE(2)));
    expect(status.mode).toBe("borderless");
    expect(status.overlaysBlocked).toBe(false);
    expect(eliteDisplayWarning(status)).toBeNull();
  });

  it("reads fullscreen, which is the mode nothing can be drawn over", () => {
    const status = readEliteDisplayMode(withSetting(SAMPLE(1)));
    expect(status.mode).toBe("fullscreen");
    expect(status.overlaysBlocked).toBe(true);
    expect(eliteDisplayWarning(status)).toContain("Borderless");
  });

  it("reads windowed, and says nothing", () => {
    const status = readEliteDisplayMode(withSetting(SAMPLE(0)));
    expect(status.mode).toBe("windowed");
    expect(eliteDisplayWarning(status)).toBeNull();
  });

  it("finds the file under the commander's Options directory", () => {
    expect(eliteDisplaySettingsPath()).toBe(path.join(dir, "Graphics", "DisplaySettings.xml"));
  });
});

describe("what it does when it cannot tell", () => {
  it("stays quiet when the file is not there", () => {
    /*
      The case that decides whether this feature is worth having. Elite on another drive, a different
      launcher, or not installed at all must not produce "your overlays will not appear" — a warning
      that fires on a missing file is worse than no warning, because it sends him to change a setting
      that was never the problem.
    */
    const status = readEliteDisplayMode(path.join(dir, "Graphics", "DisplaySettings.xml"));
    expect(status.mode).toBe("unknown");
    expect(status.overlaysBlocked).toBe(false);
    expect(eliteDisplayWarning(status)).toBeNull();
  });

  it("stays quiet when the file holds no such setting", () => {
    const status = readEliteDisplayMode(withSetting("<DisplayConfig><Monitor>0</Monitor></DisplayConfig>"));
    expect(status.mode).toBe("unknown");
    expect(eliteDisplayWarning(status)).toBeNull();
  });

  it("stays quiet on a value it does not recognise", () => {
    // A future mode, or a hand-edited file. Unknown is never a warning.
    const status = readEliteDisplayMode(withSetting(SAMPLE(7)));
    expect(status.mode).toBe("unknown");
    expect(eliteDisplayWarning(status)).toBeNull();
  });

  it("stays quiet on a file it cannot parse as XML at all", () => {
    const status = readEliteDisplayMode(withSetting("not xml, not even close"));
    expect(status.mode).toBe("unknown");
    expect(eliteDisplayWarning(status)).toBeNull();
  });
});

describe("re-reading", () => {
  it("picks up a mode the commander changed while the app was running", () => {
    /*
      He changes this mid-session — that is exactly when he comes looking for the HUD menu — so the
      answer is read on every request rather than cached at boot. A cached "borderless" would keep
      telling him everything is fine while he stares at a screen with no overlay on it.
    */
    const file = withSetting(SAMPLE(2));
    expect(readEliteDisplayMode(file).overlaysBlocked).toBe(false);
    writeFileSync(file, SAMPLE(1), "utf8");
    expect(readEliteDisplayMode(file).overlaysBlocked).toBe(true);
  });
});
