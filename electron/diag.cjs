"use strict";

/**
 * Diagnostic build only — never in a public release (owner, 2026-09-25).
 *
 * `npm run dist:win:diag` packs this file; `npm run dist:win` leaves it out (see the `files` list in
 * `electron-builder.cjs`), and `main.cjs` treats its absence as "no diagnostics". It exists to catch
 * one report: after a long break, the launcher goes "Not Responding" for about ten seconds once
 * loading has finished — and it could not be reproduced on a warm machine.
 *
 * What it records, into `<user data>\diag\`:
 *
 *  - `stalls-<time>.log` — every stretch the main process was blocked for half a second or more
 *    (the server runs on that thread, so this is what freezes the window), when each window stops
 *    or starts responding, and a few milestones (server started, launcher loaded).
 *  - `boot-<time>.cpuprofile` — a CPU profile of the first five minutes, kept only when a stall of
 *    two seconds or more happened or a window went unresponsive. Open it in Chrome DevTools
 *    (Performance → Load profile) or hand it back to be read.
 *
 * Nothing leaves the machine.
 */
const fs = require("fs");
const path = require("path");
const inspector = require("inspector");

const TICK_MS = 100;
const LOG_STALL_MS = 500;
const KEEP_PROFILE_STALL_MS = 2000;
const PROFILE_FOR_MS = 5 * 60 * 1000;

function start({ outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(outDir, `stalls-${stamp}.log`);
  const t0 = performance.now();
  const log = (msg) => {
    const up = ((performance.now() - t0) / 1000).toFixed(1);
    try {
      fs.appendFileSync(logPath, `${new Date().toISOString()}  +${up}s  ${msg}\n`);
    } catch {
      /* diagnostics never break the app */
    }
  };
  log(`diagnostics on — pid ${process.pid}, electron ${process.versions.electron}`);

  let worstStall = 0;
  let windowHung = false;
  let last = performance.now();
  const ticker = setInterval(() => {
    const now = performance.now();
    const blocked = now - last - TICK_MS;
    last = now;
    if (blocked >= LOG_STALL_MS) {
      worstStall = Math.max(worstStall, blocked);
      log(`main process blocked ${Math.round(blocked)} ms`);
    }
  }, TICK_MS);
  ticker.unref?.();

  const session = new inspector.Session();
  let profiling = false;
  try {
    session.connect();
    session.post("Profiler.enable");
    session.post("Profiler.setSamplingInterval", { interval: 1000 });
    session.post("Profiler.start");
    profiling = true;
  } catch (e) {
    log(`cpu profiler unavailable: ${e && e.message ? e.message : e}`);
  }

  let stopped = false;
  const stop = (why) => {
    if (stopped) return;
    stopped = true;
    if (!profiling) return;
    session.post("Profiler.stop", (err, res) => {
      const keep = worstStall >= KEEP_PROFILE_STALL_MS || windowHung;
      if (!err && res && res.profile && keep) {
        const file = path.join(outDir, `boot-${stamp}.cpuprofile`);
        try {
          fs.writeFileSync(file, JSON.stringify(res.profile));
          log(`cpu profile written (${why}): ${file}`);
        } catch (e) {
          log(`cpu profile could not be written: ${e && e.message ? e.message : e}`);
        }
      } else {
        log(`cpu profile discarded (${why}; worst stall ${Math.round(worstStall)} ms)`);
      }
      try {
        session.disconnect();
      } catch {
        /* ignore */
      }
    });
  };
  setTimeout(() => stop("5 minutes"), PROFILE_FOR_MS).unref?.();

  return {
    mark: log,
    stop,
    watchWindow(win, name) {
      win.on("unresponsive", () => {
        windowHung = true;
        log(`${name} window unresponsive`);
      });
      win.on("responsive", () => log(`${name} window responsive again`));
      win.webContents.on("did-finish-load", () => log(`${name} page loaded`));
      win.webContents.on("render-process-gone", (_e, d) => log(`${name} renderer gone: ${d && d.reason}`));
    },
  };
}

module.exports = { start };
