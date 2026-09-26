/**
 * The launcher's own choices, kept in user data (owner, 2026-09-26).
 *
 * Where "Open exobiology UI" opens used to live only in the launcher page's localStorage — that is,
 * inside Electron's Chromium profile, a different folder from the rest of the commander's data and
 * one a clean-up or a different install location can lose. It sits beside the user settings now, so
 * a rebuilt or re-downloaded exe opens the UI where it did last time. localStorage stays as the
 * fallback for a launcher that cannot reach this route.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveUserSettingsJsonPath } from "./paths.js";

export const LAUNCHER_OPEN_MODES = ["browser", "window", "phone"] as const;
export type LauncherOpenMode = (typeof LAUNCHER_OPEN_MODES)[number];

export function launcherPrefsPath(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "edexo-launcher-prefs.json");
}

export function isLauncherOpenMode(v: unknown): v is LauncherOpenMode {
  return typeof v === "string" && (LAUNCHER_OPEN_MODES as readonly string[]).includes(v);
}

/** The saved choice, or null when none was ever saved (the launcher then keeps its own default). */
export function readLauncherOpenMode(): LauncherOpenMode | null {
  try {
    const v = (JSON.parse(readFileSync(launcherPrefsPath(), "utf8")) as { openMode?: unknown }).openMode;
    return isLauncherOpenMode(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeLauncherOpenMode(mode: LauncherOpenMode): void {
  let prev: Record<string, unknown> = {};
  try {
    prev = JSON.parse(readFileSync(launcherPrefsPath(), "utf8")) as Record<string, unknown>;
  } catch {
    /* first write */
  }
  writeFileSync(launcherPrefsPath(), JSON.stringify({ ...prev, openMode: mode }, null, 2), "utf8");
}
