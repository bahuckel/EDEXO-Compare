import { cueFromOverlay } from "../audio.js";
import { cap, fmtClock, fmtCr, head, pillEl, q, setMetres } from "../core.js";
import { drawMinimap } from "../radar.js";

/*
  Layout: the radar on the left, everything about the run on the right. Away from a surface the
  whole block folds shut (CSS transition on `.trk--away`) and a one-line message takes its place,
  so leaving a planet is a closing animation rather than a jump-cut.
*/
export var distance = {
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
      note.classList.add("hud-explain");
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
      note.classList.add("hud-explain");
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
      note.classList.add("hud-explain");
      note.textContent =
        "Estimates: new codex = 5× list; logged codex = list × footfall (×1 or ×5). These are not multiplied together.";
    } else {
      pay.innerHTML = "<span class='row--muted'>—</span>";
      // Walk-distance guidance is a reading, not an explanation: it stays in compact mode.
      note.classList.remove("hud-explain");
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
