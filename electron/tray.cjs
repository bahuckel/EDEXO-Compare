"use strict";

/*
  The tray (split out of main.cjs, owner 2026-09-28). What it shows and does comes from main.cjs:
  the launcher to bring back, the HUDs' state and toggle, the UI's URL.
*/
const { Tray, Menu, nativeImage, app, shell } = require("electron");
const { HUD_TOGGLE_SHORTCUT } = require("./hudWindows.cjs");

/**
 * @param {{ showLauncher: () => void, huds: { isHidden: () => boolean, count: () => number,
 *   toggleVisibility: (force?: boolean) => boolean }, getUiUrl: () => (string | null) }} deps
 */
function createTrayControl(deps) {
  /*
    The tray (owner, 2026-09-13): minimising the launcher hides it to the tray; the tray menu shows
    it again, toggles the HUDs, opens the UI in the browser, quits. One instance, rebuilt when the
    HUD visibility changes so the label reads right.
  */
  let tray = null;
  const showLauncher = deps.showLauncher;
  function buildTrayMenu() {
    return Menu.buildFromTemplate([
      { label: "Show launcher", click: showLauncher },
      {
        label: deps.huds.isHidden() ? "Show HUDs" : "Hide HUDs",
        accelerator: HUD_TOGGLE_SHORTCUT,
        enabled: deps.huds.count() > 0,
        click: () => deps.huds.toggleVisibility(),
      },
      {
        label: "Open exobiology UI",
        click: () => {
          const url = deps.getUiUrl();
          if (url) void shell.openExternal(url);
        },
      },
      { type: "separator" },
      { label: "Quit ED Exo Compare", click: () => app.quit() },
    ]);
  }
  function refreshTrayMenu() {
    if (!tray) return;
    try {
      tray.setContextMenu(buildTrayMenu());
    } catch {
      /* ignore */
    }
  }
  function createTray(iconImage) {
    if (tray) return;
    try {
      let img = iconImage && !iconImage.isEmpty() ? iconImage : nativeImage.createEmpty();
      if (!img.isEmpty() && process.platform === "win32") img = img.resize({ width: 16, height: 16 });
      tray = new Tray(img);
      tray.setToolTip("ED Exo Compare");
      tray.setContextMenu(buildTrayMenu());
      tray.on("click", showLauncher);
      tray.on("double-click", showLauncher);
    } catch (e) {
      console.warn("[edexo-compare] tray unavailable:", e);
      tray = null;
    }
  }
  function destroyTray() {
    if (!tray) return;
    try {
      tray.destroy();
    } catch {
      /* ignore */
    }
    tray = null;
  }

  return { create: createTray, refresh: refreshTrayMenu, destroy: destroyTray, exists: () => tray !== null };
}

module.exports = { createTrayControl };
