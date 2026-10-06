import { esc, head, q } from "../core.js";

/* ============================================================== Next jump ==================== */
/*
  StarClass from `StartJump`. Scoopable main-sequence classes are the game's KGBFOAM rule; the
  rest earns a yellow triangle (no fuel there), a black hole a red one, a neutron star a blue one
  for those who boost. Everything else the journal can write (white dwarfs, T Tauri, Herbig,
  Wolf-Rayet, carbon stars) is simply "not scoopable".
*/
export function starKind(cls) {
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
export var jump = {
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
      '<div class="jump__route" data-f="route" hidden></div>' +
      '<div class="jump__copied" data-f="copied" hidden></div>'
    );
  },
  render: function (d, root) {
    var jt = d.jumpTarget;
    var status = q(root, "status");
    var box = q(root, "jump");
    renderRouteStrip(d, q(root, "route"));
    renderBoxelCopied(d, q(root, "copied"));
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
  Boxel scanning (owner, 2026-10-06): what the boxel run or the F6 / F8 / F9 keys put on the clipboard,
  since a key press in the game shows nothing else — paste it in the galaxy map.
*/
export function renderBoxelCopied(d, el) {
  if (!el) return;
  var c = d.boxelCopied;
  if (!c || !c.name) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.innerHTML =
    '<span class="jump__copied-k">Copied</span> ' +
    esc(c.name) +
    (c.run ? ' <span class="jump__copied-run">· boxel run</span>' : "");
}

/*
  The route strip under the card (owner, 2026-09-13): the next hops as star-class letters in the
  KGBFOAM colours, a fuel pump on the star where the tank says to scoop — yellow to plan on it,
  red when skipping it means running dry. `⛽ +N` when that star is beyond the hops shown.
*/
export function fuelPump(level) {
  return (
    '<svg class="hop__fuel hop__fuel--' +
    level +
    '" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15M4 20h12M7 7h6v4H7zM15 10h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0v-7l-2.5-2.5"/></svg>'
  );
}
export function renderRouteStrip(d, el) {
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
      The arrow's colour says what EDSM knows about the system it points at (owner, 2026-09-24):
      orange = someone has been there, electric blue = no record at all, grey = no answer — still
      waiting, or the request failed (no connection, rate limit, error, bad reply). Grey while
      waiting too, so orange only ever means EDSM said yes.

      The arrow only — the hop itself keeps the star-class colour it has always had, which is the
      fuel question and is not this one. See server/firstFootfallLookup.ts.
    */
    var ff = h.likelyFirstFootfall;
    var sepClass = ff === true ? " hop__sep--first" : ff === false ? "" : " hop__sep--unknown";
    var sepTitle =
      ff == null && h.firstFootfallNote
        ? ' title="' + esc(h.firstFootfallNote) + '"'
        : "";
    html +=
      (i ? '<span class="hop__sep' + sepClass + '"' + sepTitle + ' aria-hidden="true">››</span>' : "") +
      '<span class="hop hop--' +
      k.kind +
      '" title="' +
      esc(h.starSystem + " — " + k.label + (ff === true ? " — nobody has been here" : "")) +
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
export function fitRouteStrip(el, hops, _nav) {
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
