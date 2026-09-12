"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("edexoElectron", {
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
});
