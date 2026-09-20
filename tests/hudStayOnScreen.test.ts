/**
 * A HUD that is on the screen has to stay on the screen.
 *
 * The owner's report: *"the overlay stops working now and again from the launcher, it just
 * disappears, hotkeys dont bring it back, I have to remove the 'merge into one panel' option and
 * then click it again to make it appear, or restart the app"*.
 *
 * The HUDs are positioned from `screen.getPrimaryDisplay().workArea`, and nothing listened to the
 * display. When the work area changed the windows kept coordinates computed for a screen that no
 * longer existed — off the edge on a shrink, and unreachable: they are frameless, click-through and
 * have no taskbar entry. Elite does this routinely, going fullscreen and coming back.
 *
 * Every symptom follows from that one fact. The hotkey could not help because hiding and showing
 * does not move a window. Unticking "merge into one panel" and re-ticking it helped because it
 * builds a *new* window, and a new window is laid out against the current work area.
 *
 * `electron/main.cjs` reaches for `app` on load and cannot be imported here, so the geometry is
 * tested against a transcription of it and the wiring is asserted against the file.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC = readFileSync(path.resolve(__dirname, "../electron/main.cjs"), "utf8");

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The placement rule out of `relayoutHudStack`, clamp included. */
function place(
  workArea: Rect,
  corner: "tl" | "tr" | "bl" | "br",
  heights: number[],
  w: number,
  gap = 8,
  margin = 14,
): Rect[] {
  const atBottom = corner.startsWith("b");
  const atRight = corner.endsWith("r");
  const x = atRight ? Math.floor(workArea.x + workArea.width - margin - w) : workArea.x + margin;
  let y = atBottom ? workArea.y + workArea.height - margin : workArea.y + margin;
  const fit = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const out: Rect[] = [];
  for (const h of heights) {
    if (atBottom) y -= h;
    out.push({
      x: fit(x, workArea.x, Math.max(workArea.x, workArea.x + workArea.width - w)),
      y: fit(y, workArea.y, Math.max(workArea.y, workArea.y + workArea.height - h)),
      width: w,
      height: h,
    });
    y = atBottom ? y - gap : y + h + gap;
  }
  return out;
}

const onScreen = (r: Rect, wa: Rect) =>
  r.x >= wa.x && r.y >= wa.y && r.x + r.width <= wa.x + wa.width && r.y + r.height <= wa.y + wa.height;

const BIG: Rect = { x: 0, y: 0, width: 3840, height: 2120 };
const SMALL: Rect = { x: 0, y: 0, width: 1920, height: 1040 };

describe("where the HUD stack sits", () => {
  it("hugs the chosen corner on a screen with room", () => {
    const [first] = place(BIG, "tr", [330], 404);
    expect(first!.x).toBe(3840 - 14 - 404);
    expect(first!.y).toBe(14);
    expect(onScreen(first!, BIG)).toBe(true);
  });

  it("keeps a window on the screen when the work area shrinks under it", () => {
    /*
      This is the bug. 3840 wide gives x = 3422; on a 1920 desktop that is 1502 px past the right
      edge, and the window is frameless and click-through, so there is nothing to drag back.
    */
    const stale = place(BIG, "tr", [330], 404)[0]!;
    expect(onScreen(stale, SMALL)).toBe(false);

    const fresh = place(SMALL, "tr", [330], 404)[0]!;
    expect(fresh.x).toBe(1920 - 14 - 404);
    expect(onScreen(fresh, SMALL)).toBe(true);
  });

  it("holds a stack taller than the screen inside it rather than running off the bottom", () => {
    // Five HUDs at 330 is 1,682 px with the gaps — taller than a 1040 px work area.
    const rects = place(SMALL, "tl", [330, 330, 330, 330, 330], 404);
    expect(rects).toHaveLength(5);
    for (const r of rects) expect(onScreen(r, SMALL)).toBe(true);
  });

  it("does the same anchored to a bottom corner, where the overflow goes upwards", () => {
    for (const r of place(SMALL, "br", [330, 330, 330, 330, 330], 404)) {
      expect(onScreen(r, SMALL)).toBe(true);
    }
  });

  it("survives a work area that does not start at the origin", () => {
    // A second monitor left of the primary, or a taskbar on the top edge.
    const offset: Rect = { x: -1920, y: 40, width: 1920, height: 1000 };
    for (const r of place(offset, "br", [330, 330], 404)) expect(onScreen(r, offset)).toBe(true);
  });
});

describe("the wiring that makes the fix real", () => {
  it("listens to the display, which nothing did before", () => {
    // A rule nobody calls is a rule that does not hold.
    for (const ev of ["display-metrics-changed", "display-added", "display-removed"]) {
      expect(SRC).toContain(ev);
    }
    expect(SRC).toContain("watchDisplaysForHudRelayout();");
  });

  it("coalesces the burst Windows sends for one resolution change", () => {
    expect(SRC).toContain("function scheduleHudRelayout()");
    expect(SRC).toContain("clearTimeout(relayoutTimer)");
  });

  it("makes showing the HUDs reposition them, so the hotkey is a rescue", () => {
    // The reflex when a HUD is missing is the hotkey; it has to do more than flip a flag.
    expect(SRC).toContain("if (!hudHidden) relayoutHudStack();");
  });

  it("clamps inside relayoutHudStack itself, not only in this transcription", () => {
    const relayout = SRC.slice(
      SRC.indexOf("function relayoutHudStack()"),
      SRC.indexOf("function scheduleHudRelayout"),
    );
    expect(relayout).toContain("const fit =");
    expect(relayout).toContain("wa.x + wa.width - w");
  });

  it("drops a destroyed window before looking a slot up", () => {
    /*
      The other way the overlay becomes unreachable: a dead slot answers for a live window, `set`
      sees the pathname already matches and returns `opened: true` having done nothing, and every
      further click takes the same early return.
    */
    const lookup = SRC.indexOf("const existing = hudOverlayStack.findIndex");
    expect(lookup).toBeGreaterThan(-1);
    // The prune has to be the one immediately in front of the lookup, not the one inside relayout.
    const prune = SRC.lastIndexOf("!s.win.isDestroyed())", lookup);
    expect(prune).toBeGreaterThan(-1);
    expect(lookup - prune).toBeLessThan(400);
  });
});
