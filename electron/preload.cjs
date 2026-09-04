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
  /** @returns {Promise<{ opened: boolean; paths?: string[] }>} */
  getFootOverlayOpen: () => ipcRenderer.invoke("edexo:foot-overlay-state"),
  /** @returns {Promise<{ paths: string[] }>} */
  getHudOverlayState: () => ipcRenderer.invoke("edexo:hud-overlay-state"),
});
