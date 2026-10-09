"use strict";

/**
 * The server in a utility process of its own (owner, 2026-10-09: "I don't want to see the app in an
 * unresponsive state"). See src/server/serverChild.ts for the why and the message list.
 *
 * This side starts it and hands main.cjs a runtime with the same method names the in-process one had:
 * the answers main needs at once (the address, whether Elite runs, whether a backup is being written)
 * are kept here as the server reports them; everything else is a message and a reply. However long
 * the server works, this process — the one every window needs — only ever waits for a message.
 */

const SHUTDOWN_WAIT_MS = 8000;

/**
 * @param {object} o
 * @param {typeof import("electron").utilityProcess} o.utilityProcess
 * @param {string} o.bundle  the server bundle (app.cjs)
 * @param {"server"|"client"} o.mode
 * @param {string[]} o.argv
 * @param {(method: string, arg: unknown) => unknown} o.onHud  a HUD bridge call for main's windows
 * @param {(title: string, message: string) => void} o.onDialog
 * @param {(code: number) => void} o.onUnexpectedExit  the server process ended while the app runs
 * @returns {Promise<object>} the runtime, once the server listens
 */
function startServerChild(o) {
  const child = o.utilityProcess.fork(o.bundle, [], {
    serviceName: "ED Exo Compare server",
    env: { ...process.env, EDEXO_SERVER_CHILD: "1" },
    stdio: "inherit",
  });

  let seq = 0;
  const waiting = new Map();
  const listeners = { boxelNext: new Set(), gameRunning: new Set() };
  const state = { baseUrl: null, layoutPath: null, gameRunning: null, backupRunning: false, linuxTrayHost: null, exited: false };
  let resolveReady;
  let rejectReady;
  const ready = new Promise((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  let stopping = false;

  const call = (method, ...args) =>
    new Promise((resolve, reject) => {
      if (state.exited) return reject(new Error("The server is not running."));
      const id = ++seq;
      waiting.set(id, { resolve, reject });
      child.postMessage({ type: "call", id, method, args });
    });

  const runtime = {
    ready,
    getLocalBaseUrl: () => state.baseUrl,
    layoutPath: () => state.layoutPath,
    linuxTrayHost: () => state.linuxTrayHost,
    gameRunning: () => state.gameRunning,
    backupRunning: () => state.backupRunning,
    onGameRunning: (cb) => {
      listeners.gameRunning.add(cb);
      return () => listeners.gameRunning.delete(cb);
    },
    onBoxelNext: (cb) => {
      listeners.boxelNext.add(cb);
      return () => listeners.boxelNext.delete(cb);
    },
    // Fire and forget, as before (main never used their answers except to log).
    uiCommand: (cmd) => void call("uiCommand", cmd).catch(() => {}),
    clearNotices: () => call("clearNotices"),
    boxelCopyNext: () => call("boxelCopyNext"),
    boxelStep: (dir) => call("boxelStep", dir),
    boxelRunToggle: () => call("boxelRunToggle"),
    openMainAppInBrowser: () => void call("openMainAppInBrowser").catch(() => {}),
    stagedUpdate: () => call("stagedUpdate"),
    whenBackupDone: () => call("whenBackupDone"),
    /*
      Windows logoff: there is no time to wait for an answer, so this only asks. The server writes
      the buffered foot catalog when the message lands, which is the same best effort as before.
    */
    flushNow: () => void call("flushNow").catch(() => {}),
    /** Ask the server to stop, and end its process if it has not within a few seconds. */
    shutdown: () =>
      new Promise((resolve) => {
        if (state.exited) return resolve();
        stopping = true;
        const t = setTimeout(() => {
          try {
            child.kill();
          } catch {
            /* already gone */
          }
          resolve();
        }, SHUTDOWN_WAIT_MS);
        child.once("exit", () => {
          clearTimeout(t);
          resolve();
        });
        child.postMessage({ type: "shutdown" });
      }),
  };

  return new Promise((resolveStart, rejectStart) => {
    let started = false;
    child.on("message", async (m) => {
      if (!m || typeof m !== "object") return;
      if (m.type === "started") {
        started = true;
        Object.assign(state, {
          baseUrl: m.baseUrl,
          layoutPath: m.layoutPath,
          gameRunning: m.gameRunning,
          backupRunning: !!m.backupRunning,
          linuxTrayHost: m.linuxTrayHost ?? null,
        });
        resolveStart(runtime);
      } else if (m.type === "failed") {
        rejectStart(new Error(String(m.message)));
      } else if (m.type === "ready") {
        resolveReady();
      } else if (m.type === "reply") {
        const w = waiting.get(m.id);
        if (!w) return;
        waiting.delete(m.id);
        if (typeof m.error === "string") w.reject(new Error(m.error));
        else w.resolve(m.result);
      } else if (m.type === "event") {
        if (m.name === "backupRunning") state.backupRunning = !!m.value;
        if (m.name === "gameRunning") {
          state.gameRunning = m.value;
          for (const cb of listeners.gameRunning) cb(m.value);
        }
        if (m.name === "boxelNext") for (const cb of listeners.boxelNext) cb(m.value);
      } else if (m.type === "hud") {
        try {
          const result = await o.onHud(m.method, m.arg);
          child.postMessage({ type: "hudReply", id: m.id, result: result === undefined ? null : result });
        } catch (e) {
          child.postMessage({ type: "hudReply", id: m.id, error: e instanceof Error ? e.message : String(e) });
        }
      } else if (m.type === "dialog") {
        o.onDialog(String(m.title), String(m.message));
      }
    });
    child.on("exit", (code) => {
      state.exited = true;
      for (const w of waiting.values()) w.reject(new Error("The server stopped."));
      waiting.clear();
      if (!started) rejectStart(new Error(`The server process ended before it started (exit ${code}).`));
      rejectReady(new Error("The server stopped."));
      if (started && !stopping) o.onUnexpectedExit(code);
    });
    ready.catch(() => {});
    child.postMessage({ type: "start", mode: o.mode, argv: o.argv });
  });
}

module.exports = { startServerChild };
