"use strict";

/*
  What may happen inside the app's windows (combined plan 1.7, 2026-10-01).

  The launcher and the HUD windows load the app's own pages with the preload bridge
  (`window.edexoElectron`: HUD layout, tray, app window). They had no window-open handler and no
  navigation guard, so a link or `window.open` there (the update check's GitHub page, a LAN link)
  opened inside Electron with the same bridge, and Electron grants camera, microphone and the rest by
  default when no permission handler is set. Now:
  - a page outside the app opens in the commander's browser, never in an app window;
  - the app's own pages may still open a window of their own (the launcher's fallbacks do);
  - navigating an app window away from the app is refused (outside http(s) goes to the browser);
  - only the permissions the pages use are granted: writing the clipboard (Copy buttons),
    fullscreen and pointer lock (the map). Everything else is denied.
*/

const ALLOWED_PERMISSIONS = new Set(["clipboard-sanitized-write", "fullscreen", "pointerLock"]);

/** @param {string} url @param {() => (string | null)} getBase */
function isOwnUrl(url, getBase) {
  const base = getBase();
  if (!base) return false;
  return url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`);
}

/**
 * @param {import("electron").BrowserWindow} win
 * @param {() => (string | null)} getBase the app's own origin, e.g. http://127.0.0.1:7111
 * @param {import("electron").Shell} shell
 */
function guardWindowNavigation(win, getBase, shell) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOwnUrl(url, getBase)) return { action: "allow" };
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (isOwnUrl(url, getBase)) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
}

/** @param {import("electron").Session} ses */
function restrictPermissions(ses) {
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
}

module.exports = { guardWindowNavigation, restrictPermissions, isOwnUrl, ALLOWED_PERMISSIONS };
