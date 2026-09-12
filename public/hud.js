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
    return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function fmtCr(n) {
    if (n == null || !isFinite(n)) return "—";
    return Number(n).toLocaleString() + " CR";
  }
  function fmtM(n) {
    if (n == null || !isFinite(n)) return "—";
    return Math.round(n) + " m";
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
    return String(s || "").trim().toLowerCase();
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
      '<div class="hud-head"><span class="hud-title">' + esc(title) +
      '</span><span class="hud-status" data-f="status">' + esc(status || "Standby") + "</span></div>"
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
    return "#" + c.map(function (v) {
      return (v < 16 ? "0" : "") + v.toString(16);
    }).join("");
  }
  function readTheme() {
    var t = {};
    try {
      t = JSON.parse(ls("edexoHudTheme", "{}")) || {};
    } catch (e) {
      t = {};
    }
    var preset = PRESETS[t.preset] || null;
    var accent = hexRgb(t.preset === "custom" ? t.accent : preset ? preset.accent : PRESETS.orange.accent) || hexRgb(PRESETS.orange.accent);
    var text = hexRgb(t.preset === "custom" ? t.text : preset ? preset.text : PRESETS.orange.text) || mix(accent, [255, 255, 255], 0.78);
    return { accent: accent, text: text };
  }
  function applyTheme() {
    var th = readTheme();
    var a = th.accent;
    var st = document.documentElement.style;
    st.setProperty("--hud", toHex(a));
    st.setProperty("--hud-hi", toHex(mix(a, [255, 255, 255], 0.35)));
    st.setProperty("--hud-text", toHex(th.text));
    st.setProperty("--hud-dim", rgba(a, 0.55));
    st.setProperty("--hud-faint", rgba(a, 0.22));
    st.setProperty("--hud-ghost", rgba(a, 0.1));
    st.setProperty("--hud-bg", rgba(mix(a, [0, 0, 0], 0.88), 0.42));
    st.setProperty("--hud-bg-2", rgba(mix(a, [0, 0, 0], 0.75), 0.3));
    st.setProperty("--hud-glow", "0 0 6px " + rgba(a, 0.45));
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
    if (c === "H" || c === "SUPERMASSIVEBLACKHOLE") return { kind: "hole", label: c === "H" ? "Black hole" : "Supermassive black hole", note: "Black hole — no scoop, drop out early" };
    if (c === "N") return { kind: "neutron", label: "Neutron star", note: "Neutron star — jet cone boost, no scoop" };
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
        "</div></div>"
      );
    },
    render: function (d, root) {
      var jt = d.jumpTarget;
      var status = q(root, "status");
      var box = q(root, "jump");
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
        src === "target" ? "Targeted" : src === "route" ? "Next on route" : jt.arrived ? "Arrived" : "Jumping";
      box.className = "jump jump--" + k.kind + (jt.arrived ? " jump--arrived" : "") + " jump--src-" + src;
      q(root, "sys").textContent = jt.starSystem;
      q(root, "star").textContent = k.label;
      q(root, "note").textContent = k.note;
      return null;
    },
  };

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
        q(root, "dline").innerHTML = "<span class='sys'>—</span><span class='nums'>— / —<small>bodies</small></span>";
        return null;
      }
      var complete = dscan.complete || dscan.found >= dscan.total;
      var sys = dscan.systemName || "—";
      var pct = dscan.total > 0 ? Math.max(0, Math.min(100, (dscan.found / dscan.total) * 100)) : 0;
      bar.style.width = pct.toFixed(1) + "%";
      status.textContent = complete ? "Complete" : "Scanning " + Math.round(pct) + "%";
      q(root, "dline").innerHTML =
        "<span class='sys' title='" + esc(sys) + "'>" + esc(sys) + "</span><span class='nums'>" +
        dscan.found + " / " + dscan.total + "<small>bodies</small></span>";
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
    if (d.exoOverlayFocusBody && ((d.exoOverlayFocusBody.state || {}).key || "") === key) return d.exoOverlayFocusBody;
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
    return { body: fb, key: focusKey, name: fb ? (fb.tabLabel || (fb.state || {}).bodyName || focusKey) : focusKey, target: false };
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
      var showRegion = ls("edexoHudRegion", "1") !== "0";
      var regionEl = q(root, "region");
      var regionName = d.currentRegion && d.currentRegion.name ? d.currentRegion.name : null;
      regionEl.style.display = showRegion && regionName ? "" : "none";
      if (regionName) q(root, "regionV").textContent = regionName;
      function facts(body, sig, dss, target) {
        var b = q(root, "body"), s = q(root, "sig"), x = q(root, "dss");
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
        plain(pick.target ? "No exobiology data for this body yet — FSS or DSS it." : "No exobiology data for this body.");
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
      var byValue = ls("edexoHudCandOrder", "likelihood") === "value";
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
  var LEFTOVER_COLOURS = ["#c9a227", "#b25fd0", "#3fa7d6", "#e06c4a", "#d05a86", "#5a8bd0", "#a8842c", "#8c6fd0"];
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
      '<circle class="minimap-rim-outer" cx="0" cy="0" r="' + (MAP_R + 7) + '" />' +
      '<circle class="minimap-rim" cx="0" cy="0" r="' + MAP_R + '" />' +
      '<circle class="minimap-grid" cx="0" cy="0" r="' + MAP_R / 4 + '" />' +
      '<circle class="minimap-grid" cx="0" cy="0" r="' + MAP_R / 2 + '" />' +
      '<circle class="minimap-grid" cx="0" cy="0" r="' + (MAP_R * 3) / 4 + '" />' +
      '<line class="minimap-cross" x1="-' + MAP_R + '" y1="0" x2="' + MAP_R + '" y2="0" />' +
      '<line class="minimap-cross" x1="0" y1="-' + MAP_R + '" x2="0" y2="' + MAP_R + '" />' +
      '<path class="minimap-sweep" style="color:var(--hud)" d="M0,0 L' + MAP_R + ",0 A" + MAP_R + "," + MAP_R +
      " 0 0,0 0,-" + MAP_R + '" />' +
      '<g class="mm-world"></g><g class="mm-you"></g>';
  }
  function arcPath(r, a0, a1) {
    var p = function (a) {
      var t = (a * Math.PI) / 180;
      return [(r * Math.cos(t)).toFixed(1), (r * Math.sin(t)).toFixed(1)];
    };
    var s = p(a0), e = p(a1);
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
  function drawMinimap(svg, mm, hint) {
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
        '<line class="minimap-tick' + (major ? " minimap-tick--major" : "") + '" x1="0" y1="-' + MAP_R +
          '" x2="0" y2="-' + (MAP_R + (major ? 7 : 4)) + '" transform="rotate(' + t + ')" />',
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
            '<g transform="translate(' + x.toFixed(1) + "," + y.toFixed(1) + ") rotate(" + (-rot).toFixed(2) +
              ')"><polygon class="minimap-ship" points="0,-5.5 5,4.5 0,2.2 -5,4.5" />' + title + "</g>",
          );
        } else {
          parts.push(
            '<rect class="minimap-sample"' + tint + ' x="-3.2" y="-3.2" width="6.4" height="6.4" transform="translate(' +
              x.toFixed(1) + "," + y.toFixed(1) + ') rotate(45)">' + title + "</rect>",
          );
        }
      } else {
        var ang = (Math.atan2(y, x) * 180) / Math.PI;
        var ax = Math.cos((ang * Math.PI) / 180) * (MAP_R - 8);
        var ay = Math.sin((ang * Math.PI) / 180) * (MAP_R - 8);
        parts.push(
          '<g transform="translate(' + ax.toFixed(1) + "," + ay.toFixed(1) + ") rotate(" + ang.toFixed(1) +
            ')"><polygon class="minimap-arrow--' + cls + '"' + tint + ' points="7,0 -3,-4.5 -3,4.5" />' + title + "</g>",
        );
        parts.push(
          '<text class="minimap-far-label" x="' + (ax * 0.8).toFixed(1) + '" y="' + (ay * 0.8).toFixed(1) +
            '" text-anchor="middle" transform="rotate(' + (-rot).toFixed(2) + "," + (ax * 0.8).toFixed(1) + "," +
            (ay * 0.8).toFixed(1) + ')">' + Math.round(m.distanceM) + "</text>",
        );
      }
    }
    // The way to walk: the min-gap ring, on the side away from the first sample.
    if (hint && firstActive && minR > 0) {
      var away = (Math.atan2(firstActive.y, firstActive.x) * 180) / Math.PI + 180;
      var rr = Math.min(minR + 6, MAP_R - 4);
      parts.push('<path class="minimap-hint" d="' + arcPath(rr, away - 55, away + 55) + '" />');
      parts.push(
        '<polygon class="minimap-hint-arrow" transform="rotate(' + away.toFixed(1) + ') translate(' + (rr + 4).toFixed(1) +
          ',0)" points="0,-4 6,0 0,4" />',
      );
    }
    parts.push(
      '<text class="minimap-north" x="0" y="' + (-MAP_R + 13) + '" text-anchor="middle" transform="rotate(' +
        (-rot).toFixed(2) + ",0," + (-MAP_R + 13) + ')">NORTH</text>',
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
        '<div class="row"><span class="lbl">Scan 3</span><span class="val" data-f="d3">—</span></div>' +
        '<div class="row" data-f="rowSpan"><span class="lbl">Spacing</span><span class="val"><span data-f="span12">—</span><span data-f="pillSpan"></span></span></div>' +
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
      var tooClose = live && eo.sampleCount === 1 && eo.separationMeetsMin === false;
      var onSurface = !d.journalBoot && drawMinimap(svg, d.exoMinimap, tooClose);
      var showTracker = onSurface || live;
      trk.classList.toggle("trk--away", !showTracker);
      away.classList.toggle("trk__away--on", !showTracker);
      var pay = q(root, "pay"), note = q(root, "note"), cele = q(root, "cele"), timer = q(root, "timer");
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
        ["d1", "d2", "d3", "span12", "timer"].forEach(function (n) {
          q(root, n).textContent = "—";
          rowClass(n, true);
        });
        rowClass("minGap", true);
        q(root, "pill2").innerHTML = "";
        q(root, "pillSpan").innerHTML = "";
        pay.innerHTML = "<span class='row--muted'>—</span>";
        note.textContent = "The radar shows your ship and any plants taken here while this app was running.";
        cele.style.display = "none";
        return null;
      }
      var state = eo.phase === "celebrate" ? "ok" : tooClose ? "warn" : null;
      status.textContent =
        eo.phase === "celebrate" ? "Complete" : tooClose ? "Too close" : "Sampling " + Math.min(eo.sampleCount || 0, 3) + " / 3";
      q(root, "species").textContent = cap(eo.speciesDisplay || "—");
      q(root, "minGap").textContent = eo.minSampleDistanceM > 0 ? eo.minSampleDistanceM + " m" : "—";
      rowClass("minGap", false);
      rowClass("d1", eo.distToFirstM == null && eo.phase === "tracking");
      q(root, "d1").textContent = fmtM(eo.distToFirstM);
      rowClass("d2", eo.sampleCount < 2 || (eo.phase === "tracking" && eo.distToSecondM == null));
      q(root, "d2").textContent = eo.sampleCount >= 2 ? fmtM(eo.distToSecondM) : "—";
      // The third sample only exists once Analyse has been taken, and then it is a place like the others.
      rowClass("d3", eo.distToThirdM == null);
      q(root, "d3").textContent = eo.distToThirdM != null ? fmtM(eo.distToThirdM) : "—";
      q(root, "pill2").innerHTML = eo.sampleCount === 1 ? pillEl(eo.separationMeetsMin) : "";
      rowClass("span12", eo.sampleCount < 2);
      q(root, "span12").textContent = eo.sampleCount >= 2 ? fmtM(eo.spacingBetweenSamplesM) : "—";
      q(root, "pillSpan").innerHTML = eo.sampleCount >= 2 ? pillEl(eo.spacingMeetsMin) : "";
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
        var a = eo.payLoggedCodex, b = eo.payNewCodex;
        if (a != null && b != null) {
          pay.innerHTML =
            "<span class='pay-est'>" + fmtCr(b).replace(" CR", "") + "<small>new</small>· " +
            fmtCr(a).replace(" CR", "") + "<small>logged</small></span>";
        } else pay.textContent = "—";
        note.textContent =
          "Estimates: new codex = 5× list; logged codex = list × footfall (×1 or ×5). These are not multiplied together.";
      } else {
        pay.innerHTML = "<span class='row--muted'>—</span>";
        note.textContent =
          eo.sampleCount === 1
            ? tooClose
              ? "Too close to Scan 1 — walk ≥ " + (eo.minSampleDistanceM || "?") + " m the way the radar arc points."
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

  /**
   * Build the panel for `names` (in canonical order) inside #hud and start the state feed.
   *
   * State colours: a single-section page retints its whole panel (frame included) the way the
   * cockpit does; in the merged HUD only the section itself retints, so a finished discovery scan
   * does not paint the sample tracker blue for the rest of the visit.
   */
  HUD.mount = function (names, opts) {
    opts = opts || {};
    var root = document.getElementById("hud");
    var shell = document.querySelector(".shell");
    var panel = document.querySelector(".panel");
    // In the order given: the launcher passes the owner's stack order, so the merged panel and the
    // separate windows agree on who sits above whom.
    var list = [];
    (names || []).forEach(function (n) {
      if (ORDER.indexOf(n) >= 0 && list.indexOf(n) < 0) list.push(n);
    });
    if (!list.length) list = ["distance"];
    var single = list.length === 1;
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
        return '<section class="hud-section hud-section--' + n + '" data-section="' + n + '">' + SECTIONS[n].html() + "</section>";
      })
      .join("");
    if (single) document.title = SECTIONS[list[0]].title;
    var els = {};
    list.forEach(function (n) {
      els[n] = root.querySelector('[data-section="' + n + '"]');
    });

    function applyState(el, state) {
      el.className = el.className.replace(/\s*hud-section--(ok|warn)/g, "") + (state ? " hud-section--" + state : "");
      if (single) {
        shell.className = "shell" + (state === "ok" ? " shell--ok" : state === "warn" ? " shell--warn" : "");
        panel.className = "panel" + (state === "ok" ? " panel--ok" : state === "warn" ? " panel--warn" : "");
      }
    }

    function render(d) {
      HUD.lastSnapshot = d;
      shell.classList.remove("shell--off");
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
    function reportHeight() {
      var ee = window.edexoElectron;
      if (!ee || typeof ee.resizeHudOverlay !== "function") return;
      var h = Math.ceil(shell.getBoundingClientRect().height) + 2;
      if (!h || Math.abs(h - lastReportedHeight) <= 2) return;
      lastReportedHeight = h;
      try {
        void ee.resizeHudOverlay({ height: h });
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
      fetch(api("/api/state"), { cache: "no-store" })
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
        ws.onmessage = function (ev) {
          try {
            var msg = JSON.parse(String(ev.data));
            if (msg.type === "state" && msg.payload) {
              lastWsAt = Date.now();
              if (typeof msg.payload.port === "number" && msg.payload.port > 0) lastPort = msg.payload.port;
              render(msg.payload);
            }
          } catch (_) {}
        };
      } catch (_) {}
    }

    HUD.render = render; // for previews and tests
    return root;
  };

  /** Sections named in the page URL (`?s=fss,distance`), or everything when absent. */
  HUD.sectionsFromUrl = function () {
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
