import { esc, head, q } from "../core.js";

/* ============================================================== Discovery scan (FSS honk) ==== */
export var fss = {
  /* "Only when relevant": the system still has bodies to find. */
  relevant: function (d) {
    var s = d.dScanBodies;
    if (!s || s.total == null) return false;
    var honked = s.honked !== false;
    return !(s.complete || (honked && s.found >= s.total));
  },
  title: "Discovery scan",
  html: function () {
    return (
      head("Discovery scan") +
      '<div class="fss-line" data-f="dline"><span class="sys">—</span><span class="nums">— / —<small>bodies</small></span></div>' +
      '<div class="hud-bar" aria-hidden="true"><div class="hud-bar__fill" data-f="bar"></div><div class="hud-bar__ticks"></div></div>' +
      '<div class="hud-note hud-explain">Honk progress against bodies found, same as the main D-Scan readout.</div>'
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
    // No honk: the total is only what was scanned by hand, so found = total proves nothing.
    var honked = dscan.honked !== false;
    var complete = dscan.complete || (honked && dscan.found >= dscan.total);
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
      "<small>bodies</small></span>" +
      "<span class='honk" +
      (honked ? "" : " honk--no") +
      "'>Honk: " +
      (honked ? "Yes" : "No") +
      "</span>";
    return complete ? "ok" : null;
  },
};
