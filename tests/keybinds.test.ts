/**
 * Key binds (owner, 2026-10-02): electron/keybinds.cjs with a fake globalShortcut and a temp folder.
 * "Two keys, default F1 (previous) F2 next for the body tabs. Customizable in the launcher. Allow
 * combinations with up to 3 keys, put the HUD toggle there as well."
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const kb = require("../electron/keybinds.cjs") as {
  createKeybinds: (deps: unknown) => {
    load: () => void;
    apply: () => Record<string, string>;
    set: (n: Record<string, string | null>) => { binds: Record<string, string>; status: Record<string, string> };
    get: () => {
      binds: Record<string, string>;
      status: Record<string, string>;
      actions: Record<string, { label: string; default: string; gameOnly: boolean; group: string }>;
      groups: string[];
    };
    pause: (on: boolean) => unknown;
    setGameFocused: (on: boolean) => void;
    bindFor: (k: string) => string;
  };
  validAccelerator: (a: unknown) => boolean;
};

let dir: string;
let file: string;
let held: Map<string, () => void>;
let takenElsewhere: Set<string>;
const fired: string[] = [];

function make() {
  const gs = {
    register: (a: string, cb: () => void) => {
      if (takenElsewhere.has(a) || held.has(a)) return false;
      held.set(a, cb);
      return true;
    },
    unregister: (a: string) => void held.delete(a),
  };
  return kb.createKeybinds({
    globalShortcut: gs,
    fs,
    filePath: () => file,
    handlers: { hudToggle: () => fired.push("hud"), bodyPrev: () => fired.push("prev"), bodyNext: () => fired.push("next"), tabPrev: () => fired.push("tprev"), tabNext: () => fired.push("tnext"), noticesClear: () => fired.push("clear"), boxelCopyNext: () => fired.push("boxel"), boxelRun: () => fired.push("run"), boxelPrev: () => fired.push("bprev"), boxelNext: () => fired.push("bnext") },
  });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "edexo-kb-"));
  file = path.join(dir, "edexo-keybinds.json");
  held = new Map();
  takenElsewhere = new Set();
  fired.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("what counts as a bind", () => {
  it("takes one key, or modifiers and one key, up to three in all", () => {
    for (const a of ["F1", "Control+Alt+H", "Shift+F3", "num5", "Alt+Up", ""]) expect(kb.validAccelerator(a), a).toBe(true);
    for (const a of ["Control+Alt+Shift+H", "Control", "Control+Alt", "H+Control", "Control+Control+H", "F25", 3]) {
      expect(kb.validAccelerator(a), String(a)).toBe(false);
    }
  });
});

describe("registering them", () => {
  it("starts with Ctrl+Alt+H for the HUDs, F1 / F2 for the body tabs and F5 to clear the notices, and they fire", () => {
    const k = make();
    k.load();
    k.setGameFocused(true);
    expect(k.apply()).toEqual({
      hudToggle: "ok",
      bodyPrev: "ok",
      bodyNext: "ok",
      tabPrev: "ok",
      tabNext: "ok",
      noticesClear: "ok",
      boxelCopyNext: "ok",
      boxelRun: "ok",
      boxelPrev: "ok",
      boxelNext: "ok",
    });
    held.get("F1")!();
    held.get("F2")!();
    held.get("Control+Alt+H")!();
    held.get("F5")!();
    held.get("F6")!();
    held.get("F7")!();
    held.get("F8")!();
    held.get("F9")!();
    held.get("Shift+F1")!();
    held.get("Shift+F2")!();
    expect(fired).toEqual(["prev", "next", "hud", "clear", "boxel", "run", "bprev", "bnext", "tprev", "tnext"]);
  });

  it("says when another program has the key, or two actions share one", () => {
    takenElsewhere.add("F1");
    const k = make();
    k.load();
    k.setGameFocused(true);
    expect(k.apply().bodyPrev).toBe("taken");
    const r = k.set({ bodyNext: "F3", bodyPrev: "F3" });
    expect(r.status.bodyPrev).toBe("ok");
    expect(r.status.bodyNext).toBe("duplicate");
  });

  it("saves a change, puts a default back, and switches one off", () => {
    const k = make();
    k.load();
    k.apply();
    k.set({ hudToggle: "F9" });
    expect(JSON.parse(readFileSync(file, "utf8")).binds.hudToggle).toBe("F9");
    expect(held.has("Control+Alt+H")).toBe(false);
    expect(held.has("F9")).toBe(true);
    k.set({ hudToggle: null, bodyNext: "" });
    expect(k.bindFor("hudToggle")).toBe("Control+Alt+H");
    expect(k.get().status.bodyNext).toBe("off");
    expect(held.has("F2")).toBe(false);
  });

  it("ignores a bind it cannot use, and reads a saved file with a byte-order mark", () => {
    writeFileSync(file, "﻿" + JSON.stringify({ binds: { bodyPrev: "Shift+F5", bodyNext: "Control+Alt+Shift+X" } }), "utf8");
    const k = make();
    k.load();
    expect(k.bindFor("bodyPrev")).toBe("Shift+F5");
    expect(k.bindFor("bodyNext")).toBe("F2");
  });

  it("lets go of every key while a new one is recorded, and takes them back after", () => {
    const k = make();
    k.load();
    k.setGameFocused(true);
    k.pause(true);
    expect(held.size).toBe(0);
    // The game coming forward while a key is recorded does not take the keys back early.
    k.setGameFocused(false);
    k.setGameFocused(true);
    expect(held.size).toBe(0);
    k.pause(false);
    expect([...held.keys()].sort()).toEqual(["Control+Alt+H", "F1", "F2", "F5", "F6", "F7", "F8", "F9", "Shift+F1", "Shift+F2"]);
  });

  it("holds the body keys and F5 only while Elite is in front; the HUD key always (owner, 2026-10-05)", () => {
    const k = make();
    k.load();
    expect(k.apply()).toEqual({
      hudToggle: "ok",
      bodyPrev: "standby",
      bodyNext: "standby",
      tabPrev: "standby",
      tabNext: "standby",
      noticesClear: "standby",
      boxelCopyNext: "standby",
      boxelRun: "standby",
      boxelPrev: "standby",
      boxelNext: "standby",
    });
    expect([...held.keys()]).toEqual(["Control+Alt+H"]);
    k.setGameFocused(true);
    expect([...held.keys()].sort()).toEqual(["Control+Alt+H", "F1", "F2", "F5", "F6", "F7", "F8", "F9", "Shift+F1", "Shift+F2"]);
    k.setGameFocused(false);
    expect([...held.keys()]).toEqual(["Control+Alt+H"]);
    expect(k.get().actions.noticesClear!.gameOnly).toBe(true);
  });
});

describe("the launcher's sections", () => {
  it("puts every action in a listed group (owner, 2026-10-06)", () => {
    const g = make().get();
    for (const a of Object.values(g.actions)) expect(g.groups).toContain(a.group);
    expect(g.actions.tabNext!.group).toBe("Screen tabs");
  });
});
