var lastPort = 7111;
/** The feed learns the server's port from each snapshot (only used off http, e.g. file://). */
export function setPort(p) {
  lastPort = p;
}
export function api(p) {
  var proto = location.protocol || "";
  if (proto === "http:" || proto === "https:") return p;
  return "http://127.0.0.1:" + lastPort + p;
}
/*
  Rows a list shows before a "+N more" line (plan 2.1, Fable C2). The overlay windows are click-through
  — the mouse goes to the game — so a list that scrolled was simply cut, with nothing to say so. The
  phone HUD can scroll and shows them all.
*/
export var HUD_LIST_ROWS = 9;
export function listRowLimit(rows) {
  return document.body && document.body.classList.contains("phone") ? Infinity : rows;
}
export function moreRow(hidden) {
  var li = document.createElement("li");
  li.className = "more";
  li.textContent = "+" + hidden + " more — all of them in the app";
  return li;
}

/** Safe in text and in either kind of quoted attribute: "Barnard's Star" broke a title='…'. */
export function esc(t) {
  return String(t == null ? "" : t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
export function fmtCr(n) {
  if (n == null || !isFinite(n)) return "—";
  return Number(n).toLocaleString() + " CR";
}
export function fmtM(n) {
  if (n == null || !isFinite(n)) return "—";
  return Math.round(n) + " m";
}
/*
  The metres readout counts rather than steps.

  The radar itself is drawn exactly where each fix says (see the note above it) — that is the
  owner's call and it is about *position*, where inventing a value between two real ones means
  drawing him somewhere he was not. A number has no such problem: nobody reads 312 m as a claim
  about a specific instant, they read it as "about three hundred and closing", and a figure that
  lurches in eight-metre jumps is harder to read than one that runs.

  Short and linear. 180 ms is far shorter than the gap between fixes — Elite changes this file's
  contents about three times a minute per second of walking, median 3 s — so each count finishes
  long before the next figure lands and the number never falls behind the radar beside it.

  A big change snaps: switching body, or a row going from "—" to a distance, is not movement and
  counting through it would be a lie with a nice animation on top.
*/
export var COUNT_MS = 180;
export var COUNT_SNAP_M = 250;

export function setMetres(el, value) {
  if (el.__numRaf) {
    cancelAnimationFrame(el.__numRaf);
    el.__numRaf = 0;
  }
  if (value == null || !isFinite(value)) {
    el.__num = null;
    el.textContent = "—";
    return;
  }
  var from = typeof el.__num === "number" ? el.__num : null;
  if (from == null || Math.abs(value - from) > COUNT_SNAP_M) {
    el.__num = value;
    el.textContent = fmtM(value);
    return;
  }
  var t0 = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  var step = function () {
    el.__numRaf = 0;
    if (!el.isConnected) return;
    var at = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    var t = Math.min(1, (at - t0) / COUNT_MS);
    var v = from + (value - from) * t;
    el.__num = t >= 1 ? value : v;
    el.textContent = fmtM(el.__num);
    if (t < 1) el.__numRaf = requestAnimationFrame(step);
  };
  step();
}

export function fmtClock(ms) {
  if (!(ms >= 0)) return "";
  var s = Math.floor(ms / 1000);
  var m = Math.floor(s / 60);
  var h = Math.floor(m / 60);
  var two = function (n) {
    return (n < 10 ? "0" : "") + n;
  };
  return h > 0 ? h + ":" + two(m % 60) + ":" + two(s % 60) : two(m) + ":" + two(s % 60);
}
/** "tussock propagito" → "Tussock Propagito"; the game writes species in lower case after the genus. */
export function cap(s) {
  return String(s || "")
    .split(/\s+/)
    .map(function (w) {
      return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    })
    .join(" ");
}
export function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}
export function ls(key, def) {
  try {
    var v = localStorage.getItem(key);
    return v == null ? def : v;
  } catch (e) {
    return def;
  }
}
export function pillEl(ok) {
  if (ok === true) return ' <span class="pill ok" aria-hidden="true">OK</span>';
  if (ok === false) return ' <span class="pill bad" aria-hidden="true">LOW</span>';
  return "";
}
export function q(root, name) {
  return root.querySelector('[data-f="' + name + '"]');
}
export function head(title, status) {
  return (
    '<div class="hud-head"><span class="hud-title">' +
    esc(title) +
    '</span><span class="hud-status" data-f="status">' +
    esc(status || "Standby") +
    "</span></div>"
  );
}

/** The page's HUD object: main.js fills it; theme and audio read `serverPrefs` / `onCue` off it. */
export var HUD = {};
