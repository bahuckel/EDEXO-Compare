/*
  EDEXO HUD — the overlay sections and the plumbing they share.

  Every overlay page is the same shell (hud.css) around one panel; what differs is which sections
  are inside it. A page imports this module and calls `HUD.mount(["distance"])` for one section or
  `HUD.mount(["jump","fss","candidates","distance","datavalue"])` for the merged HUD, and this file
  does the rest: the markup of each section, one state feed (WebSocket first, polling as the
  fallback), per-section rendering, and telling the Electron host how tall the window has to be.

  Settings come from localStorage when this page shares it with the launcher (a browser tab on the
  same origin), and otherwise from the server's mirror of the launcher's (`hudPrefs` in each
  snapshot) — the phone, and since 2026-09-26 the Electron overlays too, which have a session of
  their own so the launcher's zoom stays off them:
    edexoHudTheme      {"preset":"orange"} or {"preset":"custom","accent":"#rrggbb","text":"#rrggbb"}
    edexoHudCandOrder  "likelihood" (default) | "value"
    edexoHudRegion     "1" (default) | "0"  — show the current region line in the candidates card
    edexoHudCompact    "0" (default) | "1"  — compact: hide the explanatory lines (.hud-explain)
    edexoHudRelevant   "0" (default) | "1"  — only when relevant: a section with nothing to say
                                               steps aside (see `relevantNow` below)

  Plain browser modules, no build step, served by the local server (a module does not load from
  file://). Split out of the single public/hud.js on 2026-09-28:
    core.js      the server URL, formatting, the section header      theme.js   colours, size, opacity
    audio.js     the sample cues                                      radar.js   the minimap / radar
    sections/    jump, fss, candidates, distance, datavalue, achievement — one section each
    main.js      this file: which sections, mounting, the state feed, the phone chips
*/
import { audioOn, cueFromOverlay } from "./audio.js";
import { HUD, api, setPort } from "./core.js";
import { achievement } from "./sections/achievement.js";
import { candidates } from "./sections/candidates.js";
import { datavalue } from "./sections/datavalue.js";
import { distance } from "./sections/distance.js";
import { fss } from "./sections/fss.js";
import { jump, starKind } from "./sections/jump.js";
import { notable } from "./sections/notable.js";
import { notices } from "./sections/notices.js";
import { PHONE, PRESETS, applyTheme, pref, readOpacity, readScale } from "./theme.js";

export var SECTIONS = {
  jump: jump,
  fss: fss,
  candidates: candidates,
  distance: distance,
  datavalue: datavalue,
  achievement: achievement,
  notable: notable,
  notices: notices,
};
export var ORDER = [
  "jump",
  "fss",
  "candidates",
  "distance",
  "datavalue",
  "achievement",
  "notable",
  "notices",
];

/*
  "Only when relevant" (guild tester report, 2026-09-30; opt-in). A section with a `relevant(d)` rule
  steps aside while the rule says no, and comes back the moment it says yes. It waits five seconds
  before stepping aside, so a value that flickers for a frame does not make the HUD blink. Sections
  without a rule (next jump, data value, achievement) always stay. The phone picks its sections with
  its chips and ignores this.
*/
export var RELEVANT_HOLD_MS = 5000;
export function relevantOn() {
  return !PHONE && pref("edexoHudRelevant", "0") === "1";
}

