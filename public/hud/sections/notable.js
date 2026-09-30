import { esc, head, q } from "../core.js";
import { unreadCount } from "./notices.js";

/* ============================================================== Notable ===================== */
/*
  The system's notable planets on the HUD (guild tester report C9; owner, 2026-09-30: its own
  overlay). The same list as the app's Notable card — Earth-like, water and ammonia worlds,
  terraformables, Helium gas giants — orange until mapped, green once it is, and a medal on a planet
  that broke one of the commander's records. The header carries the unread count of the app's mail
  icon, so there is one place to glance at.
*/
var MEDAL = "🏅";

export var notable = {
  title: "Notable",
  html: function () {
    return head("Notable", "—") + '<ul class="hud-list notable-list" data-f="list"></ul>';
  },
  relevant: function (d) {
    return !!(d.notableBodies && d.notableBodies.length);
  },
  render: function (d, root) {
    var list = d.notableBodies || [];
    var records = {};
    ((d.notices && d.notices.recordMarks) || []).forEach(function (m) {
      (records[m.bodyId] = records[m.bodyId] || []).push(m);
    });
    var unread = unreadCount(d);
    var mapped = list.filter(function (n) {
      return n.dssMapped;
    }).length;
    q(root, "status").innerHTML =
      (list.length ? mapped + " / " + list.length + " mapped" : "None here") +
      (unread ? ' <span class="hud-mail" title="Unread notices in the app">✉ ' + unread + "</span>" : "");
    q(root, "list").innerHTML = list.length
      ? list
          .map(function (n) {
            var rec = records[n.bodyId] || [];
            return (
              '<li class="notable-row' +
              (n.dssMapped ? " notable-row--dss" : "") +
              '"><span class="name">' +
              esc(n.bodyLabelShort) +
              " <small>" +
              esc(n.tag) +
              (n.sold ? " · sold" : "") +
              "</small></span>" +
              (rec.length ? '<span class="notable-medal" title="Personal record">' + MEDAL + "</span>" : "") +
              "</li>"
            );
          })
          .join("")
      : '<li class="plain">No notable planets in this system.</li>';
    return list.length && mapped === list.length ? "ok" : null;
  },
};
