/**
 * A HUD asked for from the launcher has to be visible.
 *
 * `electron/main.cjs` cannot be imported here — it reaches for `app` on load — so this pins the rule
 * against a transcription of the decision rather than the module. That is worth having anyway: the
 * bug was not in the hiding, which is deliberate, but in the fact that **nothing ever un-hid**.
 *
 * The chain the commander reported: leave overlays open, restart, and `restoreHudOverlays` reopens
 * them and hides the stack so the hotkey brings back exactly the set that was left. `hudHidden` then
 * stays true for the rest of the run, the launcher has no visibility control of its own, and every
 * overlay opened from the picker was hidden the instant it loaded — ticked as on, showing nothing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/** The three modes `requestHudOverlaySlot` takes, and whether each is somebody clicking. */
const EXPLICIT: Record<string, boolean> = { toggle: true, set: true, open: false };

function shouldUnhide(mode: string, hudHidden: boolean): boolean {
  return mode !== "open" && hudHidden;
}

describe("asking for a HUD is asking to see it", () => {
  it("un-hides for a click, whichever way the launcher opens it", () => {
    expect(shouldUnhide("toggle", true)).toBe(true);
    expect(shouldUnhide("set", true)).toBe(true);
  });

  it("leaves the restore path alone, which is the whole point of restoring quietly", () => {
    expect(shouldUnhide("open", true)).toBe(false);
  });

  it("does nothing when the stack was already visible", () => {
    for (const mode of Object.keys(EXPLICIT)) expect(shouldUnhide(mode, false)).toBe(false);
  });

  it("is actually wired into main.cjs, in front of the slot lookup", () => {
    // A rule nobody calls is a rule that does not hold. This is the one line that fixes the report,
    // and it has to run before the early returns further down the function.
    const src = readFileSync(path.resolve(__dirname, "../electron/main.cjs"), "utf8");
    const guard = src.indexOf('if (mode !== "open" && hudHidden) toggleHudVisibility(false);');
    const lookup = src.indexOf("const existing = hudOverlayStack.findIndex");
    expect(guard).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(guard);
  });

  it("still hides a window that arrives while the stack is hidden", () => {
    // The restore path depends on it: reopened HUDs must not flash onto the screen at launch.
    const src = readFileSync(path.resolve(__dirname, "../electron/main.cjs"), "utf8");
    expect(src).toContain("if (hudHidden) win.hide();");
  });
});
