import { fmtCr, head, q } from "../core.js";

/* ============================================================== Data value ================== */
export var datavalue = {
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
