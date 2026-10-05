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
    get: () => { binds: Record<string, string>; status: Record<string, string> };
    pause: (on: boolean) => unknown;
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
    handlers: { hudToggle: () => fired.push("hud"), bodyPrev: () => fired.push("prev"), bodyNext: () => fired.push("next"), noticesClear: () => fired.push("clear") },
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
    expect(k.apply()).toEqual({ hudToggle: "ok", bodyPrev: "ok", bodyNext: "ok", noticesClear: "ok" });
    held.get("F1")!();
    held.get("F2")!();
    held.get("Control+Alt+H")!();
    held.get("F5")!();
    expect(fired).toEqual(["prev", "next", "hud", "clear"]);
  });

  it("says when another program has the key, or two actions share one", () => {
    takenElsewhere.add("F1");
    const k = make();
    k.load();
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
    k.apply();
    k.pause(true);
    expect(held.size).toBe(0);
    k.pause(false);
    expect([...held.keys()].sort()).toEqual(["Control+Alt+H", "F1", "F2", "F5"]);
  });
});
