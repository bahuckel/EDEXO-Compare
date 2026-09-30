import { esc, head, q } from "../core.js";

/* ============================================================== Notices ===================== */
/*
  "Notify me" on the HUD (owner, 2026-09-30: "the mail icon or a HUD option"). What the app's mail
  icon collects — notable finds, records, phenomena, nearby points of interest and carriers — shown
  here for twenty seconds when it arrives, then left to the app's list. No sound here: the one sound
  is the app's record chime.

  "New" is what this page has seen arrive, not the notice's journal time: a notice already in the
  list when the overlay opens is not news.
*/
var FRESH_MS = 20000;
var ICON = { notable: "★", record: "🏅", nsp: "✦", poi: "◈", carrier: "▣", codex: "◆" };
var firstSeen = {};
var primed = false;

function freshItems(d) {
  var items = (d.notices && d.notices.items) || [];
  var now = Date.now();
  if (!primed) {
    items.forEach(function (n) {
      firstSeen[n.id] = 0;
    });
    primed = true;
  }
  var out = [];
  items.forEach(function (n) {
    if (!(n.id in firstSeen)) firstSeen[n.id] = now;
    if (firstSeen[n.id] && now - firstSeen[n.id] < FRESH_MS) out.push(n);
  });
  return out;
}

export function unreadCount(d) {
  var n = d && d.notices;
  if (!n) return 0;
  return typeof n.unread === "number" ? n.unread : (n.items || []).length;
}

export var notices = {
  title: "Notices",
  html: function () {
    return head("Notices", "—") + '<ul class="hud-list notices-list" data-f="list"></ul><p class="hud-note" data-f="note"></p>';
  },
  relevant: function (d) {
    return freshItems(d).length > 0;
  },
  render: function (d, root) {
    var fresh = freshItems(d);
    var unread = unreadCount(d);
    q(root, "status").textContent = "✉ " + unread + " unread";
    q(root, "list").innerHTML = fresh
      .slice(0, 3)
      .map(function (n) {
        return (
          '<li class="notice notice--' +
          esc(n.kind) +
          '"><span class="notice__icon">' +
          (ICON[n.kind] || "•") +
          '</span><span class="notice__text"><b>' +
          esc(n.title) +
          "</b><small>" +
          esc(n.text) +
          "</small></span></li>"
        );
      })
      .join("");
    q(root, "note").textContent = fresh.length ? "" : unread ? "Nothing new — the rest wait in the app's mail icon." : "Nothing new.";
    return fresh.length ? "ok" : null;
  },
  // Re-render each second so a notice leaves when its twenty seconds are up.
  tick: function (root) {
    var HUDref = window.HUD;
    if (HUDref && HUDref.lastSnapshot) notices.render(HUDref.lastSnapshot, root);
  },
};
