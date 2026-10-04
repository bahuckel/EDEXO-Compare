import { esc } from "./core.js";

/* ============================================================== Exo-distance tracker ======== */
/*
  Green is reserved for the run in progress. The game samples one species per planet at a time,
  so every other mark on this rock is a leftover from something the commander is no longer
  collecting. They still belong on the map -- they are places worth not walking back to -- but
  drawing them the same green is how you end up reading a Stratum mark as the Tussock you are
  three samples into. The colour is a hash of the species name, so a species keeps the same
  colour for as long as it is on screen, and no palette entry is green.
*/
export var LEFTOVER_COLOURS = [
  "#c9a227",
  "#b25fd0",
  "#3fa7d6",
  "#e06c4a",
  "#d05a86",
  "#5a8bd0",
  "#a8842c",
  "#8c6fd0",
];
export function leftoverColour(label) {
  var h = 0;
  var t = String(label || "");
  for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return LEFTOVER_COLOURS[h % LEFTOVER_COLOURS.length];
}

export var MAP_R = 100;
/*
  The radar has two layers. The rim, rings, crosshair and the rotating sweep never change and are
  built once; only the world (marks, ticks, North) is rebuilt on each snapshot. Rebuilding the whole
  SVG every 320 ms restarted the sweep's CSS animation every time, which is what made it jerk.
*/
export function radarStatic(svg) {
  if (svg.__staticBuilt) return;
  svg.__staticBuilt = true;
  svg.innerHTML =
    '<defs><linearGradient id="hudSweepGrad" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0" stop-color="currentColor" stop-opacity="0"/>' +
    '<stop offset="1" stop-color="currentColor" stop-opacity="0.28"/></linearGradient>' +
    // The sample rings stop at the rim: a ring round a plant out of range still shows its near edge.
    '<clipPath id="hudRadarClip"><circle cx="0" cy="0" r="' +
    MAP_R +
    '"/></clipPath></defs>' +
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
export function arcPath(r, a0, a1) {
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
export function drawMinimapAt(svg, mm, hint) {
  if (!mm || !mm.marks) return false;
  radarStatic(svg);
  var heading = typeof mm.headingDeg === "number" && isFinite(mm.headingDeg) ? mm.headingDeg : null;
  var rot = heading == null ? 0 : -heading; // rotating the scene by -heading puts "ahead" at the top
  var scale = MAP_R / (mm.radiusM > 0 ? mm.radiusM : 500);
  var parts = [];
  var minR = mm.minSampleDistanceM > 0 ? mm.minSampleDistanceM * scale : 0;
  /*
    A ring round each sample, its genus's sample distance across (owner, 2026-10-04: "a circle around
    each of the dots … so the user would know what the radius is and will not enter that circle").
    The next sample has to be outside every ring of its species. Until there is one, the ring round
    the commander still shows how far that is.
  */
  var ringed = mm.marks.some(function (m) {
    return m.kind === "sample" && m.active && m.ringM > 0;
  });
  if (!ringed && minR > 0 && minR < MAP_R) {
    parts.push('<circle class="minimap-minring" cx="0" cy="0" r="' + minR.toFixed(1) + '" />');
  }
  parts.push('<g transform="rotate(' + rot.toFixed(2) + ')">');
  var rings = [];
  for (var k = 0; k < mm.marks.length; k++) {
    var s = mm.marks[k];
    if (s.kind !== "sample" || !(s.ringM > 0)) continue;
    var sx = s.eastM * scale;
    var sy = -s.northM * scale;
    var sr = s.ringM * scale;
    // Entirely off the radar: nothing to show.
    if (Math.sqrt(sx * sx + sy * sy) - sr > MAP_R) continue;
    rings.push(
      '<circle class="minimap-sample-ring' +
        (s.active ? "" : " minimap-sample-ring--left") +
        '" cx="' +
        sx.toFixed(1) +
        '" cy="' +
        sy.toFixed(1) +
        '" r="' +
        sr.toFixed(1) +
        '"' +
        (s.active ? "" : ' style="stroke:' + leftoverColour(s.label) + '"') +
        " />",
    );
  }
  if (rings.length) parts.push('<g clip-path="url(#hudRadarClip)">' + rings.join("") + "</g>");
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
export var PREDICT_ENABLED = false;
export var PREDICT_MAX_GAPS = 1.5;
export var PREDICT_MIN_GAP_MS = 200;
export var PREDICT_MAX_GAP_MS = 8000;
/** Below this the commander is standing still; predicting it only adds jitter. */
export var PREDICT_MIN_SPEED_M = 0.05;

export function markKey(m) {
  return m.kind + "|" + m.label;
}

export function median(xs) {
  if (!xs.length) return 0;
  var s = xs.slice().sort(function (a, b) {
    return a - b;
  });
  return s[Math.floor(s.length / 2)];
}

export function cloneMinimap(mm) {
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
        ringM: m.ringM,
      };
    }),
  };
}

/** How far every mark moved between two fixes — the commander's movement, negated. */
export function motionBetween(prev, next) {
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
export function predictMinimap(st, t) {
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

export var reduceMotion = false;
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
export function minimapSignature(mm) {
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
export function drawMinimap(svg, mm, hint) {
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
  if (!PREDICT_ENABLED || reduceMotion || !st.last || gap < PREDICT_MIN_GAP_MS || gap > PREDICT_MAX_GAP_MS) {
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
