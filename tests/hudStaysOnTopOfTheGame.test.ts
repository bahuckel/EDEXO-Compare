/**
 * The HUD has to keep the top of the z-order, not merely be told to take it once.
 *
 * The commander's report read as the hotkey breaking again: *"the issue with the HUD not popping up
 * when key combo is pressed is back"*. It was not the hotkey. His own next two answers settled it —
 * the launcher's toggle did not work either, and with everything minimised the keys **did** bring the
 * HUD up, which then vanished the moment Elite went fullscreen. A window that appears with the game
 * minimised and disappears when it is not was never missing; it was underneath.
 *
 * Windows does not promise that an always-on-top window stays on top for the rest of its life. A game
 * coming to the foreground can push every other topmost window below it, and the flag still reads
 * true afterwards. `main.cjs` asserted the level exactly once, in `ready-to-show`, so the first time
 * Elite took the foreground the HUDs went behind it and nothing in the app ever asked again.
 *
 * `electron/main.cjs` cannot be imported here — it reaches for `app` on load — so the rule is pinned
 * against a transcription and the wiring is then checked in the source, the same way
 * `hudHotkeyReopens.test.ts` does. A rule nobody calls is a rule that does not hold.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const main = readFileSync(path.resolve(__dirname, "../electron/main.cjs"), "utf8");

interface FakeWindow {
  destroyed: boolean;
  calls: string[];
  level: string | null;
}

function win(destroyed = false): FakeWindow {
  return { destroyed, calls: [], level: null };
}

/** What `raiseHudWindow` does, transcribed. */
function raise(w: FakeWindow): void {
  if (w.destroyed) return;
  w.calls.push("showInactive");
  w.calls.push("setAlwaysOnTop");
  w.level = "screen-saver";
  w.calls.push("moveTop");
}

/** What the keep-on-top tick does on each firing. */
function tick(args: { hidden: boolean; windows: FakeWindow[] }): "stopped" | "raised" {
  const live = args.windows.filter((w) => !w.destroyed);
  if (args.hidden || live.length === 0) return "stopped";
  for (const w of live) raise(w);
  return "raised";
}

describe("raising a HUD", () => {
  it("asks for the top again, at the highest level, without taking focus", () => {
    const w = win();
    raise(w);
    // `showInactive` rather than `show`, `moveTop` rather than `focus`: the foreground window is a
    // game, and stealing focus from it is worse than the bug being fixed.
    expect(w.calls).toEqual(["showInactive", "setAlwaysOnTop", "moveTop"]);
    expect(w.calls).not.toContain("focus");
    expect(w.level).toBe("screen-saver");
  });

  it("does nothing to a destroyed window", () => {
    const w = win(true);
    raise(w);
    expect(w.calls).toEqual([]);
  });
});

describe("the keep-on-top tick", () => {
  it("re-asserts every live window while the HUDs are shown", () => {
    const a = win();
    const b = win();
    expect(tick({ hidden: false, windows: [a, b] })).toBe("raised");
    expect(a.level).toBe("screen-saver");
    expect(b.level).toBe("screen-saver");
  });

  it("stops itself when the HUDs are hidden", () => {
    // Hidden means the commander asked for them gone. Re-raising then would fight him.
    const a = win();
    expect(tick({ hidden: true, windows: [a] })).toBe("stopped");
    expect(a.calls).toEqual([]);
  });

  it("stops itself when nothing is left on screen", () => {
    expect(tick({ hidden: false, windows: [win(true)] })).toBe("stopped");
    expect(tick({ hidden: false, windows: [] })).toBe("stopped");
  });
});

describe("the wiring in electron/main.cjs", () => {
  it("has a single place that raises a window, and uses the highest level", () => {
    expect(main).toContain("function raiseHudWindow(win)");
    expect(main).toContain('win.setAlwaysOnTop(true, "screen-saver")');
  });

  it("raises on every path that puts a HUD on screen", () => {
    // Creating one, reopening the remembered set from the hotkey, and un-hiding the stack. Miss any
    // one of them and the HUD is on screen but under the game, which is the reported symptom.
    expect(main).toContain("raiseHudWindow(win);\n    keepHudsOnTop();");
    expect(main).toContain("for (const s of hudOverlayStack) raiseHudWindow(s.win);");
    expect(main).toMatch(/if \(hudHidden\) stopKeepingHudsOnTop\(\);\s*\n\s*else keepHudsOnTop\(\);/);
  });

  it("keeps asking on a timer, because nothing tells an app it has been pushed down", () => {
    expect(main).toContain("const HUD_KEEP_ON_TOP_MS");
    expect(main).toMatch(/hudKeepOnTopTimer = setInterval\(/);
    expect(main).toContain("function stopKeepingHudsOnTop()");
    // An idle app must not hold a timer, and the timer must never keep the process alive.
    expect(main).toMatch(/unref/);
  });

  it("never shows a HUD without raising it", () => {
    /*
      The sabotage check. Every `showInactive` in this file has to be the one inside `raiseHudWindow`
      — a second one anywhere else is a path that puts a window on screen and leaves it under the
      game, which is exactly how this bug shipped.
    */
    const showInactiveCalls = main.match(/\.showInactive\(\)/g) ?? [];
    expect(showInactiveCalls).toHaveLength(1);
  });
});