/* ============================================================== mount + feed ================ */
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
export var PHONE_LS = "edexoPhoneSections";
export function phoneSavedSections() {
  try {
    var v = localStorage.getItem(PHONE_LS);
    if (!v) return null;
    var arr = JSON.parse(v);
    return Array.isArray(arr) && arr.length ? arr : null;
  } catch (e) {
    return null;
  }
}
export function mountPhoneBar(list) {
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

/*
  Free move's placing mode (owner, 2026-10-02): the window takes the mouse while it is on, and this
  frame over the HUD is what it is grabbed by. The drag only says start / move / end; the app reads
  the cursor itself and moves the whole stack, so every HUD window follows the one being dragged.
  "Done" ends placing for every window (the launcher has the same button).
*/
var moveFrame = null;
HUD.setMoveMode = function (on) {
  var ee = window.edexoElectron;
  if (!on) {
    if (moveFrame && moveFrame.parentNode) moveFrame.parentNode.removeChild(moveFrame);
    moveFrame = null;
    return;
  }
  if (moveFrame || !ee || typeof ee.hudDrag !== "function") return;
  var f = document.createElement("div");
  f.className = "hud-move";
  f.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;gap:0.6em;" +
    "cursor:move;background:rgba(0,0,0,0.45);border:2px dashed var(--hud-hi,#ffb060);box-sizing:border-box;" +
    "color:var(--hud-hi,#ffb060);font:600 13px/1.2 var(--hud-font,'Segoe UI',sans-serif);letter-spacing:0.06em;" +
    "text-transform:uppercase;user-select:none;touch-action:none;";
  var label = document.createElement("span");
  label.textContent = "Drag to place";
  var done = document.createElement("button");
  done.type = "button";
  done.className = "hud-move-done";
  done.textContent = "Done";
  done.style.cssText =
    "cursor:pointer;font:inherit;letter-spacing:inherit;text-transform:inherit;padding:0.2em 0.8em;" +
    "color:#111;background:var(--hud-hi,#ffb060);border:0;";
  done.addEventListener("pointerdown", function (ev) {
    ev.stopPropagation();
  });
  done.addEventListener("click", function () {
    void ee.hudDrag("done");
  });
  f.appendChild(label);
  f.appendChild(done);
  var dragging = false;
  var queued = false;
  f.addEventListener("pointerdown", function (ev) {
    if (ev.button !== 0) return;
    dragging = true;
    try {
      f.setPointerCapture(ev.pointerId);
    } catch (e) {
      /* the drag still works while the cursor stays over the window */
    }
    void ee.hudDrag("start");
  });
  f.addEventListener("pointermove", function () {
    // One move per frame: the app moves every window in the stack on each one.
    if (!dragging || queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      if (dragging) void ee.hudDrag("move");
    });
  });
  var end = function () {
    if (!dragging) return;
    dragging = false;
    void ee.hudDrag("end");
  };
  f.addEventListener("pointerup", end);
  f.addEventListener("pointercancel", end);
  f.addEventListener("lostpointercapture", end);
  document.body.appendChild(f);
  moveFrame = f;
};

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
  /*
    The Electron overlays have a session of their own (so the launcher's zoom stays off them), and
    with it no storage events: the launcher's settings arrive straight from the Electron process as
    they change. The snapshot mirror still wins once it catches up — it carries the same values.
  */
  try {
    if (!PHONE && window.edexoElectron && typeof window.edexoElectron.onHudPrefs === "function") {
      window.edexoElectron.onHudPrefs(function (p) {
        if (!p || typeof p !== "object") return;
        HUD.serverPrefs = p;
        applyTheme();
        if (HUD.lastSnapshot) render(HUD.lastSnapshot);
      });
    }
  } catch (e) {
    /* the snapshot mirror still arrives */
  }
  try {
    if (!PHONE && window.edexoElectron && typeof window.edexoElectron.onHudMoveMode === "function") {
      window.edexoElectron.onHudMoveMode(function (v) {
        HUD.setMoveMode(!!(v && v.on));
      });
    }
  } catch (e) {
    /* no free move outside the app */
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

  /* Per section: when its rule last said yes. A section starts shown until its rule has been asked. */
  var lastRelevantAt = {};
  var idleReported = null;
  function relevantNow(d, now) {
    var on = relevantOn();
    var shown = {};
    list.forEach(function (n) {
      var rule = SECTIONS[n].relevant;
      if (!on || typeof rule !== "function" || !d) {
        shown[n] = true;
        return;
      }
      var yes = false;
      try {
        yes = !!rule(d);
      } catch (e) {
        yes = true;
      }
      if (yes || lastRelevantAt[n] === undefined) lastRelevantAt[n] = yes ? now : now - RELEVANT_HOLD_MS;
      shown[n] = yes || now - lastRelevantAt[n] < RELEVANT_HOLD_MS;
    });
    return shown;
  }
  function applyRelevance() {
    var shown = relevantNow(HUD.lastSnapshot, Date.now());
    var any = false;
    list.forEach(function (n) {
      els[n].classList.toggle("hud-section--idle", !shown[n]);
      if (shown[n]) any = true;
    });
    // Nothing on this page to show: ask the host to take the window out of the stack.
    var idle = !any;
    if (idle !== idleReported) {
      idleReported = idle;
      shell.classList.toggle("shell--idle", idle);
      var ee = window.edexoElectron;
      if (!PHONE && ee && typeof ee.resizeHudOverlay === "function") {
        try {
          void ee.resizeHudOverlay({ idle: idle });
        } catch (e) {
          /* not in Electron */
        }
      }
      if (!idle) {
        lastReportedHeight = 0;
        requestAnimationFrame(reportHeight);
      }
    }
  }
  HUD.applyRelevance = applyRelevance;

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
    applyRelevance();
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
    if (PHONE || idleReported) return;
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
      // The rules read data that may not change for a while; the hold still has to run out.
      applyRelevance();
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
        if (typeof d.port === "number" && d.port > 0) setPort(d.port);
        render(d);
      })
      .catch(function () {
        shell.classList.remove("shell--off");
      });
  }
  if (!opts.noTimers) {
    tick();
    setInterval(tick, 5000);
    /*
      Reconnects (combined plan 1.3). The socket had no onclose, so after a server restart or a phone's
      Wi-Fi drop every overlay fell back to the 5 s poll for good and the radar's live frames never
      came back until the window was reloaded. Back-off 1 s doubling to 10 s, reset once connected.
    */
    var wsRetryMs = 1000;
    var connectWs = function () {
      try {
        var proto = location.protocol === "https:" ? "wss:" : "ws:";
        var host = typeof location.host === "string" && location.host ? location.host : "127.0.0.1:7111";
        var ws = new WebSocket(proto + "//" + host + "/ws");
        ws.onopen = function () {
          wsRetryMs = 1000;
          // Ask for the HUD's slice of the state, not the whole snapshot (see server/wsChannels.ts).
          try {
            ws.send(JSON.stringify({ type: "hello", channel: "hud" }));
          } catch (e) {}
        };
        ws.onclose = function () {
          ws.onclose = null;
          ws.onmessage = null;
          setTimeout(connectWs, wsRetryMs);
          wsRetryMs = Math.min(10000, wsRetryMs * 2);
        };
        ws.onmessage = function (ev) {
          try {
            var msg = JSON.parse(String(ev.data));
            if (msg.type === "state" && msg.payload) {
              lastWsAt = Date.now();
              if (typeof msg.payload.port === "number" && msg.payload.port > 0) setPort(msg.payload.port);
              render(msg.payload);
            } else if (msg.type === "exoLive" && msg.payload) {
              // Counts as the socket being alive, or the 5 s fallback poll would start fighting it
              // during a sample run — which is exactly when these frames are arriving.
              lastWsAt = Date.now();
              renderExoLive(msg.payload);
            }
          } catch (_) {}
        };
      } catch (_) {
        setTimeout(connectWs, wsRetryMs);
        wsRetryMs = Math.min(10000, wsRetryMs * 2);
      }
    };
    connectWs();
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

// Pages mount through `window.HUD` (or `import { HUD }`), tests through the export.
window.HUD = HUD;
export { HUD };
