/**
 * Streamer mode (owner, 2026-10-01: "the main UI only, no options, nothing clickable, for showing the
 * app on a stream / to viewers").
 *
 * `?view=stream` loads the normal app with its controls taken away: the menu, the notices, the search,
 * the snapshot and bookmark buttons, the sort and jump controls are hidden, nothing on the page takes
 * a click, and no toast or scrollbar appears over the picture. What the viewers see still follows the
 * game — the body tab follows the ship, and the launcher's key binds (F1 / F2) switch tabs here too.
 * Meant for OBS as a Browser source; the launcher's open menu copies the link.
 */
export const STREAMER_MODE = new URLSearchParams(window.location.search).get("view") === "stream";

/** Before the first paint: the attribute the stylesheet keys on (styles/streamer.css). */
export function applyStreamerMode(): void {
  if (!STREAMER_MODE) return;
  document.documentElement.dataset.streamer = "1";
  document.title = "ED Exo Compare — streamer view";
}
