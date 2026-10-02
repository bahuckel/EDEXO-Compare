"use strict";

/*
  Key binds (owner, 2026-10-02): global keys that work while Elite has the focus, set in the launcher.

  "Idea behind it, the user won't have to alt tab to the browser window in order to switch bodies, or
  if they have a single key stroke they want to bind the HUD to, they can."

  Three actions: show / hide the HUDs (it was Ctrl+Alt+H, fixed), previous and next body tab (F1 and F2
  by default). A bind is an Electron accelerator of up to three keys — modifiers and one key, or one key
  on its own — or "" for none. They are global: Windows hands the key to us and not to the game, so a
  key the commander uses in Elite should not be bound here; the launcher says so beside the field.

  Saved as edexo-keybinds.json beside the HUD layout (the user data folder).
*/

const ACTIONS = {
  hudToggle: { default: "Control+Alt+H", label: "Show / hide the HUDs" },
  bodyPrev: { default: "F1", label: "Previous body tab" },
  bodyNext: { default: "F2", label: "Next body tab" },
};

const MODIFIERS = new Set(["Control", "Ctrl", "CommandOrControl", "CmdOrCtrl", "Alt", "Shift", "Super", "Meta"]);
const KEY = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc|Plus|num[0-9]|numdec|numadd|numsub|nummult|numdiv|[`\-=[\]\\;',./])$/;

/** An accelerator string we accept: 1-3 parts, modifiers first, exactly one non-modifier key last. */
function validAccelerator(acc) {
  if (typeof acc !== "string") return false;
  if (acc === "") return true;
  const parts = acc.split("+");
  if (parts.length < 1 || parts.length > 3) return false;
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (!KEY.test(key)) return false;
  if (mods.some((m) => !MODIFIERS.has(m))) return false;
  return new Set(mods).size === mods.length;
}

/**
 * @param {{
 *   globalShortcut: { register: (a: string, cb: () => void) => boolean, unregister: (a: string) => void },
 *   fs: typeof import("fs"),
 *   filePath: () => string,
 *   handlers: Record<string, () => void>,
 * }} deps
 */
function createKeybinds(deps) {
  let binds = Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, v.default]));
  /** What each action's bind did when applied: ok, taken (another program has it), duplicate, invalid, off. */
  let status = {};
  let registered = [];

  function load() {
    try {
      const raw = deps.fs.readFileSync(deps.filePath(), "utf8");
      // A byte-order mark (Notepad writes one) would make JSON.parse throw and read as "no binds saved".
      const j = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
      const saved = j && typeof j === "object" && j.binds && typeof j.binds === "object" ? j.binds : {};
      for (const k of Object.keys(ACTIONS)) {
        if (typeof saved[k] === "string" && validAccelerator(saved[k])) binds[k] = saved[k];
      }
    } catch {
      /* first run, or unreadable: the defaults */
    }
  }

  function save() {
    try {
      const p = deps.filePath();
      const tmp = `${p}.tmp`;
      deps.fs.writeFileSync(tmp, JSON.stringify({ binds }, null, 2), "utf8");
      deps.fs.renameSync(tmp, p);
    } catch {
      /* the binds still work this session */
    }
  }

  function apply() {
    for (const acc of registered) {
      try {
        deps.globalShortcut.unregister(acc);
      } catch {
        /* ignore */
      }
    }
    registered = [];
    status = {};
    const seen = new Set();
    for (const k of Object.keys(ACTIONS)) {
      const acc = binds[k];
      if (!acc) {
        status[k] = "off";
        continue;
      }
      if (!validAccelerator(acc)) {
        status[k] = "invalid";
        continue;
      }
      if (seen.has(acc.toLowerCase())) {
        status[k] = "duplicate";
        continue;
      }
      seen.add(acc.toLowerCase());
      let ok = false;
      try {
        ok = deps.globalShortcut.register(acc, () => {
          try {
            deps.handlers[k]?.();
          } catch {
            /* a handler failing must not take the key with it */
          }
        });
      } catch {
        ok = false;
      }
      status[k] = ok ? "ok" : "taken";
      if (ok) registered.push(acc);
    }
    return status;
  }

  /** Replace some binds ("" turns one off, null puts the default back), save, and register again. */
  function set(next) {
    if (next && typeof next === "object") {
      for (const k of Object.keys(ACTIONS)) {
        if (!(k in next)) continue;
        const v = next[k];
        if (v === null) binds[k] = ACTIONS[k].default;
        else if (typeof v === "string" && validAccelerator(v)) binds[k] = v;
      }
    }
    save();
    apply();
    return get();
  }

  function get() {
    return {
      binds: { ...binds },
      status: { ...status },
      actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, { label: v.label, default: v.default }])),
    };
  }

  /*
    While the launcher records a new bind, the current ones step aside: a registered global key never
    reaches any window, so pressing F1 to keep F1 would otherwise record nothing.
  */
  function pause(on) {
    if (on) {
      for (const acc of registered) {
        try {
          deps.globalShortcut.unregister(acc);
        } catch {
          /* ignore */
        }
      }
      registered = [];
      return get();
    }
    apply();
    return get();
  }

  return { load, apply, set, get, pause, bindFor: (k) => binds[k] ?? "", statusFor: (k) => status[k] ?? "off" };
}

module.exports = { createKeybinds, validAccelerator, KEYBIND_ACTIONS: ACTIONS };
