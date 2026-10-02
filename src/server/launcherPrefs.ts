/**
 * The launcher's own choices, kept in user data (owner, 2026-09-26).
 *
 * Where "Open exobiology UI" opens used to live only in the launcher page's localStorage — that is,
 * inside Electron's Chromium profile, a different folder from the rest of the commander's data and
 * one a clean-up or a different install location can lose. It sits beside the user settings now, so
 * a rebuilt or re-downloaded exe opens the UI where it did last time. localStorage stays as the
 * fallback for a launcher that cannot reach this route.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
  writeLauncherPref("openMode", mode);
}

/*
  Written to a temp file and renamed (combined plan 1.7): a half-written file used to read as empty,
  and an empty file means "no LAN choice saved", which an existing install resolves to on. An
  unreadable file keeps LAN access off for the same reason.
*/
function readPrefsFile(): Record<string, unknown> | "unreadable" | null {
  if (!existsSync(launcherPrefsPath())) return null;
  try {
    const v = JSON.parse(readFileSync(launcherPrefsPath(), "utf8")) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : "unreadable";
  } catch {
    return "unreadable";
  }
}

function writeLauncherPref(key: string, value: unknown): void {
  const prev = readPrefsFile();
  const base = prev === null ? {} : prev === "unreadable" ? { lanAccess: false } : prev;
  const file = launcherPrefsPath();
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...base, [key]: value }, null, 2), "utf8");
  renameSync(tmp, file);
}

/*
  LAN access (owner, 2026-10-01): whether the desktop app listens on the local network, so a phone,
  a tablet or a second PC can open it, or on this PC only.

  It used to listen on the network from the first start, protected by the access key in the links.
  Off is the safer default for someone who has just downloaded it, so a new install starts on this
  PC only and the launcher's Network settings turn it on. An existing install keeps what it had (on):
  a commander whose phone shows the HUD must not find it gone after an update. The answer for an
  install with no saved choice is decided once and saved, so it never flips later.
*/

/** The saved choice, or null when none was ever saved. */
export function readLanAccess(): boolean | null {
  const prefs = readPrefsFile();
  if (prefs === "unreadable") return false;
  const v = prefs?.lanAccess;
  return typeof v === "boolean" ? v : null;
}

export function writeLanAccess(on: boolean): void {
  writeLauncherPref("lanAccess", on);
}

/** An install that has run before: its settings file or its journal cache is already there. */
export function isExistingInstall(): boolean {
  const dir = dirname(resolveUserSettingsJsonPath());
  return (
    existsSync(resolveUserSettingsJsonPath()) ||
    existsSync(launcherPrefsPath()) ||
    existsSync(join(dir, ".edexo-cache", "journal-merge.meta.json"))
  );
}

let existingAtStart: boolean | null = null;
/**
 * `isExistingInstall` as it was when this process first asked: the first start writes the prefs
 * file (LAN access), after which every install would look existing.
 */
export function wasExistingInstallAtStart(): boolean {
  if (existingAtStart === null) existingAtStart = isExistingInstall();
  return existingAtStart;
}

/** LAN access for this start: the saved choice, else on for an existing install and off for a new one. */
export function resolveLanAccess(existing: () => boolean = wasExistingInstallAtStart): boolean {
  const saved = readLanAccess();
  if (saved !== null) return saved;
  const on = existing();
  try {
    writeLanAccess(on);
  } catch {
    /* decided again next start, the same way */
  }
  return on;
}

/*
  "What's new" after an update (combined plan, Phase 5): the version whose notes the commander last
  closed. The launcher shows the notes of every release after it, once (whatsNew.ts).
*/

/** The version last marked seen, or null when none was ever saved. */
export function readLastSeenVersion(): string | null {
  const prefs = readPrefsFile();
  const v = prefs && prefs !== "unreadable" ? prefs.lastSeenVersion : null;
  return typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v) ? v : null;
}

export function writeLastSeenVersion(version: string): void {
  writeLauncherPref("lastSeenVersion", version);
}
