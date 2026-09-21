/*
  EDEXO HUD — the overlay sections and the plumbing they share.

  Every overlay page is the same shell (hud.css) around one panel; what differs is which sections
  are inside it. A page calls `HUD.mount(["distance"])` for one section or
  `HUD.mount(["jump","fss","candidates","distance","datavalue"])` for the merged HUD, and this file
  does the rest: the markup of each section, one state feed (WebSocket first, polling as the
  fallback), per-section rendering, the radar, the colour theme, and telling the Electron host how
  tall the window has to be.

  Settings come from localStorage, which the launcher shares with these pages (same origin):
    edexoHudTheme      {"preset":"orange"} or {"preset":"custom","accent":"#rrggbb","text":"#rrggbb"}
    edexoHudCandOrder  "likelihood" (default) | "value"
    edexoHudRegion     "1" (default) | "0"  — show the current region line in the candidates card

  Plain script, no build step, works from file:// and from the local server alike.
*/
(function () {
  "use strict";

  var lastPort = 7111;
  function api(p) {
    var proto = location.protocol || "";
    if (proto === "http:" || proto === "https:") return p;
    return "http://127.0.0.1:" + lastPort + p;
  }
  function esc(t) {
    return String(t == null ? "" : t)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function fmtCr(n) {
    if (n == null || !isFinite(n)) return "—";
    return Number(n).toLocaleString() + " CR";
  }
  function fmtM(n) {
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
  var COUNT_MS = 180;
  var COUNT_SNAP_M = 250;

  function setMetres(el, value) {
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

  function fmtClock(ms) {
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
  function cap(s) {
    return String(s || "")
      .split(/\s+/)
      .map(function (w) {
        return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
      })
      .join(" ");
  }
  function norm(s) {
    return String(s || "")
      .trim()
      .toLowerCase();
  }
  function ls(key, def) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? def : v;
    } catch (e) {
      return def;
    }
  }
  function pillEl(ok) {
    if (ok === true) return ' <span class="pill ok" aria-hidden="true">OK</span>';
    if (ok === false) return ' <span class="pill bad" aria-hidden="true">LOW</span>';
    return "";
  }
  function q(root, name) {
    return root.querySelector('[data-f="' + name + '"]');
  }
  function head(title, status) {
    return (
      '<div class="hud-head"><span class="hud-title">' +
      esc(title) +
      '</span><span class="hud-status" data-f="status">' +
      esc(status || "Standby") +
      "</span></div>"
    );
  }

  /* ============================================================== colour theme ================= */
  /*
    One accent colour drives the whole panel; the rest is derived so a custom colour still gets the
    dim/faint/glow ladder the frame and rules are built from. Presets are the cockpit colours people
    actually use. Text defaults to a pale tint of the accent so it reads on dark video.
  */
  var PRESETS = {
    orange: { accent: "#ff8a1f", text: "#ffe6cf" },
    amber: { accent: "#ffb020", text: "#fff0cc" },
    red: { accent: "#ff4a3a", text: "#ffd9d4" },
    magenta: { accent: "#ff4fd8", text: "#ffd6f5" },
    purple: { accent: "#b46bff", text: "#e9d9ff" },
    blue: { accent: "#4fa8ff", text: "#d6e9ff" },
    cyan: { accent: "#3fe0e0", text: "#d2fbfb" },
    green: { accent: "#5fe07a", text: "#d9f8de" },
    lime: { accent: "#c8f04a", text: "#f1fbd2" },
    white: { accent: "#e8e8f0", text: "#ffffff" },
  };
  function hexRgb(h) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(h || "").trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(c, a) {
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
  }
  function mix(c, w, t) {
    return [
      Math.round(c[0] + (w[0] - c[0]) * t),
      Math.round(c[1] + (w[1] - c[1]) * t),
      Math.round(c[2] + (w[2] - c[2]) * t),
    ];
  }
  function toHex(c) {
    return (
      "#" +
      c
        .map(function (v) {
          return (v < 16 ? "0" : "") + v.toString(16);
        })
        .join("")
    );
  }
  /*
    Phone mode (owner, 2026-09-13, task 13): `?phone=1` on the merged page. A phone has its own
    localStorage, so the settings come from the server's mirror of the launcher (`d.hudPrefs`),
    which the launcher writes on every change. On the PC the local keys still win.
  */
  var PHONE = /[?&]phone=1(&|$)/.test(String(location.search || ""));
  function serverPref(key) {
    var p = HUD.serverPrefs;
    if (!p) return null;
    if (key === "edexoHudTheme") return p.theme ? JSON.stringify(p.theme) : null;
    if (key === "edexoHudScale") return typeof p.scale === "number" ? String(p.scale) : null;
    if (key === "edexoHudOpacity") return typeof p.opacity === "number" ? String(p.opacity) : null;
    if (key === "edexoHudCandOrder") return p.candOrder || null;
    if (key === "edexoHudRegion") return typeof p.region === "boolean" ? (p.region ? "1" : "0") : null;
    if (key === "edexoHudAudio") return typeof p.audio === "boolean" ? (p.audio ? "1" : "0") : null;
    return null;
  }
  function pref(key, def) {
    var v = PHONE ? null : ls(key, null);
    if (v == null) v = serverPref(key);
    return v == null ? def : v;
  }
  function readTheme() {
    var t = {};
    try {
      t = JSON.parse(pref("edexoHudTheme", "{}")) || {};
    } catch (e) {
      t = {};
    }
    var preset = PRESETS[t.preset] || null;
    var accent =
      hexRgb(t.preset === "custom" ? t.accent : preset ? preset.accent : PRESETS.orange.accent) ||
      hexRgb(PRESETS.orange.accent);
    var text =
      hexRgb(t.preset === "custom" ? t.text : preset ? preset.text : PRESETS.orange.text) ||
      mix(accent, [255, 255, 255], 0.78);
    return { accent: accent, text: text };
  }
  /*
    Size and panel opacity (owner, 2026-09-13): two sliders in the launcher, remembered like the
    colour. Scale multiplies the root font size, so every rem in the page follows; the host widens
    the window by the same factor (see reportHeight). Opacity is the panel fill's alpha.
  */
  function clampNum(v, lo, hi, def) {
    var n = parseFloat(v);
    if (!isFinite(n)) return def;
    return Math.min(hi, Math.max(lo, n));
  }
  function readScale() {
    // The phone has its own size: the launcher's slider is for the overlay on the game screen.
    if (PHONE) return 1;
    return clampNum(pref("edexoHudScale", "1"), 0.5, 2, 1);
  }
  /*
    Background opacity (owner, 2026-09-14): the panel fill's alpha only — text, icons and lines
    stay solid, and the fill keeps its colour; the slider decides how much of the game shows
    through it. 42 % is the design default.
  */
  function readOpacity() {
    if (PHONE) return 0.7;
    return clampNum(pref("edexoHudOpacity", "0.45"), 0.1, 1, 0.45);
  }
  function applyTheme() {
    var th = readTheme();
    var a = th.accent;
    var st = document.documentElement.style;
    st.fontSize = Math.round(readScale() * 100) + "%";
    /*
      The slider runs from clear to a dark orange panel (owner, 2026-09-14: "not a second sun"):
      the fill is a near-black orange whose alpha follows the slider up to 92 %, the frame hairline
      dims with it. 45 % is roughly the old default look.
    */
    var t = readOpacity();
    st.setProperty("--hud-bg-opacity", String(t));
    st.setProperty("--hud", toHex(a));
    st.setProperty("--hud-hi", toHex(mix(a, [255, 255, 255], 0.35)));
    st.setProperty("--hud-text", toHex(th.text));
    st.setProperty("--hud-dim", rgba(a, 0.55));
    st.setProperty("--hud-faint", rgba(a, 0.22));
    st.setProperty("--hud-ghost", rgba(a, 0.1));
    st.setProperty("--hud-bg", rgba(mix(a, [0, 0, 0], 0.9), Math.round(92 * t) / 100));
    st.setProperty("--hud-bg-2", rgba(mix(a, [0, 0, 0], 0.8), Math.round(35 * t) / 100));
    st.setProperty("--hud-glow", "0 0 6px " + rgba(a, 0.45));
  }

  /* ============================================================== Audio cues =================== */
  /*
    Two short tones, off by default (owner, 2026-09-13): one when the min-gap ring is cleared after
    a sample, a two-note chime when the third sample lands. Synthesised, no asset. The tracker's
    render calls `cueFromOverlay` with each snapshot and the cue fires on the edge, once.
  */
  var audioCtx = null;
  function audioOn() {
    return pref("edexoHudAudio", "0") === "1";
  }
  function tone(freq, atMs, durMs, gain) {
    if (!audioCtx) return;
    var t0 = audioCtx.currentTime + atMs / 1000;
    var o = audioCtx.createOscillator();
    var g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(t0);
    o.stop(t0 + durMs / 1000 + 0.02);
  }
  function playCue(kind) {
    if (typeof HUD.onCue === "function") HUD.onCue(kind);
    if (!audioOn()) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === "suspended" && typeof audioCtx.resume === "function") void audioCtx.resume();
      if (kind === "clear") {
        tone(880, 0, 120, 0.18);
      } else if (kind === "third") {
        tone(660, 0, 140, 0.18);
        tone(990, 150, 220, 0.2);
      }
    } catch (e) {
      /* no audio device, or the page is not allowed to play: the cue is optional */
    }
  }
  var cuePrev = { key: "", count: 0, clear: false };
  function cueFromOverlay(eo) {
    if (!eo || !eo.visible) {
      cuePrev = { key: "", count: 0, clear: false };
      return;
    }
    /*
      A frame that does not know how far the nearest plant is changes nothing.

      `nearestSampleMeetsMin` is null when there is no position to measure from. Treating that as
      "not far enough" armed the cue again, so the next frame that *did* know looked like a fresh
      crossing and played the tone — once per radar update rather than once per boundary. The server
      no longer manufactures those nulls (it stops reporting a fix lost to a torn read at all), and
      this makes the HUD indifferent to them whatever their source.
    */
    if (eo.nearestSampleMeetsMin == null && (eo.sampleCount === 1 || eo.sampleCount === 2)) return;
    var key = String(eo.bodyKeyOnFoot || "") + "|" + String(eo.speciesDisplay || "");
    var count = Math.max(0, Math.min(3, eo.sampleCount || 0));
    var clear = eo.nearestSampleMeetsMin === true && (count === 1 || count === 2);
    var same = key === cuePrev.key;
    if (same && count === 3 && cuePrev.count < 3) playCue("third");
    else if (same && clear && !cuePrev.clear && count === cuePrev.count) playCue("clear");
    cuePrev = { key: key, count: count, clear: clear };
  }

  /* ============================================================== Next jump ==================== */
  /*
    StarClass from `StartJump`. Scoopable main-sequence classes are the game's KGBFOAM rule; the
    rest earns a yellow triangle (no fuel there), a black hole a red one, a neutron star a blue one
    for those who boost. Everything else the journal can write (white dwarfs, T Tauri, Herbig,
    Wolf-Rayet, carbon stars) is simply "not scoopable".
  */
  function starKind(cls) {
    var c = String(cls || "").toUpperCase();
    if (!c) return { kind: "unknown", label: "?", note: "Star class unknown" };
    if (c === "H" || c === "SUPERMASSIVEBLACKHOLE")
      return {
        kind: "hole",
        label: c === "H" ? "Black hole" : "Supermassive black hole",
        note: "Black hole — no scoop, drop out early",
      };
    if (c === "N")
      return { kind: "neutron", label: "Neutron star", note: "Neutron star — jet cone boost, no scoop" };
    if (/^[KGBFOAM]$/.test(c)) return { kind: "scoop", label: c + " class", note: "Scoopable" };
    return { kind: "noscoop", label: c, note: "Not scoopable" };
  }
  var jump = {
    title: "Next jump",
    html: function () {
      return (
        head("Next jump", "No jump") +
        '<div class="jump" data-f="jump">' +
        '<div class="jump__tri" data-f="tri" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 22 20H2Z"/><path class="jump__mark" d="M12 9v5M12 16.5v1"/></svg></div>' +
        '<div class="jump__body">' +
        '<div class="hud-big jump__sys" data-f="sys">—</div>' +
        '<div class="jump__cls"><span class="jump__star" data-f="star">—</span><span class="jump__note" data-f="note"></span></div>' +
        "</div></div>" +
        '<div class="jump__route" data-f="route" hidden></div>'
      );
    },
    render: function (d, root) {
      var jt = d.jumpTarget;
      var status = q(root, "status");
      var box = q(root, "jump");
      renderRouteStrip(d, q(root, "route"));
      if (!jt || !jt.starSystem) {
        status.textContent = "No jump";
        box.className = "jump jump--none";
        q(root, "sys").textContent = "—";
        q(root, "star").textContent = "—";
        q(root, "note").textContent = "";
        return null;
      }
      var k = starKind(jt.starClass);
      var src = jt.source || "jump";
      status.textContent =
        src === "target"
          ? "Targeted"
          : src === "route"
            ? "Next on route"
            : jt.arrived
              ? "Arrived"
              : "Jumping";
      /*
        The triangle keeps its star-class colour. An earlier version turned it blue for an unvisited
        system and the owner asked for it back: the colour there already answers "is there fuel",
        which is the question the triangle exists for. The note below carries the other fact in
        words.
      */
      box.className = "jump jump--" + k.kind + (jt.arrived ? " jump--arrived" : "") + " jump--src-" + src;
      q(root, "sys").textContent = jt.starSystem;
      q(root, "star").textContent = k.label;
      q(root, "note").textContent =
        jt.likelyFirstFootfall === true && !jt.arrived ? k.note + " · nobody has been here" : k.note;
      return null;
    },
  };

  /*
    The route strip under the card (owner, 2026-09-13): the next hops as star-class letters in the
    KGBFOAM colours, a fuel pump on the star where the tank says to scoop — yellow to plan on it,
    red when skipping it means running dry. `⛽ +N` when that star is beyond the hops shown.
  */
  function fuelPump(level) {
    return (
      '<svg class="hop__fuel hop__fuel--' +
      level +
      '" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15M4 20h12M7 7h6v4H7zM15 10h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0v-7l-2.5-2.5"/></svg>'
    );
  }
  function renderRouteStrip(d, el) {
    if (!el) return;
    var nav = d.liveShipFuelRange && d.liveShipFuelRange.navRoute;
    var hops = nav && nav.ahead ? nav.ahead : [];
    if (!hops.length) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    var html = "";
    for (var i = 0; i < hops.length; i++) {
      var h = hops[i];
      var k = starKind(h.starClass);
      /*
        Blue arrow when nobody appears to have been to the system it points at.

        The arrow only — the hop itself keeps the star-class colour it has always had, which is the
        fuel question and is not this one. The flag is asymmetric on purpose (see
        server/firstFootfallLookup.ts): false means someone has certainly been and uploaded it, true
        means nobody who uploads has, and null means the lookup has not answered, which keeps the
        ordinary colour rather than guessing either way.
      */
      var firstHere = h.likelyFirstFootfall === true;
      html +=
        (i
          ? '<span class="hop__sep' + (firstHere ? " hop__sep--first" : "") + '" aria-hidden="true">››</span>'
          : "") +
        '<span class="hop hop--' +
        k.kind +
        '" title="' +
        esc(h.starSystem + " — " + k.label + (firstHere ? " — nobody has been here" : "")) +
        '">' +
        esc(h.starClass || "?") +
        (h.refuel && h.refuel !== "none" ? fuelPump(h.refuel) : "") +
        "</span>";
    }
    if (nav.refuelInHops != null && nav.refuelInHops > hops.length && nav.refuelLevel !== "none") {
      html +=
        '<span class="hop__sep" aria-hidden="true">››</span><span class="hop hop--beyond" title="Scoop in ' +
        nav.refuelInHops +
        ' jumps">' +
        fuelPump(nav.refuelLevel) +
        "+" +
        (nav.refuelInHops - hops.length) +
        "</span>";
    } else if (nav.refuelInHops == null && nav.refuelLevel === "red") {
      // the tank cannot finish the plot and no scoopable star is within reach: say so at the end
      html +=
        '<span class="hop__sep" aria-hidden="true">››</span><span class="hop hop--beyond hop--dry" title="No scoopable star within reach on this tank">' +
        fuelPump("red") +
        "!</span>";
    }
    el.innerHTML = html;
    el.hidden = false;
    fitRouteStrip(el, hops, nav);
  }
  /*
    One row, no wrapping (owner, 2026-09-14): drop hops off the end until the strip fits its width.
    If the pump's hop is cut, a "+N" with the pump takes the last place so the scoop is never lost.
  */
  /**
   * Trim the strip to the width it has, and report how many hops survived.
   *
   * The count is the row's own answer to "how many are on screen", which depends on the HUD's width
   * and scale and on how long the star classes are — it is not a constant and cannot be assumed. It
   * is written back to the element so anything downstream reads the number that was actually drawn
   * rather than the number that was sent.
   */
  function fitRouteStrip(el, hops, nav) {
    var pumpIdx = -1;
    for (var i = 0; i < hops.length; i++) if (hops[i].refuel && hops[i].refuel !== "none") pumpIdx = i;
    var guard = 0;
    var shown = el.querySelectorAll(".hop:not(.hop--beyond)").length;
    while (el.scrollWidth > el.clientWidth + 1 && guard++ < 60) {
      var kids = el.children;
      if (kids.length < 3) break;
      // remove the last hop and the separator before it
      el.removeChild(kids[kids.length - 1]);
      if (el.lastElementChild && el.lastElementChild.classList.contains("hop__sep"))
        el.removeChild(el.lastElementChild);
      shown = el.querySelectorAll(".hop:not(.hop--beyond)").length;
      if (pumpIdx >= shown && !el.querySelector(".hop--beyond")) {
        var tail = document.createElement("span");
        tail.className = "hop hop--beyond";
        tail.title = "Scoop in " + (pumpIdx + 1) + " jumps";
        tail.innerHTML = fuelPump(hops[pumpIdx].refuel) + "+" + (pumpIdx + 1 - shown);
        var sep = document.createElement("span");
        sep.className = "hop__sep";
        sep.setAttribute("aria-hidden", "true");
        sep.textContent = "››";
        el.appendChild(sep);
        el.appendChild(tail);
      }
    }
    shown = el.querySelectorAll(".hop:not(.hop--beyond)").length;
    el.dataset.shown = String(shown);
    el.dataset.of = String(hops.length);
    /*
      The whole plot is rarely on screen. Saying which part of it this is costs nothing and stops the
      strip reading as the entire route when it is the first thirteen hops of forty.
    */
    el.title = shown >= hops.length ? shown + " jumps ahead" : shown + " of " + hops.length + " jumps ahead";
    return shown;
  }

  /* ============================================================== Discovery scan (FSS honk) ==== */
  var fss = {
    title: "Discovery scan",
    html: function () {
      return (
        head("Discovery scan") +
        '<div class="fss-line" data-f="dline"><span class="sys">—</span><span class="nums">— / —<small>bodies</small></span></div>' +
        '<div class="hud-bar" aria-hidden="true"><div class="hud-bar__fill" data-f="bar"></div><div class="hud-bar__ticks"></div></div>' +
        '<div class="hud-note">Honk progress against bodies found, same as the main D-Scan readout.</div>'
      );
    },
    render: function (d, root) {
      var dscan = d.dScanBodies;
      var status = q(root, "status");
      var bar = q(root, "bar");
      if (!dscan || dscan.total == null) {
        status.textContent = "Standby";
        bar.style.width = "0%";
        q(root, "dline").innerHTML =
          "<span class='sys'>—</span><span class='nums'>— / —<small>bodies</small></span>";
        return null;
      }
      var complete = dscan.complete || dscan.found >= dscan.total;
      var sys = dscan.systemName || "—";
      var pct = dscan.total > 0 ? Math.max(0, Math.min(100, (dscan.found / dscan.total) * 100)) : 0;
      bar.style.width = pct.toFixed(1) + "%";
      status.textContent = complete ? "Complete" : "Scanning " + Math.round(pct) + "%";
      q(root, "dline").innerHTML =
        "<span class='sys' title='" +
        esc(sys) +
        "'>" +
        esc(sys) +
        "</span><span class='nums'>" +
        dscan.found +
        " / " +
        dscan.total +
        "<small>bodies</small></span>";
      return complete ? "ok" : null;
    },
  };

  /* ============================================================== Exo candidates ============== */
  function speciesOnly(entry) {
    var g = (entry.genus || "").trim();
    var d = (entry.displayName || "").trim();
    if (!g) return d || "—";
    var pref = g + " ";
    if (d.length >= pref.length && d.substring(0, pref.length).toLowerCase() === pref.toLowerCase()) {
      var rest = d.substring(pref.length).trim();
      return rest || d;
    }
    return d || "—";
  }
  function bodyByKey(d, key) {
    if (!key) return null;
    var bodies = d.bodies || [];
    for (var i = 0; i < bodies.length; i++) {
      if (((bodies[i].state || {}).key || "") === key) return bodies[i];
    }
    if (d.exoOverlayFocusBody && ((d.exoOverlayFocusBody.state || {}).key || "") === key)
      return d.exoOverlayFocusBody;
    return null;
  }
  /*
    Which body the list is about.

    The targeted body wins when the game reports one (`Status.json` `Destination`): the commander
    finishing a plant on C 2 with C 3 targeted wants C 3's list already. Otherwise the app's focus:
    the body being sampled, else the tab selected in the UI, else the last touchdown.
  */
  function resolveListBody(d) {
    var dest = d.statusDestination;
    var focusKey = d.exoOverlayFocusBodyKey || null;
    if (dest && dest.bodyId > 0 && dest.name) {
      var key = String(dest.systemAddress) + ":" + String(dest.bodyId);
      if (key !== focusKey) {
        var tb = bodyByKey(d, key);
        return { body: tb, key: key, name: dest.name, target: true };
      }
    }
    if (!focusKey) return null;
    var fb = bodyByKey(d, focusKey);
    return {
      body: fb,
      key: focusKey,
      name: fb ? fb.tabLabel || (fb.state || {}).bodyName || focusKey : focusKey,
      target: false,
    };
  }
  /**
   * Same rule as the app's candidate list: the unlikely tier stays hidden — unless something has
   * actually confirmed the species on this body (a completed analysis, a genus lock from an on-foot
   * scan, or the run in progress), in which case it is shown whatever the matcher thinks.
   */
  function speciesProgress(m, st, eo, bodyKey) {
    var e = m.entry || {};
    var name = norm(e.displayName);
    if (m.organicAnalysisComplete) return { text: "3/3", cls: "done", confirmed: true };
    if (eo && eo.visible === true && eo.trackingBodyKey === bodyKey && norm(eo.speciesDisplay) === name) {
      var n = Math.max(0, Math.min(3, eo.sampleCount || 0));
      return { text: n + "/3", cls: "live", confirmed: true };
    }
    var locks = (st && st.organicGenusLocks) || [];
    for (var i = 0; i < locks.length; i++) {
      if (norm(locks[i].speciesLocalised) === name) return { text: "seen", cls: "seen", confirmed: true };
    }
    return null;
  }
  var candidates = {
    title: "Exo candidates",
    html: function () {
      return (
        head("Exo candidates", "Waiting for journal") +
        '<div class="facts">' +
        '<span class="fact fact--body"><span class="k" data-f="bodyK">Body</span><span class="v dim" data-f="body">—</span></span>' +
        '<span class="fact"><span class="k">Bio signals</span><span class="v dim" data-f="sig">—</span></span>' +
        '<span class="fact"><span class="k">DSS</span><span class="v dim" data-f="dss">—</span></span>' +
        "</div>" +
        '<div class="region" data-f="region" style="display:none"><span class="k">Region</span><span class="v" data-f="regionV">—</span></div>' +
        '<ul class="hud-list" data-f="list"></ul>'
      );
    },
    render: function (d, root) {
      var status = q(root, "status");
      var ul = q(root, "list");
      var showRegion = pref("edexoHudRegion", "1") !== "0";
      var regionEl = q(root, "region");
      var regionName = d.currentRegion && d.currentRegion.name ? d.currentRegion.name : null;
      regionEl.style.display = showRegion && regionName ? "" : "none";
      if (regionName) q(root, "regionV").textContent = regionName;
      function facts(body, sig, dss, target) {
        var b = q(root, "body"),
          s = q(root, "sig"),
          x = q(root, "dss");
        q(root, "bodyK").textContent = target ? "Target body" : "Body";
        b.textContent = body || "—";
        b.className = "v" + (body ? "" : " dim") + (target ? " tgt" : "");
        b.title = body || "";
        s.textContent = sig || "—";
        s.className = "v" + (sig ? "" : " dim");
        x.textContent = dss == null ? "—" : dss ? "Yes" : "No";
        x.className = "v" + (dss == null ? " dim" : dss ? " yes" : "");
      }
      function plain(text) {
        ul.innerHTML = "";
        var li = document.createElement("li");
        li.className = "plain";
        li.textContent = text;
        ul.appendChild(li);
      }
      if (d.journalBoot) {
        status.textContent = "Journal loading";
        facts(null, null, null, false);
        ul.innerHTML = "";
        return null;
      }
      var pick = resolveListBody(d);
      if (!pick) {
        status.textContent = "No focus";
        facts(null, null, null, false);
        plain("Select a body in the app, target one, or land to sync focus.");
        return null;
      }
      var bc = pick.body;
      if (!bc) {
        status.textContent = pick.target ? "Target" : "No data";
        facts(pick.name, null, null, pick.target);
        plain(
          pick.target
            ? "No exobiology data for this body yet — FSS or DSS it."
            : "No exobiology data for this body.",
        );
        return null;
      }
      var st = bc.state || {};
      var label = (bc.tabLabel || st.bodyName || st.key || "").trim() || pick.name || "—";
      var sig = st.biologicalSignals;
      var bioZero = sig === 0;
      var eo = d.exoOrganicOverlay;
      var all = bc.matches || [];
      var rows = [];
      for (var i = 0; i < all.length; i++) {
        var m = all[i];
        var prog = speciesProgress(m, st, eo, pick.key);
        if (m.unlikely && !(prog && prog.confirmed)) continue;
        rows.push({ m: m, prog: prog });
      }
      // The app's order (genus likelihood from the co-occurrence solver, then as delivered), or by
      // credits when the owner has asked for the value lens.
      var byValue = pref("edexoHudCandOrder", "likelihood") === "value";
      var rank = {};
      (bc.genusLikelihoods || []).forEach(function (l, idx) {
        if (l && l.genus) rank[norm(l.genus)] = idx;
      });
      rows.forEach(function (r, idx) {
        r.idx = idx;
        var g = norm((r.m.entry || {}).genus);
        r.rank = rank.hasOwnProperty(g) ? rank[g] : 9999;
        r.cr = r.m.priceCredits != null && isFinite(r.m.priceCredits) ? Number(r.m.priceCredits) : -1;
      });
      rows.sort(function (a, b) {
        return byValue ? b.cr - a.cr || a.idx - b.idx : a.rank - b.rank || a.idx - b.idx;
      });
      var xCount = bioZero ? 0 : rows.length;
      status.textContent =
        (pick.target ? "Target · " : "") +
        (bioZero ? "No biology" : xCount + " candidate" + (xCount === 1 ? "" : "s")) +
        (byValue && !bioZero ? " · by value" : "");
      facts(label, xCount + " / " + (sig == null ? "—" : String(sig)), st.dssComplete === true, pick.target);
      ul.innerHTML = "";
      if (bioZero) return null;
      if (!rows.length) {
        plain("No candidate species");
        return null;
      }
      rows.forEach(function (r) {
        var m = r.m;
        var e = m.entry || {};
        var genus = cap((e.genus || "").trim() || "—");
        var sp = cap(speciesOnly(e));
        var li = document.createElement("li");
        if (r.prog) li.className = "has-" + r.prog.cls;
        var name = document.createElement("span");
        name.className = "name";
        var em = document.createElement("em");
        em.textContent = genus + " ";
        name.appendChild(em);
        name.appendChild(document.createTextNode(sp));
        if (r.prog) {
          var pg = document.createElement("span");
          pg.className = "prog prog--" + r.prog.cls;
          pg.textContent = r.prog.text;
          name.appendChild(pg);
        }
        var cr = document.createElement("span");
        cr.className = "cr";
        cr.textContent = r.cr >= 0 ? r.cr.toLocaleString() + " CR" : "— CR";
        li.appendChild(name);
        li.appendChild(cr);
        li.title = (genus + " " + sp).trim();
        ul.appendChild(li);
      });
      return null;
    },
  };

  /* ============================================================== Exo-distance tracker ======== */
  /*
    Green is reserved for the run in progress. The game samples one species per planet at a time,
    so every other mark on this rock is a leftover from something the commander is no longer
    collecting. They still belong on the map -- they are places worth not walking back to -- but
    drawing them the same green is how you end up reading a Stratum mark as the Tussock you are
    three samples into. The colour is a hash of the species name, so a species keeps the same
    colour for as long as it is on screen, and no palette entry is green.
  */
  var LEFTOVER_COLOURS = [
    "#c9a227",
    "#b25fd0",
    "#3fa7d6",
    "#e06c4a",
    "#d05a86",
    "#5a8bd0",
    "#a8842c",
    "#8c6fd0",
  ];
  function leftoverColour(label) {
    var h = 0;
    var t = String(label || "");
    for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    return LEFTOVER_COLOURS[h % LEFTOVER_COLOURS.length];
  }

  var MAP_R = 100;
  /*
    The radar has two layers. The rim, rings, crosshair and the rotating sweep never change and are
    built once; only the world (marks, ticks, North) is rebuilt on each snapshot. Rebuilding the whole
    SVG every 320 ms restarted the sweep's CSS animation every time, which is what made it jerk.
  */
  function radarStatic(svg) {
    if (svg.__staticBuilt) return;
    svg.__staticBuilt = true;
    svg.innerHTML =
      '<defs><linearGradient id="hudSweepGrad" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0" stop-color="currentColor" stop-opacity="0"/>' +
      '<stop offset="1" stop-color="currentColor" stop-opacity="0.28"/></linearGradient></defs>' +
      '<circle class="minimap-rim-outer" cx="0" cy="0" r="' +
      (MAP_R + 7) +
      '" />' +
      '<circle class="minimap-rim" cx="0" cy="0" r="' +
      MAP_R +
      '" />' +
      '<circle class="minimap-grid" cx="0" cy="0" r="' +
      MAP_R / 4 +
      '" />' +
      '<circle class="minimap-grid" cx="0" cy="0" r="' +
      MAP_R / 2 +
      '" />' +
      '<circle class="minimap-grid" cx="0" cy="0" r="' +
      (MAP_R * 3) / 4 +
      '" />' +
      '<line class="minimap-cross" x1="-' +
      MAP_R +
      '" y1="0" x2="' +
      MAP_R +
      '" y2="0" />' +
      '<line class="minimap-cross" x1="0" y1="-' +
      MAP_R +
      '" x2="0" y2="' +
      MAP_R +
      '" />' +
      '<path class="minimap-sweep" style="color:var(--hud)" d="M0,0 L' +
      MAP_R +
      ",0 A" +
      MAP_R +
      "," +
      MAP_R +
      " 0 0,0 0,-" +
      MAP_R +
      '" />' +
      '<g class="mm-world"></g><g class="mm-you"></g>';
  }
  function arcPath(r, a0, a1) {
    var p = function (a) {
      var t = (a * Math.PI) / 180;
      return [(r * Math.cos(t)).toFixed(1), (r * Math.sin(t)).toFixed(1)];
    };
    var s = p(a0),
      e = p(a1);
    var large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    return "M" + s[0] + "," + s[1] + " A" + r + "," + r + " 0 " + large + ",1 " + e[0] + "," + e[1];
  }
  /**
   * Draw the world layer of the radar.
   *
   * Plot units are a 100-unit radius circle; metres are scaled into it. Anything beyond the radius
   * becomes an arrow on the rim with its distance beside it, which is the owner's rule and also the
   * only honest way to show it — clamping a 3 km plant to the edge as a dot would say it is 500 m
   * away. "Up" is the way the commander is facing when the game reports a heading. Without one it
   * stays north-up and the label stays visible so the difference is not silent.
   *
   * `hint` (optional): when the second sample would be too close, an arc on the min-gap ring facing
   * away from the first sample — the direction to walk. Nothing is drawn when the sample is not on
   * the map, because a guess would be worse than no arrow.
   */
  function drawMinimapAt(svg, mm, hint) {
    if (!mm || !mm.marks) return false;
    radarStatic(svg);
    var heading = typeof mm.headingDeg === "number" && isFinite(mm.headingDeg) ? mm.headingDeg : null;
    var rot = heading == null ? 0 : -heading; // rotating the scene by -heading puts "ahead" at the top
    var scale = MAP_R / (mm.radiusM > 0 ? mm.radiusM : 500);
    var parts = [];
    var minR = mm.minSampleDistanceM > 0 ? mm.minSampleDistanceM * scale : 0;
    if (minR > 0 && minR < MAP_R) {
      parts.push('<circle class="minimap-minring" cx="0" cy="0" r="' + minR.toFixed(1) + '" />');
    }
    parts.push('<g transform="rotate(' + rot.toFixed(2) + ')">');
    for (var t = 0; t < 360; t += 30) {
      var major = t % 90 === 0;
      parts.push(
        '<line class="minimap-tick' +
          (major ? " minimap-tick--major" : "") +
          '" x1="0" y1="-' +
          MAP_R +
          '" x2="0" y2="-' +
          (MAP_R + (major ? 7 : 4)) +
          '" transform="rotate(' +
          t +
          ')" />',
      );
    }
    var firstActive = null;
    for (var i = 0; i < mm.marks.length; i++) {
      var m = mm.marks[i];
      var x = m.eastM * scale;
      var y = -m.northM * scale; // SVG y grows downward and north is up
      var r = Math.sqrt(x * x + y * y);
      var cls = m.kind === "ship" ? "ship" : "sample";
      if (m.kind === "sample" && m.active && !firstActive) firstActive = { x: x, y: y };
      var tint = m.kind === "sample" && !m.active ? ' style="fill:' + leftoverColour(m.label) + '"' : "";
      var title = "<title>" + esc(m.label) + " — " + Math.round(m.distanceM) + " m</title>";
      if (r <= MAP_R - 6) {
        if (m.kind === "ship") {
          parts.push(
            '<g transform="translate(' +
              x.toFixed(1) +
              "," +
              y.toFixed(1) +
              ") rotate(" +
              (-rot).toFixed(2) +
              ')"><polygon class="minimap-ship" points="0,-5.5 5,4.5 0,2.2 -5,4.5" />' +
              title +
              "</g>",
          );
        } else {
          parts.push(
            '<rect class="minimap-sample"' +
              tint +
              ' x="-3.2" y="-3.2" width="6.4" height="6.4" transform="translate(' +
              x.toFixed(1) +
              "," +
              y.toFixed(1) +
              ') rotate(45)">' +
              title +
              "</rect>",
          );
        }
      } else {
        var ang = (Math.atan2(y, x) * 180) / Math.PI;
        var ax = Math.cos((ang * Math.PI) / 180) * (MAP_R - 8);
        var ay = Math.sin((ang * Math.PI) / 180) * (MAP_R - 8);
        parts.push(
          '<g transform="translate(' +
            ax.toFixed(1) +
            "," +
            ay.toFixed(1) +
            ") rotate(" +
            ang.toFixed(1) +
            ')"><polygon class="minimap-arrow--' +
            cls +
            '"' +
            tint +
            ' points="7,0 -3,-4.5 -3,4.5" />' +
            title +
            "</g>",
        );
        parts.push(
          '<text class="minimap-far-label" x="' +
            (ax * 0.8).toFixed(1) +
            '" y="' +
            (ay * 0.8).toFixed(1) +
            '" text-anchor="middle" transform="rotate(' +
            (-rot).toFixed(2) +
            "," +
            (ax * 0.8).toFixed(1) +
            "," +
            (ay * 0.8).toFixed(1) +
            ')">' +
            Math.round(m.distanceM) +
            "</text>",
        );
      }
    }
    // The way to walk: the min-gap ring, on the side away from the first sample.
    if (hint && firstActive && minR > 0) {
      var away = (Math.atan2(firstActive.y, firstActive.x) * 180) / Math.PI + 180;
      var rr = Math.min(minR + 6, MAP_R - 4);
      parts.push('<path class="minimap-hint" d="' + arcPath(rr, away - 55, away + 55) + '" />');
      parts.push(
        '<polygon class="minimap-hint-arrow" transform="rotate(' +
          away.toFixed(1) +
          ") translate(" +
          (rr + 4).toFixed(1) +
          ',0)" points="0,-4 6,0 0,4" />',
      );
    }
    parts.push(
      '<text class="minimap-north" x="0" y="' +
        (-MAP_R + 13) +
        '" text-anchor="middle" transform="rotate(' +
        (-rot).toFixed(2) +
        ",0," +
        (-MAP_R + 13) +
        ')">NORTH</text>',
    );
    parts.push("</g>");
    svg.querySelector(".mm-world").innerHTML = parts.join("");
    svg.querySelector(".mm-you").innerHTML =
      heading == null
        ? '<circle class="minimap-you" cx="0" cy="0" r="3.5" />'
        : '<polygon class="minimap-you" points="0,-7.5 5,4.5 0,1.8 -5,4.5" />';
    return true;
  }

  /*
    ============================ the radar predicts forward ============================

    `Status.json` is the only place a position exists, and it changes about **0.33 times a second** —
    measured while running and turning on foot: median gap 3.0 s, fastest 2.0 s. It is already read
    within milliseconds of each write (the file is watched, not polled), so nothing on this side can
    make it arrive sooner. A radar drawn straight from it steps once every three seconds.

    A tween was tried and removed. It walked from the previous fix to the newest one, which looks
    smooth and is *backwards*: it shows where the commander was up to three seconds ago, and the
    dots drift toward him as it catches up — which is exactly what he disliked.

    This is the opposite sign of error. The last two fixes give a velocity; between fixes the radar
    continues at that velocity, so it shows where he **is**, estimated, rather than where he was. The
    dots hold still relative to the ground while he moves through them, which is what walking
    actually looks like. Each new fix replaces the estimate with the truth.

    Every mark is world-fixed — plants and a parked ship do not move — so between two fixes they all
    shift by the same amount, and that shift is the commander's own movement with the sign flipped.
    The median of those shifts is therefore a robust velocity, and it lets a mark that appeared only
    in the newest fix be carried along with the rest instead of sitting frozen among moving dots.

    Bounded on purpose:

      - prediction stops at PREDICT_MAX_GAPS gaps. Walk, stop, and the dots settle a beat later
        rather than sailing off the map while the game says nothing.
      - a gap outside PREDICT_MIN_GAP_MS..PREDICT_MAX_GAP_MS is not a walking cadence — a pause, a
        menu, a first frame — so no velocity is taken from it.
      - heading is never predicted at all. Position is worth predicting because walking is
        continuous; mouse-look is not — it starts and stops instantly, so the angle between two
        fixes is a flick that already finished, not a rate. Projecting it kept the radar turning
        after the commander had stopped, and since the world layer rotates about him every dot
        swung with it, which reads as drift even walking in a straight line. Capping the predicted
        turn at the observed one was not enough: half of a flick that is over is still a turn that
        is not happening.

    `prefers-reduced-motion` disables all of it and draws each fix exactly, which is also what
    happens before two fixes have been seen.
  */
  /**
   * Whether the radar continues the commander's motion between fixes.
   *
   * **Off, on the owner's report after flying it (2026-09-21): "the radar dots keep drifting away
   * when I move — make them fixed in place and updated dynamically without drifting."**
   *
   * The reasoning below still holds for walking in a straight line, and the machinery is left intact
   * because that case is real. What it cannot handle is the ordinary one: position is predicted and
   * heading deliberately is not, so a commander who turns while walking has the dots pushed along
   * his *old* bearing while the world layer stays put. Every fix then snaps them back. Smooth,
   * wrong, and it reads exactly as the drift he described.
   *
   * With this off each fix is drawn exactly as it arrives: the marks hold their world positions and
   * step when `Status.json` says they moved, about once every three seconds. That is the behaviour
   * he asked for, and it is what `prefers-reduced-motion` has always done.
   */
  var PREDICT_ENABLED = false;
  var PREDICT_MAX_GAPS = 1.5;
  var PREDICT_MIN_GAP_MS = 200;
  var PREDICT_MAX_GAP_MS = 8000;
  /** Below this the commander is standing still; predicting it only adds jitter. */
  var PREDICT_MIN_SPEED_M = 0.05;

  function markKey(m) {
    return m.kind + "|" + m.label;
  }

  function median(xs) {
    if (!xs.length) return 0;
    var s = xs.slice().sort(function (a, b) {
      return a - b;
    });
    return s[Math.floor(s.length / 2)];
  }

  function cloneMinimap(mm) {
    return {
      radiusM: mm.radiusM,
      headingDeg: mm.headingDeg,
      minSampleDistanceM: mm.minSampleDistanceM,
      marks: mm.marks.map(function (m) {
        return {
          kind: m.kind,
          label: m.label,
          active: m.active,
          northM: m.northM,
          eastM: m.eastM,
          distanceM: m.distanceM,
        };
      }),
    };
  }

  /** How far every mark moved between two fixes — the commander's movement, negated. */
  function motionBetween(prev, next) {
    var by = {};
    for (var i = 0; i < prev.marks.length; i++) by[markKey(prev.marks[i])] = prev.marks[i];
    var dN = [];
    var dE = [];
    for (var j = 0; j < next.marks.length; j++) {
      var m = next.marks[j];
      var p = by[markKey(m)];
      if (!p) continue;
      dN.push(m.northM - p.northM);
      dE.push(m.eastM - p.eastM);
    }
    if (!dN.length) return null;
    return { north: median(dN), east: median(dE) };
  }

  /** The radar as it should look `t` ms after the newest fix. */
  function predictMinimap(st, t) {
    var out = cloneMinimap(st.last);
    var f = st.gap > 0 ? t / st.gap : 0;
    if (st.motion) {
      for (var i = 0; i < out.marks.length; i++) {
        var m = out.marks[i];
        m.northM += st.motion.north * f;
        m.eastM += st.motion.east * f;
        m.distanceM = Math.sqrt(m.northM * m.northM + m.eastM * m.eastM);
      }
    }
    /*
      Heading is deliberately left alone — it is the newest fix's, never predicted.

      Position is worth predicting because walking is continuous: a commander moving at 2 m/s a
      moment ago is still moving at 2 m/s now. Mouse-look is not like that at all. It starts and
      stops instantly, so the angle between two fixes three seconds apart is a flick that already
      finished, not a rate to carry forward. Projecting it kept the radar turning after the
      commander had stopped, and because the whole world layer rotates about him, every dot swung
      with it — which reads as drift even when walking in a straight line.

      Capping the predicted turn at the observed one was not enough, and could not be: half of a
      flick that is over is still a turn that is not happening.
    */
    return out;
  }

  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {
    /* no matchMedia: predict, which is the better default */
  }

  /**
   * A fingerprint of the fix, so a re-render can be told from a new position.
   *
   * This distinction is the whole reason the first version of the prediction did nothing in the
   * real app while passing its tests. The tracker section re-renders on every snapshot push —
   * several times a second — and hands over the *same* minimap each time. Treated as fresh fixes,
   * those repeats measured zero movement between them, which cleared the velocity and stopped any
   * prediction from ever starting. Only a change of position is a fix.
   */
  function minimapSignature(mm) {
    var s = String(mm.headingDeg) + "|" + mm.radiusM + "|" + mm.minSampleDistanceM;
    for (var i = 0; i < mm.marks.length; i++) {
      var m = mm.marks[i];
      s += "|" + m.kind + ":" + m.label + ":" + m.northM + "," + m.eastM;
    }
    return s;
  }

  /**
   * Draw the radar, continuing the commander's motion between fixes.
   *
   * State lives on the SVG element so two radars cannot share a loop, and the loop stops once the
   * prediction window closes or the node leaves the document.
   */
  function drawMinimap(svg, mm, hint) {
    if (!mm || !mm.marks) return false;
    var st = svg.__mmPredict;
    if (!st) {
      st = svg.__mmPredict = {
        last: null,
        at: 0,
        gap: 0,
        motion: null,
        raf: 0,
        sig: null,
        hint: hint,
      };
    }

    var now = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    var next = cloneMinimap(mm);
    var sig = minimapSignature(next);

    // A repeat of the fix already showing. Keep predicting from it rather than restarting on a
    // measurement of zero — but honour the newest `hint`, which changes on its own schedule.
    if (st.sig === sig && st.last) {
      st.hint = hint;
      if (!st.raf) {
        var held = st.gap > 0 ? Math.min(now - st.at, st.gap * PREDICT_MAX_GAPS) : 0;
        drawMinimapAt(svg, st.motion ? predictMinimap(st, held) : st.last, hint);
      }
      return true;
    }

    var gap = st.last ? now - st.at : 0;
    if (
      !PREDICT_ENABLED ||
      reduceMotion ||
      !st.last ||
      gap < PREDICT_MIN_GAP_MS ||
      gap > PREDICT_MAX_GAP_MS
    ) {
      st.motion = null;
    } else {
      var motion = motionBetween(st.last, next);
      var moved = motion ? Math.sqrt(motion.north * motion.north + motion.east * motion.east) : 0;
      st.motion = motion && moved >= PREDICT_MIN_SPEED_M ? motion : null;
      st.gap = gap;
    }

    st.last = next;
    st.at = now;
    st.sig = sig;
    st.hint = hint;

    if (st.raf) {
      cancelAnimationFrame(st.raf);
      st.raf = 0;
    }
    // The newest fix is the truth: draw it, then start estimating forward from it.
    drawMinimapAt(svg, next, hint);
    if (!st.motion) return true;

    var limit = st.gap * PREDICT_MAX_GAPS;
    var step = function () {
      st.raf = 0;
      if (!svg.isConnected) return;
      var at = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
      var t = at - st.at;
      if (t > limit) t = limit;
      drawMinimapAt(svg, predictMinimap(st, t), st.hint);
      if (t < limit) st.raf = requestAnimationFrame(step);
    };
    st.raf = requestAnimationFrame(step);
    return true;
  }

  /*
    Layout: the radar on the left, everything about the run on the right. Away from a surface the
    whole block folds shut (CSS transition on `.trk--away`) and a one-line message takes its place,
    so leaving a planet is a closing animation rather than a jump-cut.
  */
  var distance = {
    title: "Exo-distance tracker",
    html: function () {
      return (
        head("Exo-distance tracker") +
        '<div class="trk" data-f="trk">' +
        '<div class="trk__inner">' +
        '<svg class="minimap trk__radar" data-f="minimap" viewBox="-112 -112 224 224" role="img" aria-label="Where your samples and ship are, around you"></svg>' +
        '<div class="trk__side">' +
        '<div class="hud-big trk__species" data-f="species">—</div>' +
        '<div class="row"><span class="lbl">Scan 1</span><span class="val" data-f="d1">—</span></div>' +
        '<div class="row"><span class="lbl">Scan 2</span><span class="val"><span data-f="d2">—</span><span data-f="pill2"></span></span></div>' +
        '<div class="row"><span class="lbl">Scan 3</span><span class="val"><span data-f="d3">—</span><span data-f="pill3"></span></span></div>' +
        '<div class="row"><span class="lbl">Min gap</span><span class="val" data-f="minGap">—</span></div>' +
        '<div class="row"><span class="lbl">Run time</span><span class="val" data-f="timer">—</span></div>' +
        "</div>" +
        "</div>" +
        '<div class="row row--rule"><span class="lbl">Payout</span><span class="val" data-f="pay">—</span></div>' +
        '<div class="hud-note" data-f="note"></div>' +
        '<div class="cele" data-f="cele" style="display:none"></div>' +
        "</div>" +
        '<div class="trk__away" data-f="away">Approach a planet to see the tracker</div>'
      );
    },
    render: function (d, root) {
      var status = q(root, "status");
      var eo = d.exoOrganicOverlay;
      var trk = q(root, "trk");
      var away = q(root, "away");
      var svg = q(root, "minimap");
      var live = !d.journalBoot && eo && eo.visible === true;
      // Standing on top of a plant is the same mistake whether you are looking for the second or the
      // third, and `nearestSampleMeetsMin` measures against every plant taken, not only the first.
      var hunting = live && (eo.sampleCount === 1 || eo.sampleCount === 2);
      cueFromOverlay(eo);
      var tooClose = hunting && eo.nearestSampleMeetsMin === false;
      var onSurface = !d.journalBoot && drawMinimap(svg, d.exoMinimap, tooClose);
      var showTracker = onSurface || live;
      trk.classList.toggle("trk--away", !showTracker);
      away.classList.toggle("trk__away--on", !showTracker);
      var pay = q(root, "pay"),
        note = q(root, "note"),
        cele = q(root, "cele"),
        timer = q(root, "timer");
      var rowClass = function (name, muted) {
        var el = q(root, name);
        var row = el.closest(".row");
        if (row) row.classList.toggle("row--muted", !!muted);
      };
      root.__runStart = null;
      if (!showTracker) {
        status.textContent = d.journalBoot ? "Journal loading" : "Standby";
        return null;
      }
      if (!live) {
        status.textContent = "On foot";
        q(root, "species").textContent = "No sample in progress";
        q(root, "minGap").textContent = "—";
        ["d1", "d2", "d3", "timer"].forEach(function (n) {
          // Through `setMetres` for the distance rows, so the next run starts from "—" and snaps to
          // its first real figure instead of counting down from the previous body's.
          if (n === "timer") q(root, n).textContent = "—";
          else setMetres(q(root, n), null);
          rowClass(n, true);
        });
        rowClass("minGap", true);
        q(root, "pill2").innerHTML = "";
        q(root, "pill3").innerHTML = "";
        pay.innerHTML = "<span class='row--muted'>—</span>";
        note.textContent = "The radar shows your ship and any plants taken here while this app was running.";
        cele.style.display = "none";
        return null;
      }
      var state = eo.phase === "celebrate" ? "ok" : tooClose ? "warn" : null;
      status.textContent =
        eo.phase === "celebrate"
          ? "Complete"
          : tooClose
            ? "Too close"
            : "Sampling " + Math.min(eo.sampleCount || 0, 3) + " / 3";
      q(root, "species").textContent = cap(eo.speciesDisplay || "—");
      q(root, "minGap").textContent = eo.minSampleDistanceM > 0 ? eo.minSampleDistanceM + " m" : "—";
      rowClass("minGap", false);
      rowClass("d1", eo.distToFirstM == null && eo.phase === "tracking");
      setMetres(q(root, "d1"), eo.distToFirstM);
      rowClass("d2", eo.sampleCount < 2 || (eo.phase === "tracking" && eo.distToSecondM == null));
      setMetres(q(root, "d2"), eo.sampleCount >= 2 ? eo.distToSecondM : null);
      // The third sample only exists once Analyse has been taken, and then it is a place like the others.
      rowClass("d3", eo.distToThirdM == null);
      setMetres(q(root, "d3"), eo.distToThirdM);
      /*
        The pill answers one question — "far enough to take the next one here?" — so it belongs on
        the row for the scan about to be taken, and on that row only.
        `nearestSampleMeetsMin` measures against the nearest plant already sampled, which is the rule
        the game enforces: with two down you have to clear both, not just the first. It was only ever
        shown against the second scan, and against a "Spacing" row that reported the gap between the
        first two after the fact — a number with nothing left to decide. That row is gone.
      */
      q(root, "pill2").innerHTML = eo.sampleCount === 1 ? pillEl(eo.nearestSampleMeetsMin) : "";
      q(root, "pill3").innerHTML = eo.sampleCount === 2 ? pillEl(eo.nearestSampleMeetsMin) : "";
      // The run timer: first Log/Sample of this species on this body to now (frozen on completion).
      var startMs = eo.runStartedIso ? Date.parse(eo.runStartedIso) : NaN;
      root.__runStart = isFinite(startMs) && eo.phase !== "celebrate" ? startMs : null;
      rowClass("timer", !isFinite(startMs));
      timer.textContent = isFinite(startMs) ? fmtClock(Date.now() - startMs) : "—";
      cele.style.display = "none";
      if (eo.phase === "celebrate") {
        pay.innerHTML =
          eo.finalCredits != null
            ? fmtCr(eo.finalCredits) +
              (eo.analyseWasLogged === true
                ? " <span style='opacity:0.7'>(logged)</span>"
                : " <span style='opacity:0.85'>(new codex 5×)</span>")
            : fmtCr(null);
        note.textContent =
          eo.analyseWasLogged === true
            ? eo.footfallMult === 5
              ? "Includes first-footfall 5× on this body."
              : "No first-footfall 5× on this body."
            : eo.footfallMult === 5
              ? "5× new-codex payout (first footfall does not stack another ×5)."
              : "5× new-codex payout.";
        cele.style.display = "block";
        cele.textContent = "Complete — hiding in " + (eo.celebrationRemainSec || 0) + "s";
      } else if (eo.sampleCount >= 2) {
        var a = eo.payLoggedCodex,
          b = eo.payNewCodex;
        if (a != null && b != null) {
          pay.innerHTML =
            "<span class='pay-est'>" +
            fmtCr(b).replace(" CR", "") +
            "<small>new</small>· " +
            fmtCr(a).replace(" CR", "") +
            "<small>logged</small></span>";
        } else pay.textContent = "—";
        note.textContent =
          "Estimates: new codex = 5× list; logged codex = list × footfall (×1 or ×5). These are not multiplied together.";
      } else {
        pay.innerHTML = "<span class='row--muted'>—</span>";
        note.textContent =
          eo.sampleCount === 1
            ? tooClose
              ? "Too close to Scan 1 — walk ≥ " +
                (eo.minSampleDistanceM || "?") +
                " m the way the radar arc points."
              : "Need ≥ " + (eo.minSampleDistanceM || "?") + " m from first sample before second."
            : "";
      }
      return state;
    },
    /** Once a second while a run is live: only the clock changes, so only the clock is touched. */
    tick: function (root) {
      if (!root.__runStart) return;
      var t = q(root, "timer");
      if (t) t.textContent = fmtClock(Date.now() - root.__runStart);
    },
  };

  /* ============================================================== Data value ================== */
  var datavalue = {
    title: "Data value",
    html: function () {
      return (
        head("Data value", "Unsold") +
        '<div class="row"><span class="k">Organic</span><span class="v" data-f="org">—</span></div>' +
        '<div class="row"><span class="k">Exploration scans</span><span class="v" data-f="scan">—</span></div>' +
        '<div class="row row--rule row--total"><span class="k">Total</span><span class="v" data-f="tot">—</span></div>' +
        '<p class="hud-note" data-f="hint">Loading…</p>'
      );
    },
    render: function (d, root) {
      var org = d.organicDataValueCredits != null ? d.organicDataValueCredits : 0;
      var scanOn = d.includeExplorationScanDataInDataValue === true;
      var scanCr = d.explorationScanDataValueCredits != null ? d.explorationScanDataValueCredits : 0;
      q(root, "org").textContent = fmtCr(org);
      var vs = q(root, "scan");
      vs.textContent = scanOn ? fmtCr(scanCr) : "off";
      vs.className = "v" + (scanOn ? "" : " off");
      q(root, "tot").textContent = fmtCr(org + (scanOn ? scanCr : 0));
      var pend = d.organicPendingSampleCount > 0 ? d.organicPendingSampleCount : 0;
      q(root, "status").textContent = pend ? pend + " pending sample" + (pend === 1 ? "" : "s") : "Unsold";
      q(root, "hint").textContent = scanOn
        ? "Total = organic + merged FSS/DSS scan estimate (same ⊕ toggle as the main UI)."
        : "Total = organic only. Enable ⊕ scan data in the main UI to add exploration CR.";
      return null;
    },
  };

  var SECTIONS = { jump: jump, fss: fss, candidates: candidates, distance: distance, datavalue: datavalue };
  var ORDER = ["jump", "fss", "candidates", "distance", "datavalue"];

  /* ============================================================== mount + feed ================ */
  var HUD = {};
  HUD.SECTIONS = ORDER.slice();
  HUD.PRESETS = PRESETS;
  HUD.applyTheme = applyTheme;
  HUD.starKind = starKind;
  HUD.readScale = readScale;
  HUD.readOpacity = readOpacity;
  HUD.audioOn = audioOn;
  HUD.serverPrefs = null;
  HUD.cueFromOverlay = cueFromOverlay;

  /**
   * Build the panel for `names` (in canonical order) inside #hud and start the state feed.
   *
   * State colours: a single-section page retints its whole panel (frame included) the way the
   * cockpit does; in the merged HUD only the section itself retints, so a finished discovery scan
   * does not paint the sample tracker blue for the rest of the visit.
   */
  /* Phone chrome: a chip per section at the top; tapping toggles it, the choice stays on the phone. */
  var PHONE_LS = "edexoPhoneSections";
  function phoneSavedSections() {
    try {
      var v = localStorage.getItem(PHONE_LS);
      if (!v) return null;
      var arr = JSON.parse(v);
      return Array.isArray(arr) && arr.length ? arr : null;
    } catch (e) {
      return null;
    }
  }
  function mountPhoneBar(list) {
    document.body.classList.add("phone");
    var bar = document.createElement("nav");
    bar.className = "phone-bar";
    bar.setAttribute("aria-label", "HUD sections");
    ORDER.forEach(function (n) {
      var on = list.indexOf(n) >= 0;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "phone-chip" + (on ? " phone-chip--on" : "");
      b.textContent = SECTIONS[n].title;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.addEventListener("click", function () {
        var next = list.slice();
        var i = next.indexOf(n);
        if (i >= 0) next.splice(i, 1);
        else next.push(n);
        if (!next.length) return;
        try {
          localStorage.setItem(PHONE_LS, JSON.stringify(next));
        } catch (e) {}
        var u = new URL(location.href);
        u.searchParams.set("s", next.join(","));
        location.href = u.toString();
      });
      bar.appendChild(b);
    });
    /*
      Full screen on the phone: the Fullscreen API on Android Chrome (tap the chip or the phone's
      back button to leave); iOS Safari has no API for it — there, "Add to Home Screen" opens the
      page without browser chrome (the web-app manifest says `display: fullscreen`).
    */
    var fs = document.createElement("button");
    fs.type = "button";
    fs.className = "phone-chip phone-chip--fs";
    fs.setAttribute("aria-label", "Full screen");
    fs.title = "Full screen (tap again, or the back button, to leave). iPhone: use Add to Home Screen.";
    fs.textContent = "\u26F6";
    var canFs = !!(
      document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen
    );
    if (!canFs) fs.classList.add("phone-chip--dim");
    fs.addEventListener("click", function () {
      try {
        var de = document.documentElement;
        var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (fsEl) {
          (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        } else if (de.requestFullscreen) {
          de.requestFullscreen({ navigationUI: "hide" });
        } else if (de.webkitRequestFullscreen) {
          de.webkitRequestFullscreen();
        }
      } catch (e) {}
    });
    var syncFs = function () {
      var on = !!(document.fullscreenElement || document.webkitFullscreenElement);
      fs.classList.toggle("phone-chip--on", on);
      document.body.classList.toggle("phone--fullscreen", on);
    };
    document.addEventListener("fullscreenchange", syncFs);
    document.addEventListener("webkitfullscreenchange", syncFs);
    bar.appendChild(fs);
    var shellEl = document.querySelector(".shell");
    if (shellEl && shellEl.parentNode) shellEl.parentNode.insertBefore(bar, shellEl);
  }

  HUD.mount = function (names, opts) {
    opts = opts || {};
    var root = document.getElementById("hud");
    var shell = document.querySelector(".shell");
    var panel = document.querySelector(".panel");
    // The box's own layers (frame gradient, body fill) as elements, so the opacity slider can fade
    // them without touching the text; pseudo-elements were taken by the scanlines.
    if (panel && !panel.querySelector(".panel__frame")) {
      var frame = document.createElement("div");
      frame.className = "panel__frame";
      frame.setAttribute("aria-hidden", "true");
      panel.insertBefore(frame, panel.firstChild);
    }
    // In the order given: the launcher passes the owner's stack order, so the merged panel and the
    // separate windows agree on who sits above whom.
    var list = [];
    (names || []).forEach(function (n) {
      if (ORDER.indexOf(n) >= 0 && list.indexOf(n) < 0) list.push(n);
    });
    if (!list.length) list = ["distance"];
    var single = list.length === 1;
    if (PHONE) mountPhoneBar(list);
    applyTheme();
    try {
      window.addEventListener("storage", function (ev) {
        if (!ev.key || /^edexoHud/.test(ev.key)) {
          applyTheme();
          if (HUD.lastSnapshot) render(HUD.lastSnapshot);
        }
      });
    } catch (e) {
      /* no storage events outside a browser */
    }
    root.innerHTML = list
      .map(function (n) {
        return (
          '<section class="hud-section hud-section--' +
          n +
          '" data-section="' +
          n +
          '">' +
          SECTIONS[n].html() +
          "</section>"
        );
      })
      .join("");
    // the fill layer sits under the sections (after innerHTML, which would have wiped it)
    if (root && !root.querySelector(":scope > .panel__fill")) {
      var fill = document.createElement("div");
      fill.className = "panel__fill";
      fill.setAttribute("aria-hidden", "true");
      root.insertBefore(fill, root.firstChild);
    }
    if (single) document.title = SECTIONS[list[0]].title;
    var els = {};
    list.forEach(function (n) {
      els[n] = root.querySelector('[data-section="' + n + '"]');
    });

    function applyState(el, state) {
      el.className =
        el.className.replace(/\s*hud-section--(ok|warn)/g, "") + (state ? " hud-section--" + state : "");
      if (single) {
        shell.className = "shell" + (state === "ok" ? " shell--ok" : state === "warn" ? " shell--warn" : "");
        panel.className = "panel" + (state === "ok" ? " panel--ok" : state === "warn" ? " panel--warn" : "");
      }
    }

    /*
      The radar's own frame (server: ExoLiveDTO).

      It carries the two fields the radar draws and nothing else, and it arrives at the Status.json
      poll rate rather than through the snapshot's 250 ms coalescing window — which is what made the
      radar choppy no matter how low that poll was set. Only the section that draws it is re-rendered:
      running every section ten times a second would rebuild the candidate list and the FSS table for
      data that has not changed.
    */
    function renderExoLive(live) {
      var d = HUD.lastSnapshot;
      if (!d || !live) return;
      d.exoOrganicOverlay = live.exoOrganicOverlay;
      d.exoMinimap = live.exoMinimap;
      if (list.indexOf("distance") === -1) return;
      var state = null;
      try {
        state = SECTIONS.distance.render(d, els.distance);
      } catch (e) {
        /* one broken section must not take the others down */
      }
      applyState(els.distance, state);
      requestAnimationFrame(reportHeight);
    }

    var lastPrefsJson = "";
    function render(d) {
      HUD.lastSnapshot = d;
      shell.classList.remove("shell--off");
      // The launcher's settings, mirrored: re-theme when they change (the phone's only source).
      var pj = d && d.hudPrefs ? JSON.stringify(d.hudPrefs) : "";
      if (pj !== lastPrefsJson) {
        lastPrefsJson = pj;
        HUD.serverPrefs = d && d.hudPrefs ? d.hudPrefs : null;
        applyTheme();
      }
      list.forEach(function (n) {
        var state = null;
        try {
          state = SECTIONS[n].render(d, els[n]);
        } catch (e) {
          /* one broken section must not take the others down */
        }
        applyState(els[n], state);
      });
      requestAnimationFrame(reportHeight);
    }

    /*
      Tell the host window how tall this overlay actually is. The window is transparent, so height
      it is not using reads as a gap before the next one in the stack, and height it needs and does
      not have cuts the content off. Only the page knows: its height depends on what the game is
      doing. Polled as well as on render, so a CSS transition (the tracker folding shut) is followed
      to its end rather than measured mid-way. Only on a real change, because a resize relayouts
      the whole stack.
    */
    var lastReportedHeight = 0;
    var lastReportedScale = 0;
    function reportHeight() {
      if (PHONE) return;
      var ee = window.edexoElectron;
      if (!ee || typeof ee.resizeHudOverlay !== "function") return;
      var h = Math.ceil(shell.getBoundingClientRect().height) + 2;
      var sc = readScale();
      var scaleChanged = Math.abs(sc - lastReportedScale) > 0.004;
      if (!h || (!scaleChanged && Math.abs(h - lastReportedHeight) <= 2)) return;
      lastReportedHeight = h;
      lastReportedScale = sc;
      try {
        void ee.resizeHudOverlay({ height: h, scale: sc });
      } catch (e) {
        /* not in Electron, or the host said no; the overlay is still readable either way */
      }
    }
    if (!opts.noTimers) {
      setInterval(reportHeight, 250);
      setInterval(function () {
        list.forEach(function (n) {
          if (typeof SECTIONS[n].tick === "function") SECTIONS[n].tick(els[n]);
        });
      }, 1000);
    }

    /*
      One source of truth at a time. Polling and the WebSocket both deliver snapshots; when they
      disagree (they do around the end of a sample celebration) the panel flickers between two
      answers. The socket wins while it is delivering; the poll is the fallback for a socket that is
      not up, and it is slow on purpose — every poll builds a full snapshot on the server.
    */
    var lastWsAt = 0;
    var WS_LIVE_MS = 8000;
    function tick() {
      if (Date.now() - lastWsAt < WS_LIVE_MS) return;
      fetch(api("/api/state?channel=hud"), { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (d) {
          if (typeof d.port === "number" && d.port > 0) lastPort = d.port;
          render(d);
        })
        .catch(function () {
          shell.classList.remove("shell--off");
        });
    }
    if (!opts.noTimers) {
      tick();
      setInterval(tick, 5000);
      try {
        var proto = location.protocol === "https:" ? "wss:" : "ws:";
        var host = typeof location.host === "string" && location.host ? location.host : "127.0.0.1:7111";
        var ws = new WebSocket(proto + "//" + host + "/ws");
        ws.onopen = function () {
          // Ask for the HUD's slice of the state, not the whole snapshot (see server/wsChannels.ts).
          try {
            ws.send(JSON.stringify({ type: "hello", channel: "hud" }));
          } catch (e) {}
        };
        ws.onmessage = function (ev) {
          try {
            var msg = JSON.parse(String(ev.data));
            if (msg.type === "state" && msg.payload) {
              lastWsAt = Date.now();
              if (typeof msg.payload.port === "number" && msg.payload.port > 0) lastPort = msg.payload.port;
              render(msg.payload);
            } else if (msg.type === "exoLive" && msg.payload) {
              // Counts as the socket being alive, or the 5 s fallback poll would start fighting it
              // during a sample run — which is exactly when these frames are arriving.
              lastWsAt = Date.now();
              renderExoLive(msg.payload);
            }
          } catch (_) {}
        };
      } catch (_) {}
    }

    HUD.render = render; // for previews and tests
    HUD.renderExoLive = renderExoLive;
    /*
      The section implementations, on the same footing as `HUD.render` above: exposed so a test can
      see which of them a frame actually ran. `render` and `renderExoLive` both dispatch through
      this object, so replacing a property here is enough to count the calls.
    */
    HUD.sectionImpls = SECTIONS;
    return root;
  };

  /** Sections named in the page URL (`?s=fss,distance`), or everything when absent. */
  HUD.sectionsFromUrl = function () {
    if (PHONE && !/[?&]s=/.test(String(location.search || ""))) {
      var saved = phoneSavedSections();
      if (saved) return saved;
    }
    var m = /[?&]s=([^&]*)/.exec(location.search || "");
    if (!m) return ORDER.slice();
    return decodeURIComponent(m[1])
      .split(",")
      .map(function (s) {
        return s.trim();
      })
      .filter(function (s) {
        return ORDER.indexOf(s) >= 0;
      });
  };

  window.HUD = HUD;
  if (typeof module !== "undefined" && module.exports) module.exports = HUD;
})();
