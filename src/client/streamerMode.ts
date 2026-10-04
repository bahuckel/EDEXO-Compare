/**
 * Streamer mode (owner, 2026-10-01: "the main UI only, no options, nothing clickable, for showing the
 * app on a stream / to viewers").
 *
 * `?view=stream` loads the normal app with its controls taken away: the menu, the notices, the search,
 * the snapshot and bookmark buttons, the sort and jump controls are hidden, nothing on the page takes
 * a click, and no toast or scrollbar appears over the picture. What the viewers see still follows the
 * game — the body tab follows the ship, and the launcher's key binds (F1 / F2) switch tabs here too.
 * Meant for OBS as a Browser source; the launcher's open menu copies the link.
 *
 * The extras (leftovers, 2026-10-04): the legal footer and the Live / FDev dots are gone too (nothing
 * a viewer needs), and three options ride on the link —
 *   `&cmdr=0`            hide the commander name (an alt account, or a name kept off stream)
 *   `&zoom=1.25`         scale the whole page, 0.5–2, for a source smaller or larger than the window
 *   `&bg=transparent`    no backdrop, so the app sits over the game in OBS
 */
const params = new URLSearchParams(window.location.search);
export const STREAMER_MODE = params.get("view") === "stream";

export interface StreamerOptions {
  hideCmdr: boolean;
  zoom: number | null;
  transparent: boolean;
}

/** The link's options; a zoom outside 0.5–2 or not a number is ignored. */
export function streamerOptions(search: URLSearchParams = params): StreamerOptions {
  const z = Number(search.get("zoom"));
  return {
    hideCmdr: search.get("cmdr") === "0",
    zoom: search.has("zoom") && Number.isFinite(z) && z >= 0.5 && z <= 2 ? z : null,
    transparent: search.get("bg") === "transparent",
  };
}

/** Before the first paint: the attributes the stylesheet keys on (styles/streamer.css). */
export function applyStreamerMode(): void {
  if (!STREAMER_MODE) return;
  const root = document.documentElement;
  root.dataset.streamer = "1";
  const o = streamerOptions();
  if (o.hideCmdr) root.dataset.streamerCmdr = "0";
  if (o.transparent) root.dataset.streamerBg = "transparent";
  if (o.zoom !== null) root.style.setProperty("zoom", String(o.zoom));
  document.title = "ED Exo Compare — streamer view";
}
