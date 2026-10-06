"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("edexoElectron", {
  /**
   * This is the app window with EDEXO's own title bar (main.cjs: no Windows caption, the window
   * buttons drawn over the page): the page's tab strip is the bar to drag the window by.
   */
  customTitleBar: process.argv.includes("--edexo-custom-titlebar"),
  /*
    Tab view's windows (tabWindows.cjs): report this window's tabs, find a tab in another window, drag
    one out into a new window, hand one over to another window, and hear what the others did.
  */
  tabs: {
    report: (tabs) => ipcRenderer.send("edexo:tabs-report", tabs),
    registry: () => ipcRenderer.invoke("edexo:tab-registry"),
    focus: (kind) => ipcRenderer.invoke("edexo:tab-focus", kind),
    detach: (req) => ipcRenderer.invoke("edexo:tab-detach", req),
    moved: (req) => ipcRenderer.send("edexo:tab-moved", req),
    windowEmpty: () => ipcRenderer.send("edexo:tab-window-empty"),
    on: (cb) => {
      const reg = (_e, r) => cb({ type: "registry", registry: r });
      const rem = (_e, k) => cb({ type: "remove", kind: k });
      const act = (_e, k) => cb({ type: "activate", kind: k });
      ipcRenderer.on("edexo:tab-registry", reg);
      ipcRenderer.on("edexo:tab-remove", rem);
      ipcRenderer.on("edexo:tab-activate", act);
      return () => {
        ipcRenderer.removeListener("edexo:tab-registry", reg);
        ipcRenderer.removeListener("edexo:tab-remove", rem);
        ipcRenderer.removeListener("edexo:tab-activate", act);
      };
    },
  },
  /** @returns {Promise<{ opened: boolean; paths?: string[]; error?: string }>} */
  toggleFootOverlay: () => ipcRenderer.invoke("edexo:toggle-foot-overlay"),
  /**
   * @param {{ pathname: string, width?: number, height?: number }} opts
   * @returns {Promise<{ opened: boolean; paths?: string[]; error?: string }>}
   */
  openHudOverlay: (opts) => ipcRenderer.invoke("edexo:open-hud-overlay", opts),
  /** @returns {Promise<{ opened: boolean; paths?: string[]; error?: string }>} */
  toggleHudOverlay: (opts) => ipcRenderer.invoke("edexo:toggle-hud-overlay", opts),
  /**
   * Open a HUD at this path, or, if a HUD with the same path (query string aside) is already open,
   * point that window at the new URL. The merged HUD uses it to change which sections it shows.
   *
   * @param {{ pathname: string, width?: number, height?: number }} opts
   * @returns {Promise<{ opened: boolean; paths?: string[]; error?: string }>}
   */
  setHudOverlay: (opts) => ipcRenderer.invoke("edexo:set-hud-overlay", opts),
  /**
   * Close the HUD at this path (query string aside), if open.
   *
   * @param {{ pathname: string }} opts
   * @returns {Promise<{ closed: boolean; paths?: string[] }>}
   */
  closeHudOverlay: (opts) => ipcRenderer.invoke("edexo:close-hud-overlay", opts),
  /** Where the HUD stack sits and in what order. @returns {Promise<{ corner: string; order: string[]; hidden: boolean; shortcut: string }>} */
  getHudLayout: () => ipcRenderer.invoke("edexo:get-hud-layout"),
  /** @param {{ corner?: string, order?: string[] }} opts */
  setHudLayout: (opts) => ipcRenderer.invoke("edexo:set-hud-layout", opts),
  /** Hide/show every HUD window; same as the global shortcut. @param {{ hidden?: boolean }} [opts] */
  toggleHudVisibility: (opts) => ipcRenderer.invoke("edexo:toggle-hud-visibility", opts),
  /** Free move: start or end placing the HUDs. @param {{ on: boolean }} opts @returns {Promise<{ moving: boolean }>} */
  setHudMoveMode: (opts) => ipcRenderer.invoke("edexo:set-hud-move-mode", opts),
  /** A HUD page's drag while placing: "start", "move", "end", or "done" to finish placing. */
  hudDrag: (phase) => ipcRenderer.invoke("edexo:hud-drag", { phase }),
  /** HUD pages: placing mode on or off (`{ on }`). */
  onHudMoveMode: (cb) => {
    ipcRenderer.on("edexo:hud-move-mode", (_evt, v) => cb(v));
  },
  /** Close to tray: `{ enabled, available, reason? }` (owner, 2026-09-28; close, not minimise, since 2026-10-01). */
  getTrayPref: () => ipcRenderer.invoke("edexo:get-tray-pref"),
  /** @param {{ enabled: boolean }} opts */
  setTrayPref: (opts) => ipcRenderer.invoke("edexo:set-tray-pref", opts),
  /** Whether the HUD hotkey could be registered: `{ shortcut, registered }`. */
  getHotkeyStatus: () => ipcRenderer.invoke("edexo:hotkey-status"),
  /** Key binds: `{ binds, status, actions }` (electron/keybinds.cjs). Launcher only. */
  getKeybinds: () => ipcRenderer.invoke("edexo:get-keybinds"),
  /** @param {Record<string, string | null>} next "" turns a bind off, null puts the default back. */
  setKeybinds: (next) => ipcRenderer.invoke("edexo:set-keybinds", next),
  /** While a new bind is being recorded the current ones are released (`{ on: true }`), then restored. */
  pauseKeybinds: (opts) => ipcRenderer.invoke("edexo:pause-keybinds", opts),
  /** HUDs shown or hidden, however it was changed (hotkey, tray, launcher): `{ hidden, count }`. */
  onHudVisibility: (cb) => {
    ipcRenderer.on("edexo:hud-visibility", (_evt, v) => cb(v));
  },
  /**
   * The exobiology UI in its own window; the launcher stays open. Brings it forward when it is open.
   *
   * @returns {Promise<{ opened: boolean; focused?: boolean; error?: string }>}
   */
  openAppWindow: () => ipcRenderer.invoke("edexo:open-app-window"),
  /** @returns {Promise<{ opened: boolean; paths?: string[] }>} */
  getFootOverlayOpen: () => ipcRenderer.invoke("edexo:foot-overlay-state"),
  /** @returns {Promise<{ paths: string[] }>} */
  getHudOverlayState: () => ipcRenderer.invoke("edexo:hud-overlay-state"),
  /**
   * Ask for this overlay's window to match its content height.
   *
   * @param {{ height: number }} opts
   * @returns {Promise<{ ok: boolean }>}
   */
  resizeHudOverlay: (opts) => ipcRenderer.invoke("edexo:resize-hud-overlay", opts),
  /**
   * Save text to a file the commander picks (Exomastery downloads). Only the launcher may call it.
   *
   * @param {{ defaultName: string, text: string }} opts
   * @returns {Promise<{ saved: boolean; path?: string; error?: string }>}
   */
  saveTextFile: (opts) => ipcRenderer.invoke("edexo:save-text-file", opts),
  /**
   * Choose a folder (the backups' folder, where to restore journals). Only the launcher may call it.
   *
   * @param {{ defaultPath?: string }} [opts]
   * @returns {Promise<{ path: string | null }>}
   */
  pickFolder: (opts) => ipcRenderer.invoke("edexo:pick-folder", opts),
  /** Close and start the app again (a staged restore is applied at start). Launcher only. */
  relaunch: () => ipcRenderer.invoke("edexo:relaunch"),
  // "Download & Install": installs the downloaded, checked update on the way out (electron/updater.cjs).
  installUpdate: () => ipcRenderer.invoke("edexo:install-update"),
  /** Launcher → every HUD window, as a setting changes (the HUDs have their own session). */
  pushHudPrefs: (prefs) => ipcRenderer.send("edexo:push-hud-prefs", prefs),
  /** HUD side of {@link pushHudPrefs}. */
  onHudPrefs: (cb) => {
    ipcRenderer.on("edexo:hud-prefs", (_evt, prefs) => cb(prefs));
  },
});
