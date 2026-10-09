/**
 * The server in a process of its own (owner, 2026-10-09: "I don't want to see the app in an
 * unresponsive state").
 *
 * The desktop app ran the server inside Electron's main process, the one that keeps every window
 * alive, so any pass of the server longer than half a second — the journal at start, the Boxels
 * table, the galaxy index, the first-discovery backlog — froze every window and Windows called the
 * app "Not Responding". Slicing each pass (sliced.ts) fixed them one at a time; the next heavy screen
 * hit the same wall. Here the server runs in an Electron utility process instead, started by
 * electron/serverChild.cjs: however long the server works, the windows keep drawing and wait for
 * their data like any web page.
 *
 * The windows already reach the server only over HTTP and its socket, so they do not change. What
 * crosses between the two processes is the dozen calls the main process made on the runtime, a few
 * events it listened for, and the HUD bridge (the server's HTTP routes opening overlay windows),
 * each as a plain message:
 *
 *   main -> child   { type: "start", mode, argv }       start the server
 *                   { type: "call", id, method, args }  a runtime method; replied to with "reply"
 *                   { type: "hudReply", id, result | error }
 *   child -> main   { type: "started", baseUrl, layoutPath, gameRunning, backupRunning, linuxTrayHost }
 *                   { type: "failed", message }         the server could not start
 *                   { type: "ready" }                   the journal is read (runtime.ready)
 *                   { type: "reply", id, result | error }
 *                   { type: "event", name, value }      boxelNext, gameRunning, backupRunning
 *                   { type: "hud", id, method, arg }    a HUD bridge call for main's windows
 *                   { type: "dialog", title, message }  a message box only main can show
 */
import { setHudBridge, type HudBridge } from "./hudBridge.js";
import { resolveHudLayoutPath, reapplySpeciesDataDirDiscoveryFromDisk } from "./paths.js";
import { startEdexoFromElectronMode, type EdexoRuntime } from "./edexoBootstrap.js";
import { linuxProbes } from "./linuxProbes.js";

type Msg = Record<string, unknown> & { type: string };

interface ParentPort {
  on(event: "message", cb: (e: { data: unknown }) => void): void;
  postMessage(msg: unknown): void;
}

/** The port to the main process, present only when started as an Electron utility process. */
function parentPort(): ParentPort | null {
  return (process as unknown as { parentPort?: ParentPort }).parentPort ?? null;
}

/** True in the utility process electron/serverChild.cjs starts. */
export function isServerChild(): boolean {
  return process.env.EDEXO_SERVER_CHILD === "1";
}

/** A message box for the main process to show (the utility process has no `dialog`). */
export function postDialogToMain(title: string, message: string): boolean {
  const port = parentPort();
  if (!port) return false;
  port.postMessage({ type: "dialog", title, message });
  return true;
}

/** The runtime methods main may call. Anything else is refused, not looked up by name. */
const CALLS = new Set([
  "uiCommand",
  "clearNotices",
  "boxelCopyNext",
  "boxelStep",
  "boxelRunToggle",
  "stagedUpdate",
  "flushNow",
  "whenBackupDone",
  "openMainAppInBrowser",
]);

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function runServerChild(): void {
  const port = parentPort();
  if (!port) {
    console.error("[edexo-compare] EDEXO_SERVER_CHILD is set, but this is not an Electron utility process.");
    process.exit(1);
  }
  const post = (m: Msg) => port.postMessage(m);
  let runtime: EdexoRuntime | null = null;
  let shuttingDown = false;

  // HUD bridge calls go to main's windows and come back as hudReply.
  let hudSeq = 0;
  const hudWaiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const hudCall =
    (method: keyof HudBridge) =>
    (arg?: unknown): Promise<never> =>
      new Promise((resolve, reject) => {
        const id = ++hudSeq;
        hudWaiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
        post({ type: "hud", id, method, arg: arg ?? null });
      });
  const bridge: HudBridge = {
    state: hudCall("state"),
    open: hudCall("open"),
    toggle: hudCall("toggle"),
    set: hudCall("set"),
    close: hudCall("close"),
    getLayout: hudCall("getLayout"),
    setLayout: hudCall("setLayout"),
    toggleVisibility: hudCall("toggleVisibility"),
  };

  async function start(mode: "server" | "client", argv: string[]): Promise<void> {
    try {
      // Before the server starts: it works by setting EDEXO_SPECIES_DATA_DIR (see main.cjs's note).
      reapplySpeciesDataDirDiscoveryFromDisk();
      runtime = await startEdexoFromElectronMode(mode, argv);
    } catch (e) {
      post({ type: "failed", message: errorText(e) });
      return;
    }
    setHudBridge(bridge);
    let trayHost: unknown = null;
    if (process.platform === "linux") {
      try {
        trayHost = linuxProbes.trayHost();
      } catch {
        trayHost = null;
      }
    }
    post({
      type: "started",
      baseUrl: runtime.getLocalBaseUrl(),
      layoutPath: resolveHudLayoutPath(),
      gameRunning: runtime.gameRunning(),
      backupRunning: runtime.backupRunning(),
      linuxTrayHost: trayHost,
    });
    void runtime.ready.then(
      () => post({ type: "ready" }),
      () => {},
    );
    runtime.onBoxelNext((name) => post({ type: "event", name: "boxelNext", value: name }));
    runtime.onGameRunning((running) => post({ type: "event", name: "gameRunning", value: running }));
    // Main asks "is a backup running?" inside its quit handlers and cannot wait for an answer there,
    // so the answer is sent ahead whenever it changes.
    let backup = runtime.backupRunning();
    setInterval(() => {
      const now = runtime?.backupRunning() ?? false;
      if (now !== backup) {
        backup = now;
        post({ type: "event", name: "backupRunning", value: now });
      }
    }, 250).unref();
  }

  async function call(id: number, method: string, args: unknown[]): Promise<void> {
    try {
      if (!runtime) throw new Error("Server not started.");
      if (!CALLS.has(method)) throw new Error(`Unknown call: ${method}`);
      const fn = (runtime as unknown as Record<string, (...a: unknown[]) => unknown>)[method]!;
      const result = await fn(...args);
      post({ type: "reply", id, result: result === undefined ? null : result });
    } catch (e) {
      post({ type: "reply", id, error: errorText(e) });
    }
  }

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await runtime?.shutdown();
    } catch {
      /* exiting either way */
    }
    process.exit(0);
  }

  port.on("message", (e) => {
    const m = (e?.data ?? {}) as Msg;
    if (m.type === "start") void start(m.mode === "client" ? "client" : "server", Array.isArray(m.argv) ? (m.argv as string[]) : []);
    else if (m.type === "call") void call(Number(m.id), String(m.method), Array.isArray(m.args) ? (m.args as unknown[]) : []);
    else if (m.type === "hudReply") {
      const w = hudWaiting.get(Number(m.id));
      if (!w) return;
      hudWaiting.delete(Number(m.id));
      if (typeof m.error === "string") w.reject(new Error(m.error));
      else w.resolve(m.result);
    } else if (m.type === "shutdown") void shutdown();
  });
}
