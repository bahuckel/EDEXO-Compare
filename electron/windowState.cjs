/**
 * Window positions and zoom for the launcher and the app window. Split out of main.cjs (code review D,
 * 2026-09-28). The settings folder is main.cjs's to decide, so it is passed in.
 */
const { screen } = require("electron");
const path = require("path");
const fs = require("fs");
const { GALAXY_MIN } = require("./childWindows.cjs");

/** The smallest a saved window may come back; a smaller saved size is ignored. */
const WINDOW_MIN = { launcher: { w: 380, h: 420 }, app: { w: 640, h: 420 }, galaxy: GALAXY_MIN };

/** @param {() => string} stateDir the folder window-state.json lives in */
function createWindowState(stateDir) {
  /*
    Where the windows were (owner, 2026-09-26: "remember their last position… another monitor…
    resolution, zoom level").

    The launcher and the app window each keep their size, position and maximised state in
    `window-state.json` beside the HUD layout (user data, so a rebuilt exe keeps it). They are saved as
    they move — not only on close, which a crash or a killed process never reaches — and restored only
    while the rectangle still lands on a connected screen, so an unplugged monitor cannot strand a
    window off-screen. Positions are Electron's device-independent pixels, which is what makes the
    same numbers right on a monitor with a different scaling.

    Zoom is Chromium's: it remembers a zoom level per site and per session across restarts. That is
    also why the app window has a session of its own (`persist:app-window`): the launcher, the HUDs
    and the app are the same site, and in one session zooming the app zoomed the launcher too.
  */

  function windowStatePath() {
    return path.join(stateDir(), "window-state.json");
  }

  function readWindowStates() {
    try {
      const all = JSON.parse(fs.readFileSync(windowStatePath(), "utf8"));
      return all && typeof all === "object" ? all : {};
    } catch {
      return {};
    }
  }

  /** Saved bounds for one window, or null when there are none or they no longer land on a screen. */
  function readWindowState(name) {
    let b = readWindowStates()[name];
    if (!b && name === "app") {
      // Test builds of 2026-09-26 kept the app window alone in app-window.json.
      try {
        b = JSON.parse(fs.readFileSync(path.join(stateDir(), "app-window.json"), "utf8"));
      } catch {
        b = null;
      }
    }
    if (!b || ![b.x, b.y, b.width, b.height].every((n) => Number.isFinite(n))) return null;
    const min = WINDOW_MIN[name] ?? { w: 320, h: 240 };
    if (b.width < min.w || b.height < min.h) return null;
    const onScreen = screen
      .getAllDisplays()
      .some(
        (d) =>
          b.x < d.workArea.x + d.workArea.width - 80 &&
          b.x + b.width > d.workArea.x + 80 &&
          b.y >= d.workArea.y - 20 &&
          b.y < d.workArea.y + d.workArea.height - 80,
      );
    return onScreen
      ? { x: b.x, y: b.y, width: b.width, height: b.height, maximized: b.maximized === true }
      : null;
  }

  function saveWindowState(name, win) {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    try {
      const maximized = win.isMaximized();
      const b = maximized ? win.getNormalBounds() : win.getBounds();
      const all = readWindowStates();
      all[name] = { ...b, maximized };
      fs.mkdirSync(path.dirname(windowStatePath()), { recursive: true });
      fs.writeFileSync(windowStatePath(), JSON.stringify(all, null, 2), "utf8");
    } catch {
      /* the next open uses the default size */
    }
  }

  /** Keep a window's state on disk as it moves; half a second after the last move, and on close. */
  function trackWindowState(name, win) {
    let t = null;
    const soon = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        saveWindowState(name, win);
      }, 500);
    };
    for (const ev of ["resize", "move", "maximize", "unmaximize"]) win.on(ev, soon);
    win.on("close", () => {
      if (t) clearTimeout(t);
      saveWindowState(name, win);
    });
  }
  return { readWindowStates, readWindowState, saveWindowState, trackWindowState, windowStatePath };
}

/*
  Zoom with Ctrl + wheel and Ctrl +/−/0 (owner, 2026-09-26: "zoom does not work").

  Electron reports a Ctrl + wheel as `zoom-changed` and leaves it there — nothing zooms unless the
  app applies it — and with the menu bar hidden the keyboard shortcuts have no menu to come from.
  Chromium then keeps the level per site and per session across restarts, which is what makes it
  "remembered": the launcher (default session) and the app window (`persist:app-window`) each keep
  their own.
*/
const ZOOM_STEP = 0.5;
const ZOOM_MIN = -3;
const ZOOM_MAX = 5;

function enableZoom(win) {
  const wc = win.webContents;
  const step = (dir) => {
    const next = dir === 0 ? 0 : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, wc.getZoomLevel() + dir * ZOOM_STEP));
    wc.setZoomLevel(next);
  };
  wc.on("zoom-changed", (_e, direction) => step(direction === "in" ? 1 : -1));
  wc.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt) return;
    const k = input.key;
    if (k === "+" || k === "=" || input.code === "NumpadAdd") step(1);
    else if (k === "-" || k === "_" || input.code === "NumpadSubtract") step(-1);
    else if (k === "0" || input.code === "Numpad0") step(0);
    else return;
    e.preventDefault();
  });
}

module.exports = { WINDOW_MIN, createWindowState, enableZoom };
