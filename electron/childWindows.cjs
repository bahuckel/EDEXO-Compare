/**
 * Windows the app window opens for its own pages (owner, 2026-09-29: "fix the galaxy window size and
 * remember it"). A plain `window.open` child came up at Electron's 800 × 600 every time, which wrapped
 * the 3D map's toolbar onto two lines. The galaxy map (3D, and the Classic one it links to) now opens
 * large on the screen the app window is on, and keeps its own size and place in window-state.json like
 * the launcher and the app window. No Electron here, so the rules can be tested without a window.
 */

/** The smallest the map window may be, or come back as. */
const GALAXY_MIN = { w: 900, h: 560 };

/** Which remembered window a URL opens in, or null for a plain child window. */
function childWindowKind(url) {
  let screen = null;
  try {
    screen = new URL(url).searchParams.get("screen");
  } catch {
    return null;
  }
  return screen === "galaxy" || screen === "map" ? "galaxy" : null;
}

/**
 * Where the map window opens: its saved bounds when there are some (already checked to land on a
 * screen), else most of the work area of the screen the app window is on, centred.
 * @param {{x:number,y:number,width:number,height:number}|null} saved
 * @param {{x:number,y:number,width:number,height:number}} area
 */
function galaxyWindowBounds(saved, area) {
  if (saved) return { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
  const width = Math.max(Math.min(GALAXY_MIN.w, area.width), Math.min(1800, Math.round(area.width * 0.92)));
  const height = Math.max(Math.min(GALAXY_MIN.h, area.height), Math.min(1080, Math.round(area.height * 0.92)));
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
}

module.exports = { GALAXY_MIN, childWindowKind, galaxyWindowBounds };
