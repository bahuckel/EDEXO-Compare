/**
 * What may happen inside the app's windows (combined plan 1.7): outside pages go to the browser,
 * the app's own pages may open, navigation away is refused, and only the permissions the pages use
 * are granted.
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { guardWindowNavigation, restrictPermissions } = require("../electron/windowGuards.cjs") as {
  guardWindowNavigation: (win: unknown, getBase: () => string | null, shell: unknown) => void;
  restrictPermissions: (ses: unknown) => void;
};

function fakeWindow() {
  let openHandler: ((d: { url: string }) => { action: string }) | null = null;
  const listeners: Record<string, (e: { preventDefault: () => void }, url: string) => void> = {};
  return {
    win: {
      webContents: {
        setWindowOpenHandler: (h: typeof openHandler) => (openHandler = h),
        on: (ev: string, fn: (e: { preventDefault: () => void }, url: string) => void) => (listeners[ev] = fn),
      },
    },
    open: (url: string) => openHandler!({ url }).action,
    navigate: (url: string) => {
      let prevented = false;
      listeners["will-navigate"]!({ preventDefault: () => (prevented = true) }, url);
      return prevented;
    },
  };
}

describe("window guards", () => {
  it("opens outside pages in the browser and keeps the app's own", () => {
    const external: string[] = [];
    const shell = { openExternal: async (u: string) => void external.push(u) };
    const w = fakeWindow();
    guardWindowNavigation(w.win, () => "http://127.0.0.1:7111", shell);
    expect(w.open("https://github.com/bahuckel/EDEXO-Compare/releases")).toBe("deny");
    expect(w.open("http://127.0.0.1:7111/?screen=triage")).toBe("allow");
    expect(w.open("http://127.0.0.1:71119/")).toBe("deny"); // not a prefix trick
    expect(w.open("file:///C:/Windows/system32/calc.exe")).toBe("deny");
    expect(w.navigate("https://evil.example/")).toBe(true);
    expect(w.navigate("http://127.0.0.1:7111/launcher.html")).toBe(false);
    expect(external).toEqual([
      "https://github.com/bahuckel/EDEXO-Compare/releases",
      "http://127.0.0.1:71119/",
      "https://evil.example/",
    ]);
  });

  it("grants the clipboard, fullscreen and pointer lock, and nothing else", () => {
    let handler: ((wc: unknown, p: string, cb: (ok: boolean) => void) => void) | null = null;
    restrictPermissions({ setPermissionRequestHandler: (h: typeof handler) => (handler = h) });
    const ask = (p: string) => {
      let ok: boolean | null = null;
      handler!(null, p, (v) => (ok = v));
      return ok;
    };
    expect(["clipboard-sanitized-write", "fullscreen", "pointerLock"].map(ask)).toEqual([true, true, true]);
    expect(["media", "geolocation", "notifications", "midi", "openExternal"].map(ask)).toEqual([false, false, false, false, false]);
  });
});
