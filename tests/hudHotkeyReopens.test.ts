/**
 * The hotkey has to be able to *open* a HUD, not only un-hide one.
 *
 * The commander's report, and it had been raised once before without being finished: after a
 * restart the HUD cannot be brought back with Ctrl+Alt+H at all. Pressing it any number of times
 * does nothing. The only way out was toggling a HUD off and on in the picker, or splitting and
 * recombining the windows — anything that *created* a window.
 *
 * `toggleHudVisibility` only ever flipped `hudHidden` and looped over `hudOverlayStack` calling
 * `show`/`hide`. When that stack is empty the loop does nothing and the flag just flips back and
 * forth, forever. Nothing else in the app reopens the set.
 *
 * And the stack is empty more often than it looks. It is pruned as windows are destroyed, so a
 * shutdown can leave `open: []` on disk while the commander's intent — "these four HUDs" — has not
 * changed; and a restore that opened nothing used to hide the stack anyway, recording "hidden" when
 * there was nothing to hide.
 *
 * `electron/main.cjs` cannot be imported here — it reaches for `app` on load — so the rules are
 * pinned against a transcription, and then the wiring is checked in the source, because a rule
 * nobody calls is a rule that does not hold.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const main = readFileSync(path.resolve(__dirname, "../electron/main.cjs"), "utf8");

type Slot = { alive: boolean };

/** What the hotkey should do, given what is on screen and what is remembered. */
function hotkeyAction(args: { hidden: boolean; live: Slot[]; remembered: number }): "open" | "show" | "hide" {
  const nextHidden = !args.hidden;
  if (!nextHidden && args.live.filter((s) => s.alive).length === 0 && args.remembered > 0) return "open";
  return nextHidden ? "hide" : "show";
}

describe("pressing the hotkey with nothing on screen", () => {
  it("opens the remembered set instead of flipping a flag over nothing", () => {
    // The exact report: restart, no windows, and the keys do nothing however often they are pressed.
    expect(hotkeyAction({ hidden: true, live: [], remembered: 4 })).toBe("open");
    expect(hotkeyAction({ hidden: false, live: [], remembered: 4 })).toBe("hide");
    // ...and on the next press it opens, rather than spending a third press.
    expect(hotkeyAction({ hidden: true, live: [], remembered: 4 })).toBe("open");
  });

  it("still just shows the windows when there are windows to show", () => {
    expect(hotkeyAction({ hidden: true, live: [{ alive: true }], remembered: 4 })).toBe("show");
  });

  it("treats destroyed windows as nothing on screen", () => {
    // The stack keeps slots whose window has gone; counting those as visible is how a press
    // appeared to succeed while nothing happened.
    expect(hotkeyAction({ hidden: true, live: [{ alive: false }, { alive: false }], remembered: 2 })).toBe(
      "open",
    );
  });

  it("does nothing special when there is nothing remembered either", () => {
    // A commander who has genuinely closed every HUD asked for none, and gets none.
    expect(hotkeyAction({ hidden: true, live: [], remembered: 0 })).toBe("show");
  });

  it("hides as it always did", () => {
    expect(hotkeyAction({ hidden: false, live: [{ alive: true }], remembered: 4 })).toBe("hide");
  });
});

describe("remembering what was open", () => {
  /** `open` is the live stack; the memory must not follow it down to empty. */
  function remember(previous: string[], liveNow: string[]): string[] {
    return liveNow.length ? liveNow : previous;
  }

  it("keeps the last real set when the stack empties at shutdown", () => {
    expect(remember(["/fss-scan-overlay.html"], [])).toEqual(["/fss-scan-overlay.html"]);
  });

  it("follows the commander when they actually change the set", () => {
    expect(remember(["/a.html"], ["/b.html", "/c.html"])).toEqual(["/b.html", "/c.html"]);
  });
});

describe("the wiring in main.cjs", () => {
  it("reopens from the hotkey when the stack is empty", () => {
    expect(main).toContain("reopenRememberedHuds");
    expect(main).toMatch(/if \(!hudHidden && live\.length === 0 && hudRememberedOpen\.length\)/);
  });

  it("persists the remembered set, and never lets an empty stack erase it", () => {
    expect(main).toMatch(/if \(open\.length\) hudRememberedOpen = open;/);
    expect(main).toContain("lastOpen: hudRememberedOpen");
  });

  it("does not record the stack as hidden when the restore opened nothing", () => {
    expect(main).toMatch(
      /if \(hudOverlayStack\.some\(\(s\) => s\.win && !s\.win\.isDestroyed\(\)\)\) toggleHudVisibility\(true\);/,
    );
  });

  it("counts only live windows before deciding there is something to show", () => {
    expect(main).toMatch(
      /const live = hudOverlayStack\.filter\(\(s\) => s\.win && !s\.win\.isDestroyed\(\)\);/,
    );
  });
});
