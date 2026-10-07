/**
 * Tab view's windows (electron/tabWindows.cjs; owner, 2026-10-06): a tab dragged out opens a window of
 * its own, a tab dropped on another window moves there, opening a screen another window holds brings
 * that window forward, and the detached windows come back with the app window.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createTabWindows } = require("../electron/tabWindows.cjs") as {
  createTabWindows: (d: unknown) => {
    attachMain(w: unknown): void;
    freeze(): void;
    restore(): void;
    sendToMain(cmd: unknown): void;
  };
};

type Handler = (ev: { sender: FakeContents }, arg?: unknown) => unknown;

class FakeContents {
  sent: [string, unknown][] = [];
  url = "";
  send(ch: string, v: unknown) {
    this.sent.push([ch, v]);
  }
  setWindowOpenHandler() {}
}
class FakeWindow {
  static made: FakeWindow[] = [];
  webContents = new FakeContents();
  events = new Map<string, (() => void)[]>();
  destroyed = false;
  focused = false;
  constructor(public opts: Record<string, unknown>) {
    FakeWindow.made.push(this);
  }
  on(ev: string, cb: () => void) {
    this.events.set(ev, [...(this.events.get(ev) ?? []), cb]);
  }
  emit(ev: string) {
    for (const cb of this.events.get(ev) ?? []) cb();
  }
  isDestroyed() {
    return this.destroyed;
  }
  isMinimized() {
    return false;
  }
  restore() {}
  show() {}
  focus() {
    this.focused = true;
  }
  maximize() {}
  loadURL(u: string) {
    this.webContents.url = u;
    return Promise.resolve();
  }
  close() {
    this.emit("close");
    this.destroyed = true;
    this.emit("closed");
  }
}

function setup(states: Record<string, unknown> = {}) {
  FakeWindow.made = [];
  const on = new Map<string, Handler>();
  const handle = new Map<string, Handler>();
  let written: Record<string, unknown> = { ...states };
  const tw = createTabWindows({
    BrowserWindow: FakeWindow,
    ipcMain: {
      on: (c: string, h: Handler) => on.set(c, h),
      handle: (c: string, h: Handler) => handle.set(c, h),
    },
    baseUrl: () => "http://127.0.0.1:7111",
    preloadPath: undefined,
    partition: "persist:app-window",
    icon: undefined,
    readWindowStates: () => ({ ...written }),
    readWindowState: () => null,
    writeWindowStates: (all: Record<string, unknown>) => (written = all),
    trackWindowState: () => {},
    enableZoom: () => {},
    onExternalLink: () => {},
  });
  const main = new FakeWindow({});
  tw.attachMain(main);
  return { tw, main, on, handle, states: () => written };
}

describe("tab windows", () => {
  it("drags a tab out into a new window, which the app window lets go of and remembers", async () => {
    const { main, handle, states } = setup();
    expect(
      await handle.get("edexo:tab-detach")!({ sender: main.webContents }, { kind: "boxels", x: 900, y: 300 }),
    ).toBe(true);
    const win = FakeWindow.made[1]!;
    expect(win.webContents.url).toMatch(/\?tabwin=w[0-9a-z]+&open=boxels$/);
    expect(win.opts).toMatchObject({ x: 780, y: 284 });
    expect(main.webContents.sent).toContainEqual(["edexo:tab-remove", "boxels"]);
    expect(states().tabWindows).toEqual([new URL(win.webContents.url).searchParams.get("tabwin")]);
  });

  it("brings the window holding a tab forward instead of opening it twice", async () => {
    const { main, on, handle } = setup();
    await handle.get("edexo:tab-detach")!({ sender: main.webContents }, { kind: "galaxy", x: 0, y: 0 });
    const win = FakeWindow.made[1]!;
    on.get("edexo:tabs-report")!({ sender: win.webContents }, ["galaxy"]);
    const key = new URL(win.webContents.url).searchParams.get("tabwin")!;
    expect(main.webContents.sent.at(-1)).toEqual(["edexo:tab-registry", { [key]: ["galaxy"] }]);
    expect(await handle.get("edexo:tab-focus")!({ sender: main.webContents }, "galaxy")).toBe(true);
    expect(win.focused).toBe(true);
    expect(win.webContents.sent).toContainEqual(["edexo:tab-activate", "galaxy"]);
    expect(await handle.get("edexo:tab-focus")!({ sender: main.webContents }, "stats")).toBe(false);
  });

  it("a tab dropped on another window's strip leaves the window it came from; an empty window closes", async () => {
    const { main, on, handle, states } = setup();
    await handle.get("edexo:tab-detach")!({ sender: main.webContents }, { kind: "poi", x: 0, y: 0 });
    const win = FakeWindow.made[1]!;
    const key = new URL(win.webContents.url).searchParams.get("tabwin")!;
    on.get("edexo:tab-moved")!({ sender: main.webContents }, { kind: "poi", from: key });
    expect(win.webContents.sent).toContainEqual(["edexo:tab-remove", "poi"]);
    on.get("edexo:tab-window-empty")!({ sender: win.webContents });
    expect(win.destroyed).toBe(true);
    expect(states().tabWindows).toEqual([]);
  });

  it("closing the app window closes its detached windows but keeps them listed; they come back", async () => {
    const first = setup();
    await first.handle.get("edexo:tab-detach")!(
      { sender: first.main.webContents },
      { kind: "stats", x: 0, y: 0 },
    );
    const key = new URL(FakeWindow.made[1]!.webContents.url).searchParams.get("tabwin")!;
    first.main.close();
    expect(FakeWindow.made[1]!.destroyed).toBe(true);
    expect(first.states().tabWindows).toEqual([key]);
    const again = setup({ tabWindows: [key] });
    again.tw.restore();
    expect(FakeWindow.made[1]!.webContents.url).toBe(`http://127.0.0.1:7111/?tabwin=${key}`);
  });

  // Key binds reach the app window's page over IPC, not through the server's socket (owner, 2026-10-07).
  it("hands a key bind's command to the app window only", async () => {
    const { tw, main, handle } = setup();
    await handle.get("edexo:tab-detach")!({ sender: main.webContents }, { kind: "boxels", x: 900, y: 300 });
    const other = FakeWindow.made.at(-1)!;
    tw.sendToMain({ cmd: "screenTab", dir: 1 });
    expect(main.webContents.sent).toContainEqual(["edexo:ui-command", { cmd: "screenTab", dir: 1 }]);
    expect(other.webContents.sent.some(([c]) => c === "edexo:ui-command")).toBe(false);
  });
});
