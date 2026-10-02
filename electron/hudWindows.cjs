"use strict";

/*
  The HUD overlay windows (split out of main.cjs, owner 2026-09-28): the stack in its corner, the
  layout file, hide and show (the hotkey), keeping them above the game, putting them back when the
  display changes, opening / navigating / closing one, and the pages' own height reports.

  All of the state lives inside `createHudWindows`. main.cjs passes in what it owns — Electron's
  `app`, `BrowserWindow` and `screen`, the running server, the diagnostics hook, the preload path —
  and wires the IPC channels and the HTTP bridge to the object this returns. Passing Electron in is
  also what lets tests/hudWindows.test.ts drive the stack with fakes.
*/
const path = require("path");
const fs = require("fs");

const MAX_HUD_OVERLAYS = 8; // was 3; the owner wants every HUD selectable at once
const HUD_STACK_GAP = 6;
/** Ctrl+Alt+H hides and shows every HUD window at once (menus, screenshots), checked free by the owner. */
const HUD_TOGGLE_SHORTCUT = "Control+Alt+H";
/**
 * How often the visible HUDs re-assert the top of the z-order: a safety net. The main raise is the
 * moment the game comes to the front ({@link raiseVisible}, from the foreground watcher); every 4 s
 * was eight SetWindowPos calls on the game's thread, around the clock (plan 2.1, Fable C10).
 */
const HUD_KEEP_ON_TOP_MS = 15_000;

/*
  An overlay window is transparent, so any height it has beyond its content reads as empty space
  between it and the next one — the owner's "spacing between them is too large" was mostly windows
  bigger than what they were drawing. They ask to be resized to their own content instead, which
  also fixes the opposite failure: the distance HUD grew a radar and was being cut off by a window
  sized before the radar existed.
*/
const HUD_MIN_HEIGHT = 90;
/*
  A sanity cap on what a page may ask for; the real one is the screen it is on (relayout). It was 900,
  which cut the merged HUD at a large scale on a 4K screen with no sign of it (plan 2.1, Fable C12).
*/
const HUD_MAX_HEIGHT = 2400;

/*
  One reading of an overlay request, shared by the IPC handlers and the HTTP bridge.

  Both doors take the same `{ pathname, width, height }` and must agree on every default, so they
  call these rather than each repeating the coercion. Two copies of a default is how one of them
  quietly stops matching the other.
*/
const HUD_DEFAULT_PATH = "/distance-overlay.html";
const HUD_DEFAULT_WIDTH = 404;
const HUD_DEFAULT_HEIGHT = 330;

