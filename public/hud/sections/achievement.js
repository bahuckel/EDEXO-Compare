import { esc, head, q } from "../core.js";

/* ============================================================== Achievement ================= */
/*
  The achievement the commander tracks (owner, 2026-09-27): its progress, the next step, and which
  plants in the system in view would count toward it — the ★ rows of the main UI.
*/
export var ACH_STEP = ["", "Bronze", "Silver", "Gold"];
export var achievement = {
  title: "Achievement",
  html: function () {
    return (
      head("Achievement", "—") +
      '<div class="row"><span class="k" data-f="name">—</span><span class="v" data-f="count">—</span></div>' +
      '<div class="ach-hud-bar"><div class="ach-hud-bar__fill" data-f="fill"></div></div>' +
      '<p class="hud-note" data-f="next"></p>' +
      '<div data-f="here"></div>'
    );
  },
  render: function (d, root) {
    var a = d.trackedAchievement;
    var name = q(root, "name"),
      count = q(root, "count"),
      fill = q(root, "fill"),
      next = q(root, "next"),
      here = q(root, "here");
    if (!a) {
      q(root, "status").textContent = "None tracked";
      name.textContent = "—";
      count.textContent = "";
      fill.style.width = "0%";
      next.textContent = "Pick one to track in the app's Achievements window.";
      here.innerHTML = "";
      return null;
    }
    q(root, "status").textContent = a.step ? ACH_STEP[a.step] : "Not started";
    name.textContent = a.name;
    count.textContent = a.done + " / " + a.total;
    fill.style.width = (a.total > 0 ? Math.min(100, (100 * a.done) / a.total) : 0) + "%";
    fill.className = "ach-hud-bar__fill ach-hud-bar__fill--s" + a.step;
    next.textContent =
      a.step >= 3 ? "Complete." : a.thresholds[a.step] - a.done + " more for " + ACH_STEP[a.step + 1] + ".";
    if (a.todo) {
      // A star, world or sight set: what is left, nearest sight first.
      here.innerHTML = a.todo.length
        ? a.todo
            .map(function (t) {
              return (
                '<div class="row"><span class="k">' +
                esc(t.label) +
                (t.hint ? " <small>" + esc(t.hint) + "</small>" : "") +
                '</span><span class="v">' +
                (t.distanceLy != null ? Number(t.distanceLy).toLocaleString() + " ly" : "") +
                "</span></div>"
              );
            })
            .join("")
        : '<p class="hud-note">Nothing left.</p>';
      return null;
    }
    var list = a.here || [];
    here.innerHTML = list.length
      ? list
          .slice(0, 8)
          .map(function (h) {
            return (
              '<div class="row"><span class="k">★ ' +
              esc(h.species) +
              (h.colours && h.colours.length ? " <small>" + esc(h.colours.join(" / ")) + "</small>" : "") +
              '</span><span class="v">' +
              esc(h.body) +
              "</span></div>"
            );
          })
          .join("") + (list.length > 8 ? '<p class="hud-note">and ' + (list.length - 8) + " more</p>" : "")
      : '<p class="hud-note">Nothing in this system counts toward it.</p>';
    return list.length ? "ok" : null;
  },
};
