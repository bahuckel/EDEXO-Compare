/**
 * One user-data directory, after two.
 *
 * The app kept **two** of everything. `electron/main.cjs` set `EDEXO_USER_DATA_DIR` to
 * `app.getPath("userData")`, so the packaged app wrote to `%APPDATA%\edexo-compare`, while the dev
 * server, the CLI and every probe fell through to `%LOCALAPPDATA%\ED Exo Compare`. §21.3 recorded
 * this as two copies of a journal cache. Measured on the owner's machine it was worse:
 *
 * ```
 *   %APPDATA%\edexo-compare\          .edexo-cache 7,601,600 B (Sep 5 04:44)
 *                                     edexo-compare-user-settings.json
 *                                     edexo-compare-lan-key.txt
 *   %LOCALAPPDATA%\ED Exo Compare\    .edexo-cache 7,594,311 B (Sep 5 16:19)
 *                                     edexo-compare-user-settings.json
 *                                     edexo-compare-lan-key.txt
 *                                     edexo-outliers.jsonl   ← the miss log
 * ```
 *
 * Two diverged caches is a measurement footgun. **Two miss logs is a correctness problem**: that file
 * is the append-only record of what the predictor got wrong, and §40 through §44 were all driven by
 * it. A commander flying the packaged build would write misses to a file the probes never read.
 *
 * The single location is `%LOCALAPPDATA%\ED Exo Compare` — what every non-Electron entry point
 * already used, and the right side of the Windows split for a **7.6 MB derived cache**, which has no
 * business in a roaming profile that a domain login copies over the network.
 *
 * Electron therefore stops forcing `EDEXO_USER_DATA_DIR` and instead hands its old directory over as
 * `EDEXO_LEGACY_USER_DATA_DIR`, so this migration knows exactly where to look rather than guessing
 * at Electron's naming.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  USER_SETTINGS_FILENAME,
  resolveExoOutlierLogPath,
  resolveLanKeyPath,
  resolveUserSettingsJsonPath,
} from "./paths.js";

/** Files carried over when the new location does not have them. Order is report order. */
const COPY_IF_MISSING = [USER_SETTINGS_FILENAME, "edexo-compare-lan-key.txt", "species-data-dir.json"];

export interface UserDataMigration {
  legacyDir: string | null;
  /** Files copied because the current location had none. */
  copied: string[];
  /** Miss-log records merged in from the legacy log, after de-duplication. */
  outliersMerged: number;
  /**
   * A legacy `.edexo-cache` left in place, with its size. Derived data rebuilds itself from the
   * journals, so this is never copied — and never deleted either, because silently removing
   * megabytes from someone's profile is not this function's call to make.
   */
  staleCacheBytes: number | null;
  staleCacheDir: string | null;
}

const EMPTY: UserDataMigration = {
  legacyDir: null,
  copied: [],
  outliersMerged: 0,
  staleCacheBytes: null,
  staleCacheDir: null,
};

function outlierKey(line: string): string | null {
  try {
    const rec = JSON.parse(line) as { bodyKey?: unknown; speciesId?: unknown };
    if (typeof rec.bodyKey !== "string" || typeof rec.speciesId !== "string") return null;
    if (!rec.bodyKey || !rec.speciesId) return null;
    return `${rec.bodyKey}|${rec.speciesId}`;
  } catch {
    return null;
  }
}

/**
 * Fold the legacy miss log into the current one.
 *
 * Merged rather than copied, because both sides can hold real flights and this is the only record of
 * what the predictor got wrong — the one file in the tree where losing a line loses evidence. Keyed
 * on `bodyKey|speciesId`, the same key `exoOutlierLog.ts` de-duplicates on, so a body flown under
 * both builds contributes one record and the current file's version of it wins.
 */
function mergeOutlierLogs(legacyPath: string, currentPath: string): number {
  if (!existsSync(legacyPath)) return 0;

  const seen = new Set<string>();
  let current = "";
  if (existsSync(currentPath)) {
    current = readFileSync(currentPath, "utf8");
    for (const line of current.split("\n")) {
      const k = outlierKey(line);
      if (k) seen.add(k);
    }
  }

  const add: string[] = [];
  for (const line of readFileSync(legacyPath, "utf8").split("\n")) {
    const k = outlierKey(line);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    add.push(line);
  }
  if (add.length === 0) return 0;

  const joined = current && !current.endsWith("\n") ? `${current}\n` : current;
  writeFileSync(currentPath, `${joined}${add.join("\n")}\n`, "utf8");
  return add.length;
}

function dirBytes(dir: string): number | null {
  try {
    if (!statSync(dir).isDirectory()) return null;
  } catch {
    return null;
  }
  let total = 0;
  for (const name of ["journal-merge.payload.v8gz", "journal-merge.meta.json"]) {
    try {
      total += statSync(join(dir, name)).size;
    } catch {
      /* not present */
    }
  }
  return total > 0 ? total : null;
}

/**
 * Carry anything the old Electron directory still holds into the single one, once.
 *
 * Idempotent by construction rather than by a marker file: copies are conditional on the target
 * being absent, and the log merge is keyed. Running it twice does nothing the first run did not.
 */
export function migrateLegacyUserData(): UserDataMigration {
  const legacyDir = process.env.EDEXO_LEGACY_USER_DATA_DIR?.trim();
  if (!legacyDir || !existsSync(legacyDir)) return EMPTY;

  const currentDir = dirname(resolveUserSettingsJsonPath());
  if (join(currentDir) === join(legacyDir)) return EMPTY;

  const out: UserDataMigration = { ...EMPTY, legacyDir, copied: [] };
  try {
    mkdirSync(currentDir, { recursive: true });
  } catch {
    return out;
  }

  const targets: Record<string, string> = {
    [USER_SETTINGS_FILENAME]: resolveUserSettingsJsonPath(),
    "edexo-compare-lan-key.txt": resolveLanKeyPath(),
    "species-data-dir.json": join(currentDir, "species-data-dir.json"),
  };

  for (const name of COPY_IF_MISSING) {
    const from = join(legacyDir, name);
    const to = targets[name]!;
    try {
      if (existsSync(from) && !existsSync(to)) {
        copyFileSync(from, to);
        out.copied.push(name);
      }
    } catch {
      /* one unreadable file should not stop the rest of the migration */
    }
  }

  try {
    out.outliersMerged = mergeOutlierLogs(join(legacyDir, "edexo-outliers.jsonl"), resolveExoOutlierLogPath());
  } catch {
    /* the current log is untouched on failure */
  }

  const staleCache = join(legacyDir, ".edexo-cache");
  out.staleCacheBytes = dirBytes(staleCache);
  if (out.staleCacheBytes !== null) out.staleCacheDir = staleCache;

  return out;
}

/** One line per thing that moved, or nothing at all when nothing did. */
export function describeUserDataMigration(m: UserDataMigration): string[] {
  const lines: string[] = [];
  if (m.copied.length > 0) {
    lines.push(`[edexo-compare] carried over from ${m.legacyDir}: ${m.copied.join(", ")}`);
  }
  if (m.outliersMerged > 0) {
    lines.push(`[edexo-compare] merged ${m.outliersMerged} miss-log record(s) from the old user data`);
  }
  if (m.staleCacheDir && m.staleCacheBytes) {
    lines.push(
      `[edexo-compare] ${(m.staleCacheBytes / 1e6).toFixed(1)} MB of journal cache is now unused at ` +
        `${m.staleCacheDir} — safe to delete, it rebuilds from the journals`,
    );
  }
  return lines;
}