function hudPathFrom(opts, fallback = HUD_DEFAULT_PATH) {
  const o = opts && typeof opts === "object" ? opts : {};
  const raw = typeof o.pathname === "string" && o.pathname.trim() ? o.pathname.trim() : fallback;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

/*
  Bounded (combined plan 1.7): these come from the launcher and, with LAN access on, from paired
  devices through /api/hud/overlay/*, and the width is saved in hud-layout.json. An absurd one made
  every HUD that wide, after a restart too.
*/
const HUD_MIN_WIDTH = 200;
const HUD_MAX_WIDTH = 1600;

function hudWidthFrom(opts) {
  const n = Number(opts && typeof opts === "object" ? opts.width : NaN);
  return Number.isFinite(n) && n > 0 ? Math.max(HUD_MIN_WIDTH, Math.min(HUD_MAX_WIDTH, Math.floor(n))) : HUD_DEFAULT_WIDTH;
}

function hudHeightFrom(opts) {
  const n = Number(opts && typeof opts === "object" ? opts.height : NaN);
  return Number.isFinite(n) && n > 0 ? Math.max(HUD_MIN_HEIGHT, Math.min(HUD_MAX_HEIGHT, Math.floor(n))) : HUD_DEFAULT_HEIGHT;
}

/** The slot identity: the page, not its query string (the merged HUD changes sections via the query). */
function hudSlotKey(pathNorm) {
  return String(pathNorm).split("?")[0];
}

/**
 * @param {{
 *   electron: { app: any, BrowserWindow: any, screen: any },
 *   getRuntime: () => ({ getLocalBaseUrl: () => string } | null),
 *   getDiag?: () => ({ watchWindow: (win: any, kind: string) => void } | null),
 *   preloadPath: string,
 *   onChange?: () => void,
 * }} deps
 */
function createHudWindows(deps) {
  const { app, BrowserWindow, screen } = deps.electron;
  if (!deps.getDiag) deps.getDiag = () => null;
  if (!deps.onChange) deps.onChange = () => {};

  /** @type {{ win: Electron.BrowserWindow, pathname: string }[]} */
  let hudOverlayStack = [];
  /*
    Set when the app quits (`dispose`). A HUD still loading then, or one a restore loop asks for
    after it, used to be created anyway and outlive the rest (review O-18).
  */
  let disposed = false;

  /*
    Where the stack lives and in what order — the owner's choice, remembered across launches in
    userData/hud-layout.json. `corner` is tl / tr / bl / br; `order` lists page keys (query string
    aside), first = outermost (top of a top-anchored stack, bottom of a bottom-anchored one). Pages not
    in the list follow in the order they were opened.
  */
  let hudLayout = { corner: "tr", order: [], freeOn: false, free: null };
  let hudHidden = false;
  /*
    Free move (owner, 2026-10-02: "place the HUD anywhere on any screen"). With `freeOn` the stack
    hangs from `free` instead of a corner: `{ x, y, bottom }` in screen coordinates (DIP), the
    stack's left edge and its top edge, or its bottom edge when `bottom` (dropped in the lower half
    of a screen, so it grows upwards there). `free` is kept while `freeOn` is off, so switching back
    finds the old spot. `moving` is the placing mode: the windows take the mouse, show a frame and
    follow a drag; never saved, and it shows the HUDs whatever hides them.
  */
  let moving = false;
  /** The drag in progress: the cursor and the stack's top-left when it started. */
  let drag = null;
  /*
    The game is not running (journal Shutdown, or no EliteDangerous64 process): the overlays step
    aside. Kept apart from `hudHidden`, which is the commander's own choice (the hotkey) and is saved;
    this is not saved and is never written into it. Guild tester report, 2026-09-30: the overlays
    stayed on top of the desktop after the game closed.
  */
  let gameAway = false;
  /*
    Elite is running but another window is in front (owner, 2026-09-30: "hide the HUD when the game
    is not running or not in focus"). Only counts while `hideUnfocused` is on — a saved launcher
    option, on by default. Like `gameAway`, never written into `hudHidden`.
  */
  let focusAway = false;
  let hideUnfocused = true;
  /*
    Whether Elite runs, as last told (null: not known yet). Unlike `gameAway` the hotkey does not clear
    it. "Hide when Elite is not in front" only means something while there is an Elite to be in front:
    with the game closed and the HUD shown by hand, it hid the HUD whenever anything else was clicked
    (owner, 2026-10-02: "appears-disappears", hud-events.log).
  */
  let gameRunning = null;
  const hiddenNow = () =>
    !moving && (hudHidden || gameAway || (hideUnfocused && focusAway && gameRunning !== false));
  /*
    A window whose page has nothing to show right now ("Only when relevant", guild tester report,
    2026-09-30): hidden and left out of the stack, so the others close up. The page says so through
    `resizeFromPage` (`idle`); the hotkey and the game-away state never show an idle window, and it
    comes back on its own the moment its page has something again.
  */
  const isIdle = (s) => s.idle === true;
  /*
    What the HUD windows did and why, one line each, in hud-events.log beside the layout file (owner,
    2026-10-02: "the HUD still appears-disappears every ~4 sec", which nothing here does on a timer).
    Transitions only — shown, hidden, the away states, idle pages, the window in front — so a quiet
    session writes nothing. Restarted past 256 KB.
  */
  let hudLogPath = null;
  function hudLog(what) {
    try {
      if (!hudLogPath) hudLogPath = path.join(path.dirname(hudLayoutPath()), "hud-events.log");
      try {
        if (fs.statSync(hudLogPath).size > 256 * 1024) fs.rmSync(hudLogPath, { force: true });
      } catch {
        /* not there yet */
      }
      fs.appendFileSync(hudLogPath, `${new Date().toISOString()} ${what}\n`);
    } catch {
      /* a log must never be why a HUD misbehaves */
    }
  }
  const slotName = (win) => hudOverlayStack.find((s) => s.win === win)?.pathname ?? "?";

  function hideWin(win) {
    try {
      if (win.isVisible()) hudLog(`hide ${slotName(win)}`);
    } catch {
      /* the log is a bystander */
    }
    try {
      win.hide();
    } catch {
      /* ignore */
    }
  }
  /** The HUD size multiplier from the launcher's slider; the pages report it, the stack width follows. */
  let hudScale = 1;

  /**
   * The HUDs that were open when the app last ran, restored on the next launch in the state they
   * were left in — shown or hidden (owner, 2026-09-28; until then always hidden, 2026-09-13). Same
   * file as the layout.
   */
  let hudRestoreList = [];
  /**
   * The last set of HUDs the commander actually had open.
   *
   * Kept apart from `hudRestoreList`, which `restoreHudOverlays` consumes, and never overwritten with
   * an empty list: the stack is pruned as windows are destroyed, so a shutdown can leave it empty
   * while the commander's intent — "these four HUDs" — has not changed at all. This is what the
   * hotkey reopens when it is pressed and there is nothing on screen to show.
   */
  let hudRememberedOpen = [];
  /** The icon child windows are created with, stashed at boot so the hotkey can open one later. */
  let hudChildIcon;
  /**
   * Set by {@link startEdexo}'s bundle once it is loaded; see `src/server/paths.ts`.
   *
   * Held in a variable rather than required at call time because this file is loaded before the server
   * bundle is, and a HUD path resolved too early would silently disagree with the one everything else
   * uses.
   */
  let resolveHudLayoutPathFromBundle = null;

  function hudPathsFiltered() {
    return hudOverlayStack.filter((s) => s.win && !s.win.isDestroyed()).map((s) => s.pathname);
  }

  function destroyHudWindow(win) {
    if (!win || win.isDestroyed()) return;
    try {
      win.destroy();
    } catch {
      try {
        win.close();
      } catch {
        /* ignore */
      }
    }
  }

  function removeHudSlotForWindow(win) {
    const next = hudOverlayStack.filter((s) => s.win !== win);
    if (next.length === hudOverlayStack.length) return;
    hudOverlayStack = next;
    relayoutHudStack();
  }

  function destroyAllHudOverlays() {
    for (const s of hudOverlayStack) destroyHudWindow(s.win);
    hudOverlayStack = [];
  }

  /** Quitting: every HUD goes, and none opens after this. */
  function disposeHudOverlays() {
    disposed = true;
    destroyAllHudOverlays();
  }

  /**
   * Where the HUD layout lives.
   *
   * It used to be Electron's own `app.getPath("userData")` — the one piece of app state that
   * `EDEXO_USER_DATA_DIR` did not cover, so an "isolated" second instance rewrote the real app's
   * overlay set. It sits beside the rest of the user data now.
   *
   * The Electron directory is still the fallback for the moment before the bundle is loaded, and
   * {@link carryHudLayoutOver} moves an existing file across once.
   */
  function hudLayoutPath() {
    if (resolveHudLayoutPathFromBundle) {
      try {
        return resolveHudLayoutPathFromBundle();
      } catch {
        /* fall through to the Electron directory */
      }
    }
    return legacyHudLayoutPath();
  }

  function legacyHudLayoutPath() {
    return path.join(app.getPath("userData"), "hud-layout.json");
  }

  /**
   * Carry a layout written before the move, once.
   *
   * Copied rather than moved: a failed delete must not look like a failed migration, and the old file
   * costs nothing once nothing reads it. Never over an existing layout — on an upgrade the commander's
   * current one wins.
   */
  function carryHudLayoutOver() {
    try {
      const live = hudLayoutPath();
      const legacy = legacyHudLayoutPath();
      if (live === legacy) return;
      if (fs.existsSync(live) || !fs.existsSync(legacy)) return;
      fs.mkdirSync(path.dirname(live), { recursive: true });
      fs.copyFileSync(legacy, live);
      console.info("[edexo-compare] carried the HUD layout over from", legacy);
    } catch {
      /* an unreadable or unwritable location just means the defaults */
    }
  }
  function loadHudLayout() {
    try {
      /*
        Strip a byte-order mark before parsing.

        `JSON.parse` throws on a leading BOM, and every Windows tool that might touch this file writes
        one — Notepad, and PowerShell's own `Set-Content -Encoding utf8`. The throw is caught below and
        looks exactly like "no layout saved", so a commander who opened the file to look at it would
        silently lose their overlay arrangement with nothing to explain it.
      */
      const j = JSON.parse(fs.readFileSync(hudLayoutPath(), "utf8").replace(/^\uFEFF/, ""));
      if (j && typeof j === "object") {
        setHudLayout(j, false);
        // The commander's last choice, shown or hidden: restored as it was (owner, 2026-09-28).
        hudHidden = j.hidden === true;
        hideUnfocused = j.hideUnfocused !== false;
        if (Number.isFinite(Number(j.scale))) hudScale = Math.min(2, Math.max(0.5, Number(j.scale)));
        if (Array.isArray(j.lastOpen)) {
          hudRememberedOpen = j.lastOpen
            .filter(
              (o) =>
                o && typeof o === "object" && typeof o.pathname === "string" && o.pathname.startsWith("/"),
            )
            .slice(0, MAX_HUD_OVERLAYS)
            .map((o) => ({
              pathname: o.pathname,
              width:
                Number.isFinite(Number(o.width)) && Number(o.width) > 0 ? Math.floor(Number(o.width)) : 404,
              height:
                Number.isFinite(Number(o.height)) && Number(o.height) > 0
                  ? Math.floor(Number(o.height))
                  : 330,
            }));
        }
        if (Array.isArray(j.open)) {
          hudRestoreList = j.open
            .filter(
              (o) =>
                o && typeof o === "object" && typeof o.pathname === "string" && o.pathname.startsWith("/"),
            )
            .slice(0, MAX_HUD_OVERLAYS)
            .map((o) => ({
              pathname: o.pathname,
              width:
                Number.isFinite(Number(o.width)) && Number(o.width) > 0 ? Math.floor(Number(o.width)) : 404,
              height:
                Number.isFinite(Number(o.height)) && Number(o.height) > 0
                  ? Math.floor(Number(o.height))
                  : 330,
            }));
          if (hudRestoreList.length && !hudRememberedOpen.length) hudRememberedOpen = hudRestoreList.slice();
        }
      }
    } catch {
      /* first run, or unreadable: defaults */
    }
  }
  function persistHudFile() {
    try {
      const open = hudOverlayStack
        .filter((s) => s.win && !s.win.isDestroyed())
        .map((s) => ({ pathname: s.pathname, width: s.width, height: s.height }));
      // Only ever remember a real set. An empty `open` is usually windows going away at shutdown, not
      // the commander deciding he wants no HUDs, and forgetting on every quit is how the hotkey ended
      // up with nothing to show.
      if (open.length) hudRememberedOpen = open;
      fs.writeFileSync(
        hudLayoutPath(),
        JSON.stringify({
          ...hudLayout,
          open,
          lastOpen: hudRememberedOpen,
          hidden: hudHidden,
          hideUnfocused,
          scale: hudScale,
        }),
        "utf8",
      );
    } catch {
      /* ignore */
    }
  }
  function setHudLayout(next, persist) {
    const corner =
      typeof next.corner === "string" && /^(tl|tr|bl|br)$/.test(next.corner) ? next.corner : hudLayout.corner;
    const order = Array.isArray(next.order)
      ? next.order.filter((k) => typeof k === "string").slice(0, 16)
      : hudLayout.order;
    const freeOn = typeof next.freeOn === "boolean" ? next.freeOn : hudLayout.freeOn;
    const free = next.free === null ? null : (freePointFrom(next.free) ?? hudLayout.free);
    hudLayout = { corner, order, freeOn, free };
    // Switched on with no spot saved yet: it stays where it is now instead of jumping.
    if (freeOn && !free) hudLayout.free = currentStackPoint();
    if (!freeOn && moving) setMoveMode(false);
    if (typeof next.hideUnfocused === "boolean" && next.hideUnfocused !== hideUnfocused) {
      hideUnfocused = next.hideUnfocused;
      applyAway();
    }
    if (persist) persistHudFile();
    relayoutHudStack();
    return hudLayout;
  }
  /**
   * Reopen last session's HUDs in the state they were left in (`hidden`, read by `loadHudLayout`).
   *
   * Until 2026-09-28 this always hid them afterwards, and the hide lost a race: a window shows
   * itself at `ready-to-show`, which can come after the load this waited for. The HUDs were then on
   * screen while `hudHidden` said hidden, so the first press of the hotkey "showed" what was already
   * showing and looked like the keys doing nothing — the owner's "sometimes does not work". Now the
   * flag is set before any window opens, and every window consults it when it first paints.
   */
  async function restoreHudOverlays(iconForChild) {
    const list = hudRestoreList;
    hudRestoreList = [];
    if (!list.length) return;
    for (const o of list) {
      try {
        await requestHudOverlaySlot(o.pathname, o.width, o.height, iconForChild, "open");
      } catch {
        /* a page that no longer exists: skip it */
      }
    }
    /*
      A restore that opened none of its set leaves nothing hidden: recording "hidden" over an empty
      stack spends the next press of the hotkey un-hiding nothing.
    */
    if (hudHidden && !hudOverlayStack.some((s) => s.win && !s.win.isDestroyed())) {
      hudHidden = false;
      persistHudFile();
      deps.onChange();
    }
  }

  /**
   * Stack the HUD windows in the chosen corner, in the chosen order.
   *
   * Every HUD in the stack gets the same width — the widest one asked for — so the panels line up
   * as one column instead of four different boxes. The pages fill whatever width they are given.
   */
  /**
   * Put one HUD back on top, and keep it there.
   *
   * Always-on-top is not a property Windows guarantees for the rest of a window's life. A game taking
   * the foreground -- Elite does it on every alt-tab, and borderless with Fullscreen Optimizations
   * behaves the same way as exclusive here -- can push every other topmost window below it. The flag
   * is still set; the z-order says otherwise.
   *
   * This was asserted exactly once, at `ready-to-show`, so the first time Elite came forward the HUDs
   * went behind it and nothing ever put them back. The commander's report reads as the hotkey failing
   * ("does not appear"), and the tell that it is not the hotkey is that the same press works with the
   * game minimised: the window is created, shown and positioned, and is simply underneath.
   */
  function raiseHudWindow(win) {
    if (!win || win.isDestroyed()) return;
    let visible = false;
    try {
      visible = win.isVisible();
    } catch {
      /* treat as hidden */
    }
    /*
      Shown only when it is not: showing a window that is already up repaints it, and coming back to
      the game ran this several times in a row — the owner saw the HUD blink 3-4 times (2026-10-02).
    */
    if (!visible) {
      hudLog(`show ${slotName(win)}`);
      try {
        win.showInactive();
      } catch {
        try {
          win.show();
        } catch {
          return;
        }
      }
    }
    // `screen-saver` is the highest level Electron offers; `floating` is the fallback for a platform
    // that refuses it. Re-set rather than assumed: the level travels with the assertion.
    try {
      win.setAlwaysOnTop(true, "screen-saver");
    } catch {
      try {
        win.setAlwaysOnTop(true, "floating");
      } catch {
        /* ignore */
      }
    }
    try {
      win.moveTop();
    } catch {
      /* ignore */
    }
  }

  /**
   * Re-assert the whole visible stack, on a timer.
   *
   * Nothing tells an application that it has been pushed down the z-order, so the only way to hold the
   * top is to ask for it again. Every few seconds is enough to be back before the commander looks, and
   * cheap: three calls per window, none of which move focus -- `showInactive`, `setAlwaysOnTop` and
   * `moveTop` all leave the foreground window alone, which matters when the foreground window is a
   * game that would notice losing it.
   *
   * Stops itself whenever the HUDs are hidden or the stack empties, so an idle app runs no timer.
   */
  let hudKeepOnTopTimer = null;
  function keepHudsOnTop() {
    if (hudKeepOnTopTimer) return;
    hudKeepOnTopTimer = setInterval(() => {
      const live = hudOverlayStack.filter((s) => s.win && !s.win.isDestroyed());
      if (hiddenNow() || live.length === 0) {
        stopKeepingHudsOnTop();
        return;
      }
      for (const s of live) if (!isIdle(s)) raiseHudWindow(s.win);
    }, HUD_KEEP_ON_TOP_MS);
    if (typeof hudKeepOnTopTimer.unref === "function") hudKeepOnTopTimer.unref();
  }
  /** Raise every visible HUD now: the game has just come to the front and may have covered them. */
  let raisedAt = 0;
  function raiseVisible() {
    if (hiddenNow()) return;
    // Coming back to the game raises them through applyAway already; once is enough.
    if (Date.now() - raisedAt < 400) return;
    raisedAt = Date.now();
    for (const s of hudOverlayStack) if (s.win && !s.win.isDestroyed() && !isIdle(s)) raiseHudWindow(s.win);
  }
  function stopKeepingHudsOnTop() {
    if (!hudKeepOnTopTimer) return;
    clearInterval(hudKeepOnTopTimer);
    hudKeepOnTopTimer = null;
  }

  /** A saved free spot, or null when it is not one (a hand-edited file). */
  function freePointFrom(v) {
    if (!v || typeof v !== "object") return null;
    const x = Number(v.x);
    const y = Number(v.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e5 || Math.abs(y) > 1e5) return null;
    return { x: Math.round(x), y: Math.round(y), bottom: v.bottom === true };
  }

  /** The visible stack in its order, and the column width. */
  /*
    The height a window should have: what its page last reported (`resizeFromPage`), else what it was
    opened with. Never read back from the window to be set again. On a monitor whose scaling differs
    from the primary's, Windows can land a set size scaled by the ratio of the two; read back and set
    on every relayout, that scaled it again each time — a commander's merged HUD grew to the height of
    his second screen, and unmerged the windows piled on top of each other (2026-10-02).
  */
  function slotHeight(slot) {
    if (Number.isFinite(slot.height) && slot.height > 0) return slot.height;
    try {
      return slot.win.getSize()[1];
    } catch {
      return null;
    }
  }

  /**
   * Put a window at a rect, and say how tall it really is. If the size did not take (the mixed-scaling
   * case above), it is asked once more: the window is on that monitor now, and a second set lands.
   * Whatever it ends up as, the caller spaces the next window by the larger of the two, so a window
   * that came out taller still never covers the one below it.
   */
  function placeWindow(win, rect) {
    // Already there: no setBounds, which repaints a transparent window over the game even when it
    // changes nothing (the blinks on coming back to the game, 2026-10-02).
    try {
      const b0 = win.getBounds();
      if (b0.x === rect.x && b0.y === rect.y && b0.width === rect.width && b0.height === rect.height) return rect.height;
    } catch {
      /* set it */
    }
    win.setBounds({ ...rect, animate: false });
    let actual = rect.height;
    try {
      const b = win.getBounds();
      if (Math.abs(b.width - rect.width) > 2 || Math.abs(b.height - rect.height) > 2) {
        win.setBounds({ ...rect, animate: false });
      }
      actual = win.getBounds().height;
    } catch {
      /* a window going away */
    }
    return Math.max(rect.height, actual);
  }

  function orderedStack() {
    hudOverlayStack = hudOverlayStack.filter((s) => s.win && !s.win.isDestroyed());
    const rank = (s) => {
      const i = hudLayout.order.indexOf(s.key);
      return i < 0 ? 1000 + hudOverlayStack.indexOf(s) : i;
    };
    const ordered = hudOverlayStack
      .filter((s) => !isIdle(s))
      .sort((a, b) => rank(a) - rank(b));
    const w = Math.round((Math.max(0, ...hudOverlayStack.map((s) => s.width || 0)) || 404) * hudScale);
    return { ordered, w };
  }

  /** Where the stack's top-left is now (its highest window's corner), as a free spot. */
  function currentStackPoint() {
    const { ordered } = orderedStack();
    let top = null;
    for (const s of ordered) {
      try {
        const b = s.win.getBounds();
        if (!top || b.y < top.y) top = { x: b.x, y: b.y };
      } catch {
        /* a window going away */
      }
    }
    if (top) return { x: top.x, y: top.y, bottom: false };
    const wa = screen.getPrimaryDisplay().workArea;
    return { x: wa.x + 14, y: wa.y + 14, bottom: false };
  }

  /**
   * The free-move stack: hung from its saved spot, top to bottom in the chosen order, on the screen
   * nearest that spot and clamped into it. A monitor unplugged or a resolution changed brings it
   * back onto a screen that exists rather than leaving it somewhere nobody can reach.
   */
  function relayoutFreeStack() {
    const { ordered, w } = orderedStack();
    const f = hudLayout.free || currentStackPoint();
    const probe = { x: Math.round(f.x + w / 2), y: f.bottom ? f.y - 1 : f.y };
    let area;
    try {
      area = screen.getDisplayNearestPoint(probe).bounds;
    } catch {
      area = screen.getPrimaryDisplay().workArea;
    }
    // No window taller than the screen it is on (a 768 px monitor is shorter than HUD_MAX_HEIGHT).
    const sizes = ordered.map((s) => {
      const h = slotHeight(s);
      return h == null ? null : Math.min(h, area.height);
    });
    const total = sizes.reduce((a, h) => a + (h ?? 0), 0) + HUD_STACK_GAP * Math.max(0, ordered.length - 1);
    const fit = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const x = fit(f.x, area.x, Math.max(area.x, area.x + area.width - w));
    let y = fit(f.bottom ? f.y - total : f.y, area.y, Math.max(area.y, area.y + area.height - total));
    ordered.forEach((slot, i) => {
      const h = sizes[i];
      if (h == null) return;
      let used = h;
      try {
        used = placeWindow(slot.win, { x, y, width: w, height: h });
      } catch {
        /* ignore */
      }
      y += used + HUD_STACK_GAP;
    });
  }

  /**
   * Placing mode on or off. On: every HUD shows (whatever hides them), takes the mouse and draws its
   * "drag to place" frame; off: back to click-through, and the hidden / away states apply again.
   */
  function setMoveMode(on) {
    const next = on === true && hudLayout.freeOn;
    if (next === moving) return moving;
    hudLog(`placing ${next ? "on" : "off"}`);
    moving = next;
    drag = null;
    for (const s of hudOverlayStack) {
      if (!s.win || s.win.isDestroyed()) continue;
      try {
        s.win.setIgnoreMouseEvents(!moving);
      } catch {
        /* ignore */
      }
      try {
        s.win.webContents.send("edexo:hud-move-mode", { on: moving });
      } catch {
        /* a window closing mid-send */
      }
    }
    applyAway();
    return moving;
  }

  /**
   * A drag from a HUD page in placing mode. The cursor is read here (`getCursorScreenPoint`, DIP on
   * every monitor) rather than taken from the page, whose coordinates are in its own window's scale.
   * The stack follows the cursor; on release the spot is saved, by its bottom edge when it was
   * dropped in the lower half of a screen.
   */
  let dragMoves = 0;
  function dragFromPage(win, phase) {
    if (phase !== "move") hudLog(`drag ${phase}${moving ? "" : " (not placing)"}${hudOverlayStack.some((s) => s.win === win) ? "" : " (not a HUD window)"}`);
    if (!moving || !hudOverlayStack.some((s) => s.win === win)) return { ok: false };
    if (phase === "done") {
      setMoveMode(false);
      deps.onChange();
      return { ok: true };
    }
    let cur;
    try {
      cur = screen.getCursorScreenPoint();
    } catch {
      return { ok: false };
    }
    if (phase === "start") {
      const p = currentStackPoint();
      drag = { cx: cur.x, cy: cur.y, x: p.x, y: p.y };
      dragMoves = 0;
      hudLog(`drag from cursor ${cur.x},${cur.y}, stack at ${p.x},${p.y}`);
      return { ok: true };
    }
    if (!drag) return { ok: false };
    hudLayout.free = { x: drag.x + cur.x - drag.cx, y: drag.y + cur.y - drag.cy, bottom: false };
    relayoutFreeStack();
    if (phase === "move") dragMoves += 1;
    if (phase === "end") {
      hudLog(`drag end after ${dragMoves} moves: cursor ${cur.x},${cur.y}, asked ${hudLayout.free.x},${hudLayout.free.y}`);
      drag = null;
      const top = currentStackPoint();
      let bottomEdge = top.y;
      for (const s of orderedStack().ordered) {
        try {
          const b = s.win.getBounds();
          bottomEdge = Math.max(bottomEdge, b.y + (slotHeight(s) ?? b.height));
        } catch {
          /* ignore */
        }
      }
      let area = null;
      try {
        area = screen.getDisplayNearestPoint({ x: top.x, y: top.y }).bounds;
      } catch {
        /* no display API: keep the top edge */
      }
      const lower = area ? (top.y + bottomEdge) / 2 > area.y + area.height / 2 : false;
      hudLayout.free = lower ? { x: top.x, y: bottomEdge, bottom: true } : top;
      persistHudFile();
      deps.onChange();
    }
    return { ok: true };
  }

  /*
    The monitor the game is on, from the foreground watcher (a point in screen pixels; main.cjs). The
    corner stack used to go to the primary monitor whatever the game was on, so with Elite on a second
    screen the HUD sat on the other one (plan 2.1, Fable C12). Free move keeps the spot it was given.
  */
  let gamePoint = null;
  function setGamePoint(p) {
    const next = p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
    if ((next && gamePoint && next.x === gamePoint.x && next.y === gamePoint.y) || (!next && !gamePoint)) return;
    gamePoint = next;
    if (!hudLayout.freeOn) scheduleHudRelayout();
  }
  function stackDisplay() {
    if (gamePoint) {
      try {
        const dip = typeof screen.screenToDipPoint === "function" ? screen.screenToDipPoint(gamePoint) : gamePoint;
        const d = screen.getDisplayNearestPoint(dip);
        if (d && d.workArea) return d;
      } catch {
        /* the primary, as before */
      }
    }
    return screen.getPrimaryDisplay();
  }

  function relayoutHudStack() {
    if (hudLayout.freeOn) {
      relayoutFreeStack();
      return;
    }
    const d = stackDisplay();
    const wa = d.workArea;
    const margin = 14;
    hudOverlayStack = hudOverlayStack.filter((s) => s.win && !s.win.isDestroyed());
    const rank = (s) => {
      const i = hudLayout.order.indexOf(s.key);
      return i < 0 ? 1000 + hudOverlayStack.indexOf(s) : i;
    };
    const ordered = hudOverlayStack
      .filter((s) => !isIdle(s))
      .sort((a, b) => rank(a) - rank(b));
    const w = Math.round((Math.max(0, ...hudOverlayStack.map((s) => s.width || 0)) || 404) * hudScale);
    const atBottom = hudLayout.corner.startsWith("b");
    const atRight = hudLayout.corner.endsWith("r");
    const x = atRight ? Math.floor(wa.x + wa.width - margin - w) : wa.x + margin;
    let y = atBottom ? wa.y + wa.height - margin : wa.y + margin;
    /*
      Clamped into the work area, always.

      A stack taller than the screen used to run off the bottom (or off the top, anchored at a bottom
      corner) and the windows down there are simply gone — click-through, frameless, no taskbar entry,
      nothing to drag back. The same arithmetic put every window off the side when the work area
      shrank under it, which is the failure this clamp exists for: see the display listener below.
    */
    const fit = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    for (const slot of ordered) {
      const full = slotHeight(slot);
      if (full == null) continue;
      const h = Math.min(full, wa.height);
      if (atBottom) y -= h;
      let used = h;
      try {
        used = placeWindow(slot.win, {
          x: fit(x, wa.x, Math.max(wa.x, wa.x + wa.width - w)),
          y: fit(y, wa.y, Math.max(wa.y, wa.y + wa.height - h)),
          width: w,
          height: h,
        });
      } catch {
        /* ignore */
      }
      y = atBottom ? y - HUD_STACK_GAP : y + used + HUD_STACK_GAP;
    }
  }

  /**
   * Put the stack back on the screen when the screen changes underneath it.
   *
   * The HUDs are positioned from `screen.getPrimaryDisplay().workArea` and were only ever repositioned
   * when something in the app happened to call {@link relayoutHudStack}. Nothing listened to the
   * display itself — so when the work area changed, the windows stayed at coordinates computed for a
   * screen that no longer existed, which on a shrink means **off the edge and unreachable**.
   *
   * Elite does this routinely: it changes resolution going fullscreen, changes it back on exit, and a
   * monitor waking or sleeping does the same. That is the "now and again" in the owner's report — the
   * overlay disappears, the hotkey cannot bring it back because hiding and showing does not move
   * anything, and the only way out is to make a *new* window, which is what unticking "merge into one
   * panel" and re-ticking it does.
   *
   * Coalesced, because Windows emits several of these for one resolution change.
   */
  let relayoutTimer = null;
  function scheduleHudRelayout() {
    if (relayoutTimer) clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(() => {
      relayoutTimer = null;
      relayoutHudStack();
    }, 250);
  }

  function watchDisplaysForHudRelayout() {
    for (const ev of ["display-metrics-changed", "display-added", "display-removed"]) {
      try {
        screen.on(ev, scheduleHudRelayout);
      } catch {
        /* a platform without it: the stack simply keeps its position */
      }
    }
  }

  /**
   * Reopen the remembered HUDs, for a hotkey press that has nothing to show.
   *
   * Deliberately not `restoreHudOverlays`: that one consumes its list and hides the stack afterwards,
   * which is right at boot and exactly wrong here — this is somebody asking to see them now.
   */
  async function reopenRememberedHuds() {
    const list = hudRememberedOpen.slice();
    for (const o of list) {
      try {
        await requestHudOverlaySlot(o.pathname, o.width, o.height, hudChildIcon, "open");
      } catch {
        /* a page that no longer exists: skip it, the others still come back */
      }
    }
    relayoutHudStack();
    for (const s of hudOverlayStack) raiseHudWindow(s.win);
    keepHudsOnTop();
  }

  /** Hide or show every HUD window (the global shortcut). Windows keep their state; only visibility changes. */
  function toggleHudVisibility(force) {
    // The hotkey toggles what the commander sees: overlays hidden because the game is away count as
    // hidden, so the press shows them — and a show overrides the game-away state until it changes.
    hudHidden = typeof force === "boolean" ? force : !hiddenNow();
    if (!hudHidden) {
      gameAway = false;
      focusAway = false;
    }
    persistHudFile();
    deps.onChange();

    /*
      Showing when there is nothing on screen has to *open* something.

      The hotkey only ever flipped a flag and looped over `hudOverlayStack`. When that stack is empty
      the loop does nothing, so the commander presses the keys, sees no HUD, presses again, and the
      flag simply flips back — forever. Nothing else in the app reopens them, which is why the only
      way out was toggling a HUD off and on in the picker until one got created.

      The stack is empty more often than it looks: it is pruned as windows are destroyed, and a
      restore that failed leaves it empty while `hudHidden` says the HUDs are merely hidden.
    */
    const live = hudOverlayStack.filter((s) => s.win && !s.win.isDestroyed());
    if (!hudHidden && live.length === 0 && hudRememberedOpen.length) {
      void reopenRememberedHuds();
      return hudHidden;
    }

    for (const s of hudOverlayStack) {
      if (!s.win || s.win.isDestroyed()) continue;
      if (hudHidden || isIdle(s)) {
        hideWin(s.win);
        continue;
      }
      // Showing is the moment the game most likely owns the top of the z-order, so this asks for it
      // back rather than only making the window visible underneath.
      raiseHudWindow(s.win);
    }
    if (hudHidden) stopKeepingHudsOnTop();
    else keepHudsOnTop();
    /*
      Showing is also a rescue, so it repositions.

      The hotkey is what a commander reaches for when a HUD is not where it should be, and hiding and
      showing a window parked off the edge of a changed work area brings back exactly nothing — which
      is what the owner reported. One relayout here means the reflex works.
    */
    if (!hudHidden) relayoutHudStack();
    return hudHidden;
  }

  /**
   * The game has gone (true) or is back (false). Hides every overlay without touching the commander's
   * own hidden/shown choice, and brings them back — raised and laid out — when the game returns.
   */
  function setGameAway(away) {
    const next = away === true;
    // Recorded even when the away state already says so: the hotkey may have cleared that.
    const wasRunning = gameRunning;
    gameRunning = !next;
    if (gameAway === next) {
      if (wasRunning !== gameRunning) applyAway();
      return;
    }
    hudLog(`game ${next ? "not running" : "running"}`);
    gameAway = next;
    applyAway();
  }

  /** Elite has lost (true) or regained (false) the foreground; hides only while `hideUnfocused` is on. */
  function setFocusAway(away) {
    const next = away === true;
    if (focusAway === next) return;
    hudLog(`focus ${next ? "away from the game" : "back on the game"}`);
    const before = hiddenNow();
    focusAway = next;
    if (hiddenNow() !== before) applyAway();
  }

  /** Brings the windows in line with the away states: hidden, or raised and laid out. */
  function applyAway() {
    deps.onChange();
    for (const s of hudOverlayStack) {
      if (!s.win || s.win.isDestroyed()) continue;
      if (hiddenNow() || isIdle(s)) hideWin(s.win);
      else raiseHudWindow(s.win);
    }
    if (!hiddenNow()) raisedAt = Date.now();
    if (hiddenNow()) stopKeepingHudsOnTop();
    else {
      keepHudsOnTop();
      relayoutHudStack();
    }
  }

  /** @param {number} width @param {number} height */
  function createHudOverlayWindow(width, height, iconForChild) {
    // No `parent`: a child window is minimised together with its parent on Windows, which took every
    // HUD off the screen whenever the launcher was minimised (owner, 2026-09-12). The HUDs are
    // always-on-top, click-through windows of their own; the launcher closing still closes them
    // through the app's own shutdown path.
    const win = new BrowserWindow({
      width,
      height,
      frame: false,
      transparent: true,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      focusable: false,
      thickFrame: false,
      icon: iconForChild ?? undefined,
      titleBarStyle: "hidden",
      backgroundColor: "#00000000",
      webPreferences: {
        // A transparent window over a fullscreen game can be judged hidden, and Chromium then slows its
        // timers to once a second: the tracker's distance and the radar froze (plan 2.1, Fable C10).
        backgroundThrottling: false,
      // No spell-check: Electron can fetch its dictionaries from Google (owner, 2026-09-29).
      spellcheck: false,
        nodeIntegration: false,
        contextIsolation: true,
        // The same bridge the launcher gets. Without it `window.edexoElectron` is undefined in the
        // overlay pages, `resizeHudOverlay` silently no-ops, and every HUD stays at the size it was
        // opened with — which is why the tracker's radar was cut off at the bottom.
        preload: deps.preloadPath,
        // `sandbox: false` is the only explicit opt-out in the app. The overlays are frameless,
        // transparent, always-on-top windows whose rendering cannot be verified from a test or a
        // headless run, and changing the packaged app on an untested assumption is how §31 happened.
        // Flip it, launch the app, and open the overlays before committing.
        sandbox: false,
        /*
          A session of their own (owner, 2026-09-26): Chromium keeps one zoom per site per session, and
          the HUDs are the launcher's site, so zooming the launcher zoomed every overlay. Their
          settings do not need the launcher's localStorage: with none of their own they read the
          server's mirror of it (`hudPrefs` in each snapshot, pushed on every change — the phone HUD
          has always worked that way).
        */
        partition: "persist:hud",
      },
    });
    deps.getDiag()?.watchWindow(win, "hud");
    if (typeof deps.guardWindow === "function") deps.guardWindow(win);

    try {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {
      try {
        win.setVisibleOnAllWorkspaces(true);
      } catch {
        /* ignore */
      }
    }

    /*
      A window paints when it is ready, which may be after the stack was hidden (a restore, or the
      hotkey pressed while pages load). Raising it then put a HUD on screen behind the flag's back.
    */
    win.once("ready-to-show", () => {
      relayoutHudStack();
      if (hiddenNow() || hudOverlayStack.some((s) => s.win === win && isIdle(s))) {
        try {
          win.hide();
        } catch {
          /* ignore */
        }
        return;
      }
      raiseHudWindow(win);
      keepHudsOnTop();
    });

    win.on("closed", () => {
      removeHudSlotForWindow(win);
    });

    win.webContents.on("did-finish-load", () => {
      if (!win || win.isDestroyed()) return;
      try {
        win.setIgnoreMouseEvents(!moving);
      } catch {
        /* ignore */
      }
      // A window opened (or a page reloaded) while placing gets the frame too.
      if (moving) {
        try {
          win.webContents.send("edexo:hud-move-mode", { on: true });
        } catch {
          /* ignore */
        }
      }
    });

    return win;
  }

  /**
   * Load a HUD overlay's page, retrying a couple of times before giving up.
   *
   * The owner hit `ERR_FAILED (-2) loading 'http://127.0.0.1:7111/fss-scan-overlay.html'` on a server
   * that serves that page perfectly well a second later. `runtime` being set means the HTTP server
   * has been created, not that the listening socket is answering yet, and opening the merged stack
   * fires several `loadURL` calls at once — so the first one through can lose a race it would win on
   * any later attempt.
   *
   * One failed load used to destroy the window and report the raw Chromium string, which put the
   * commander in front of an error for something that had not actually gone wrong. Three attempts
   * over roughly half a second; a page that is genuinely missing still fails, just three times.
   *
   * A load that is no longer wanted — a newer section change for the same window, or the app
   * quitting — stops without retrying: its retry used to load the older page over the newer one
   * (review O-18, two quick section changes).
   *
   * @param {import("electron").BrowserWindow} win
   * @param {string} url
   * @param {() => boolean} [wanted]
   * @returns {Promise<boolean>} false when it stopped because it was no longer wanted
   */
  async function loadHudUrlWithRetry(win, url, wanted = () => true) {
    const ATTEMPTS = 3;
    const BACKOFF_MS = 200;
    let last;
    for (let i = 0; i < ATTEMPTS; i += 1) {
      if (win.isDestroyed()) throw last ?? new Error("Overlay window closed while loading.");
      if (disposed || !wanted()) return false;
      try {
        await win.loadURL(url);
        return true;
      } catch (e) {
        if (disposed || !wanted()) return false;
        last = e;
        if (i < ATTEMPTS - 1) {
          console.warn(`[edexo-compare] HUD overlay load attempt ${i + 1} failed, retrying:`, url, String(e));
          await new Promise((r) => setTimeout(r, BACKOFF_MS * (i + 1)));
        }
      }
    }
    throw last ?? new Error("Overlay failed to load.");
  }

  /**
   * @param {string} pathNorm
   * @param {number} width
   * @param {number} height
   * @param {"toggle" | "open" | "set"} mode toggle: same page closes; open: already-open page is a
   *   no-op; set: an already-open page is pointed at the new URL (query string changes)
   */
  async function requestHudOverlaySlot(pathNorm, width, height, iconForChild, mode) {
    if (disposed) return { opened: false, paths: [], error: "The app is closing." };
    const runtime = deps.getRuntime();
    if (!runtime) return { opened: false, paths: hudPathsFiltered(), error: "Server not ready yet." };

    /*
      Asking for a HUD is asking to see it.

      `restoreHudOverlays` reopens last session's set and then hides the stack, so the hotkey brings
      back exactly what the commander left. That leaves `hudHidden` true for the rest of the run, and
      nothing in the launcher ever cleared it — the launcher has no visibility control at all. So every
      overlay opened from the picker was hidden the instant it loaded (see the `hudHidden` check further
      down), the picker ticked it as on, and the commander saw nothing. Toggling anything else in the
      picker only opened more invisible windows.

      `open` is exempt because that *is* the restore path, and un-hiding there would defeat the point of
      restoring quietly. A `toggle` or a `set` is somebody clicking.
    */
    if (mode !== "open" && hiddenNow()) toggleHudVisibility(false);

    const key = hudSlotKey(pathNorm);
    /*
      A dead window must not answer for a live one.

      `closed` prunes the slot when a window is destroyed normally, but a renderer that goes away some
      other way leaves the slot behind — and then `set` finds it, sees the pathname already matches,
      and returns `opened: true` having done nothing at all. The launcher ticks the row, the commander
      sees nothing, and no amount of clicking helps because every click takes the same early return.
    */
    hudOverlayStack = hudOverlayStack.filter((s) => s.win && !s.win.isDestroyed());
    const existing = hudOverlayStack.findIndex((s) => s.key === key);
    if (existing >= 0) {
      const slot = hudOverlayStack[existing];
      if (mode === "toggle") {
        hudOverlayStack.splice(existing, 1);
        destroyHudWindow(slot.win);
        relayoutHudStack();
        persistHudFile();
        deps.onChange();
        return { opened: false, paths: hudPathsFiltered() };
      }
      if (mode === "set" && slot.pathname !== pathNorm) {
        slot.pathname = pathNorm;
        slot.width = Math.max(slot.width || 0, width);
        slot.height = Math.max(slot.height || 0, height);
        // Only the newest change for this window may load or retry (review O-18).
        const seq = (slot.loadSeq = (slot.loadSeq || 0) + 1);
        try {
          const done = await loadHudUrlWithRetry(slot.win, `${runtime.getLocalBaseUrl()}${pathNorm}`, () => slot.loadSeq === seq);
          if (!done) return { opened: !disposed, paths: hudPathsFiltered() };
          relayoutHudStack();
          persistHudFile();
        } catch (e) {
          return {
            opened: true,
            paths: hudPathsFiltered(),
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }
      return { opened: true, paths: hudPathsFiltered() };
    }

    while (hudOverlayStack.length >= MAX_HUD_OVERLAYS) {
      const drop = hudOverlayStack.shift();
      if (drop) destroyHudWindow(drop.win);
    }

    const url = `${runtime.getLocalBaseUrl()}${pathNorm}`;
    const win = createHudOverlayWindow(width, height, iconForChild);
    hudOverlayStack.push({ win, pathname: pathNorm, key, width, height });
    deps.onChange();

    win.webContents.on("did-fail-load", (_e, code, desc) => {
      // Logged at every attempt, not just the first: a retry that succeeds leaves one of these behind
      // and it should not read like the failure that was reported to the commander.
      console.error("[edexo-compare] HUD overlay failed to load:", url, code, desc);
    });

    try {
      await loadHudUrlWithRetry(win, url);
      if (disposed) {
        // Quitting began while it loaded: it goes with the rest.
        destroyHudWindow(win);
        hudOverlayStack = hudOverlayStack.filter((s) => s.win !== win);
        return { opened: false, paths: [], error: "The app is closing." };
      }
      relayoutHudStack();
      if (hiddenNow()) win.hide();
      persistHudFile();
      return { opened: true, paths: hudPathsFiltered() };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const idx = hudOverlayStack.findIndex((s) => s.win === win);
      if (idx >= 0) hudOverlayStack.splice(idx, 1);
      destroyHudWindow(win);
      relayoutHudStack();
      return { opened: false, paths: hudPathsFiltered(), error: msg };
    }
  }

  /** Close one overlay by page. Returns the same shape the IPC channel always returned. */
  function closeHudOverlayByPath(pathname) {
    const key = hudSlotKey(pathname);
    const idx = hudOverlayStack.findIndex((s) => s.key === key);
    if (idx < 0) return { closed: false, paths: hudPathsFiltered() };
    const slot = hudOverlayStack[idx];
    hudOverlayStack.splice(idx, 1);
    destroyHudWindow(slot.win);
    relayoutHudStack();
    persistHudFile();
    deps.onChange();
    return { closed: true, paths: hudPathsFiltered() };
  }

  function pushPrefs(prefs) {
    if (!prefs || typeof prefs !== "object") return;
    for (const slot of hudOverlayStack) {
      try {
        if (slot.win && !slot.win.isDestroyed()) slot.win.webContents.send("edexo:hud-prefs", prefs);
      } catch {
        /* a window closing mid-send */
      }
    }
  }

  /**
   * An overlay reporting how tall it actually is.
   *
   * The page is the only thing that knows: its height depends on what the game is doing — a sample
   * in progress draws rows an idle one does not. Width is left alone, because that *is* a layout
   * choice and a HUD that changes width as data arrives would be unreadable.
   */
  function resizeFromPage(win, opts) {
    if (!win || win.isDestroyed()) return { ok: false };
    // Only a HUD window sizes itself this way: the app or galaxy window could be squeezed to 90 px.
    if (!hudOverlayStack.some((s) => s.win === win)) return { ok: false };
    const idle = opts && typeof opts === "object" ? opts.idle : undefined;
    if (typeof idle === "boolean") {
      const slot = hudOverlayStack.find((s) => s.win === win);
      if (slot && isIdle(slot) !== idle) {
        hudLog(`${idle ? "idle" : "relevant"} ${slot.pathname}`);
        slot.idle = idle;
        if (idle) hideWin(win);
        else if (!hiddenNow()) raiseHudWindow(win);
        relayoutHudStack();
        deps.onChange();
      }
      if (idle) return { ok: true };
    }
    const raw = Number(opts && typeof opts === "object" ? opts.height : NaN);
    if (!Number.isFinite(raw)) return { ok: false };
    const height = Math.max(HUD_MIN_HEIGHT, Math.min(HUD_MAX_HEIGHT, Math.ceil(raw)));
    // The page's scale rides along; a change widens every window in the stack together.
    const sc = Number(opts && typeof opts === "object" ? opts.scale : NaN);
    let scaleChanged = false;
    if (Number.isFinite(sc)) {
      const next = Math.min(2, Math.max(0.5, sc));
      if (Math.abs(next - hudScale) > 0.004) {
        hudScale = next;
        scaleChanged = true;
        persistHudFile();
      }
    }
    try {
      const slot = hudOverlayStack.find((s) => s.win === win);
      // A pixel or two of jitter from a font metric must not start a resize loop. Compared with the
      // height asked for last, not the window's: on a monitor at another scaling those differ for good.
      if (!scaleChanged && slot && Math.abs(slotHeight(slot) - height) <= 2) return { ok: true };
      if (slot) slot.height = height;
      relayoutHudStack();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  return {
    /** Pages of the open overlays, in stack order. */
    paths: hudPathsFiltered,
    count: () => hudOverlayStack.filter((s) => s.win && !s.win.isDestroyed()).length,
    isHidden: () => hudHidden,
    layout: () => ({
      ...hudLayout,
      hidden: hudHidden,
      gameAway,
      focusAway,
      hideUnfocused,
      moving,
      count: hudOverlayStack.filter((s) => s.win && !s.win.isDestroyed()).length,
      shortcut: HUD_TOGGLE_SHORTCUT,
    }),
    /** Free move's placing mode (only while free move is on). Returns whether it is on. */
    setMoveMode: (on) => {
      const r = setMoveMode(on);
      deps.onChange();
      return r;
    },
    isMoving: () => moving,
    dragFromPage,
    setLayout: (next) => ({
      ...setHudLayout(next || {}, true),
      hidden: hudHidden,
      shortcut: HUD_TOGGLE_SHORTCUT,
    }),
    request: requestHudOverlaySlot,
    close: closeHudOverlayByPath,
    toggleVisibility: toggleHudVisibility,
    setGameAway,
    isGameAway: () => gameAway,
    setFocusAway,
    isFocusAway: () => focusAway,
    /** Pages of the overlays their page has declared idle ("only when relevant"). */
    idlePaths: () => hudOverlayStack.filter((s) => s.win && !s.win.isDestroyed() && isIdle(s)).map((s) => s.pathname),
    restore: restoreHudOverlays,
    destroyAll: destroyAllHudOverlays,
    dispose: disposeHudOverlays,
    pushPrefs,
    resizeFromPage,
    /** Where the game's window is (screen pixels), so the corner stack goes to its monitor. */
    setGamePoint,
    raiseVisible,
    /** One line in hud-events.log (main.cjs adds the foreground window's changes). */
    log: hudLog,
    /** Boot: where the layout file lives once the server bundle is loaded, then read it. */
    setLayoutPathResolver(fn) {
      resolveHudLayoutPathFromBundle = typeof fn === "function" ? fn : null;
    },
    layoutPath: hudLayoutPath,
    loadLayout() {
      carryHudLayoutOver();
      loadHudLayout();
    },
    watchDisplays: watchDisplaysForHudRelayout,
    setChildIcon(icon) {
      hudChildIcon = icon;
    },
    childIcon: () => hudChildIcon,
    /** For tests: lay the stack out now. */
    relayout: relayoutHudStack,
  };
}

module.exports = {
  createHudWindows,
  hudPathFrom,
  hudWidthFrom,
  hudHeightFrom,
  hudSlotKey,
  HUD_TOGGLE_SHORTCUT,
  HUD_MIN_HEIGHT,
  HUD_MAX_HEIGHT,
  MAX_HUD_OVERLAYS,
};
