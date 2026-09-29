import { HUD, ls } from "./core.js";

/* ============================================================== colour theme ================= */
/*
  One accent colour drives the whole panel; the rest is derived so a custom colour still gets the
  dim/faint/glow ladder the frame and rules are built from. Presets are the cockpit colours people
  actually use. Text defaults to a pale tint of the accent so it reads on dark video.
*/
export var PRESETS = {
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
export function hexRgb(h) {
  var m = /^#?([0-9a-f]{6})$/i.exec(String(h || "").trim());
  if (!m) return null;
  var n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgba(c, a) {
  return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
}
export function mix(c, w, t) {
  return [
    Math.round(c[0] + (w[0] - c[0]) * t),
    Math.round(c[1] + (w[1] - c[1]) * t),
    Math.round(c[2] + (w[2] - c[2]) * t),
  ];
}
export function toHex(c) {
  return (
    "#" +
    c
      .map(function (v) {
        return (v < 16 ? "0" : "") + v.toString(16);
      })
      .join("")
  );
}
/*
  Phone mode (owner, 2026-09-13, task 13): `?phone=1` on the merged page. A phone has its own
  localStorage, so the settings come from the server's mirror of the launcher (`d.hudPrefs`),
  which the launcher writes on every change. On the PC the local keys still win.
*/
export var PHONE = /[?&]phone=1(&|$)/.test(String(location.search || ""));
export function serverPref(key) {
  var p = HUD.serverPrefs;
  if (!p) return null;
  if (key === "edexoHudTheme") return p.theme ? JSON.stringify(p.theme) : null;
  if (key === "edexoHudScale") return typeof p.scale === "number" ? String(p.scale) : null;
  if (key === "edexoHudOpacity") return typeof p.opacity === "number" ? String(p.opacity) : null;
  if (key === "edexoHudCandOrder") return p.candOrder || null;
  if (key === "edexoHudRegion") return typeof p.region === "boolean" ? (p.region ? "1" : "0") : null;
  if (key === "edexoHudAudio") return typeof p.audio === "boolean" ? (p.audio ? "1" : "0") : null;
  if (key === "edexoHudCompact") return typeof p.compact === "boolean" ? (p.compact ? "1" : "0") : null;
  if (key === "edexoHudRelevant") return typeof p.relevant === "boolean" ? (p.relevant ? "1" : "0") : null;
  return null;
}
export function pref(key, def) {
  var v = PHONE ? null : ls(key, null);
  if (v == null) v = serverPref(key);
  return v == null ? def : v;
}
export function readTheme() {
  var t = {};
  try {
    t = JSON.parse(pref("edexoHudTheme", "{}")) || {};
  } catch (e) {
    t = {};
  }
  var preset = PRESETS[t.preset] || null;
  var accent =
    hexRgb(t.preset === "custom" ? t.accent : preset ? preset.accent : PRESETS.orange.accent) ||
    hexRgb(PRESETS.orange.accent);
  var text =
    hexRgb(t.preset === "custom" ? t.text : preset ? preset.text : PRESETS.orange.text) ||
    mix(accent, [255, 255, 255], 0.78);
  return { accent: accent, text: text };
}
/*
  Size and panel opacity (owner, 2026-09-13): two sliders in the launcher, remembered like the
  colour. Scale multiplies the root font size, so every rem in the page follows; the host widens
  the window by the same factor (see reportHeight). Opacity is the panel fill's alpha.
*/
export function clampNum(v, lo, hi, def) {
  var n = parseFloat(v);
  if (!isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}
export function readScale() {
  // The phone has its own size: the launcher's slider is for the overlay on the game screen.
  if (PHONE) return 1;
  return clampNum(pref("edexoHudScale", "1"), 0.5, 2, 1);
}
/*
  Background opacity (owner, 2026-09-14): the panel fill's alpha only — text, icons and lines
  stay solid, and the fill keeps its colour; the slider decides how much of the game shows
  through it. 42 % is the design default.
*/
export function readOpacity() {
  if (PHONE) return 0.7;
  return clampNum(pref("edexoHudOpacity", "0.45"), 0.1, 1, 0.45);
}
export function applyTheme() {
  var th = readTheme();
  var a = th.accent;
  var st = document.documentElement.style;
  st.fontSize = Math.round(readScale() * 100) + "%";
  /*
    The slider runs from clear to a dark orange panel (owner, 2026-09-14: "not a second sun"):
    the fill is a near-black orange whose alpha follows the slider up to 92 %, the frame hairline
    dims with it. 45 % is roughly the old default look.
  */
  var t = readOpacity();
  st.setProperty("--hud-bg-opacity", String(t));
  st.setProperty("--hud", toHex(a));
  st.setProperty("--hud-hi", toHex(mix(a, [255, 255, 255], 0.35)));
  st.setProperty("--hud-text", toHex(th.text));
  st.setProperty("--hud-dim", rgba(a, 0.55));
  st.setProperty("--hud-faint", rgba(a, 0.22));
  st.setProperty("--hud-ghost", rgba(a, 0.1));
  st.setProperty("--hud-bg", rgba(mix(a, [0, 0, 0], 0.9), Math.round(92 * t) / 100));
  st.setProperty("--hud-bg-2", rgba(mix(a, [0, 0, 0], 0.8), Math.round(35 * t) / 100));
  st.setProperty("--hud-glow", "0 0 6px " + rgba(a, 0.45));
  // Compact (guild tester, 2026-09-30): the explanatory lines (`.hud-explain`) are hidden.
  document.documentElement.classList.toggle("hud-compact", pref("edexoHudCompact", "0") === "1");
}
