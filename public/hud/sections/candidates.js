import { cap, head, norm, q } from "../core.js";
import { pref } from "../theme.js";

/* ============================================================== Exo candidates ============== */
export function speciesOnly(entry) {
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
export function bodyByKey(d, key) {
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
export function resolveListBody(d) {
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
export function speciesProgress(m, st, eo, bodyKey) {
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
export var candidates = {
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
      r.rank = Object.prototype.hasOwnProperty.call(rank, g) ? rank[g] : 9999;
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
