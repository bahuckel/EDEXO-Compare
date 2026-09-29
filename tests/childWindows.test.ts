/**
 * The galaxy map's window (electron/childWindows.cjs, owner 2026-09-29): which links open it, and how
 * big it comes up the first time — large on the app window's screen, not Electron's 800 × 600.
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { GALAXY_MIN, childWindowKind, galaxyWindowBounds } = require("../electron/childWindows.cjs") as {
  GALAXY_MIN: { w: number; h: number };
  childWindowKind: (url: string) => string | null;
  galaxyWindowBounds: (
    saved: { x: number; y: number; width: number; height: number } | null,
    area: { x: number; y: number; width: number; height: number },
  ) => { x: number; y: number; width: number; height: number };
};

describe("galaxy map window", () => {
  it("is the window for the 3D map and the Classic map, and only for them", () => {
    expect(childWindowKind("http://127.0.0.1:7111/?screen=galaxy")).toBe("galaxy");
    expect(childWindowKind("http://127.0.0.1:7111/?screen=map")).toBe("galaxy");
    expect(childWindowKind("http://127.0.0.1:7111/?screen=triage")).toBeNull();
    expect(childWindowKind("http://127.0.0.1:7111/")).toBeNull();
    expect(childWindowKind("not a url")).toBeNull();
  });

  it("opens large and centred on the app window's screen the first time", () => {
    const b = galaxyWindowBounds(null, { x: 1920, y: 0, width: 2560, height: 1400 });
    expect(b).toEqual({ x: 1920 + 380, y: 160, width: 1800, height: 1080 });
    // A 1920 × 1040 work area: 92 %, so the toolbar is on one line (it needs 1,280).
    const hd = galaxyWindowBounds(null, { x: 0, y: 0, width: 1920, height: 1040 });
    expect(hd.width).toBe(1766);
    expect(hd.width).toBeGreaterThanOrEqual(1280);
  });

  it("never opens smaller than its minimum, or larger than a small screen", () => {
    const small = galaxyWindowBounds(null, { x: 0, y: 0, width: 800, height: 500 });
    expect(small).toEqual({ x: 0, y: 0, width: 800, height: 500 });
    const mid = galaxyWindowBounds(null, { x: 0, y: 0, width: 960, height: 600 });
    expect(mid.width).toBe(GALAXY_MIN.w);
    expect(mid.height).toBe(GALAXY_MIN.h);
  });

  it("comes back where it was left", () => {
    const saved = { x: 40, y: 30, width: 1400, height: 900 };
    expect(galaxyWindowBounds(saved, { x: 0, y: 0, width: 2560, height: 1400 })).toEqual(saved);
  });
});
