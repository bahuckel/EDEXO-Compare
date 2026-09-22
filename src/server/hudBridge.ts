/**
 * The HUD overlay windows, reachable over HTTP.
 *
 * Overlays are Electron `BrowserWindow`s, and every control for them lived on `ipcMain` channels the
 * renderer invokes through `preload.cjs`. That is fine for the app's own UI and useless to anything
 * else: the console builds are plain Node processes with no Electron in them, so a commander running
 * the CLI had no way to open, close or lay out a HUD — the one part of the app most worth driving
 * from a second window while the game has the screen.
 *
 * This is the seam. Electron's main process registers an implementation once its windows exist; the
 * HTTP layer looks it up per request. When nothing has registered — every console build, and the
 * Electron app before its windows are up — the routes answer **501 with a reason**, which is the
 * honest answer to "open an overlay" from a process that has no window system.
 *
 * It is deliberately a registry rather than a constructor argument: the server starts *before*
 * `electron/main.cjs` has its windows, so the value cannot be passed in at startup.
 */

/** A HUD overlay's page, e.g. `/hud-overlay.html`. */
export type HudPathname = string;

export interface HudOverlayState {
  paths: HudPathname[];
}

export interface HudLayout {
  hidden?: boolean;
  shortcut?: string;
  [key: string]: unknown;
}

export interface HudOverlayRequest {
  pathname?: string;
  width?: number;
  height?: number;
}

/**
 * What Electron's main process can do with overlay windows.
 *
 * One method per `ipcMain` channel that a person could reasonably want from outside the app. The
 * renderer-only channels are deliberately absent: `edexo:resize-hud-overlay` is a page reporting its
 * own height and means nothing from a terminal.
 */
export interface HudBridge {
  state(): HudOverlayState | Promise<HudOverlayState>;
  open(req: HudOverlayRequest): unknown | Promise<unknown>;
  toggle(req: HudOverlayRequest): unknown | Promise<unknown>;
  /** The merged HUD: navigate the open window to a new set of sections without a blink. */
  set(req: HudOverlayRequest): unknown | Promise<unknown>;
  close(req: { pathname: string }): unknown | Promise<unknown>;
  getLayout(): HudLayout | Promise<HudLayout>;
  setLayout(layout: Record<string, unknown>): HudLayout | Promise<HudLayout>;
  /** `hidden` omitted flips it; passing a boolean sets it outright. */
  toggleVisibility(opts: { hidden?: boolean }): { hidden: boolean } | Promise<{ hidden: boolean }>;
}

let bridge: HudBridge | null = null;

/**
 * Called by `electron/main.cjs` once its IPC handlers exist.
 *
 * Exported from the server bundle so main can reach it; passing `null` clears it, which is what a
 * test does and what a shutdown would do if the app ever tore its windows down without exiting.
 */
export function setHudBridge(next: HudBridge | null): void {
  bridge = next;
}

/** The registered bridge, or null in any build without overlay windows. */
export function getHudBridge(): HudBridge | null {
  return bridge;
}
