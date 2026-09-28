/**
 * Where this commander keeps their journals, remembered across updates.
 *
 * Almost nobody sets this: the default Saved Games folder is right for a normal install. The people
 * who do set it are the ones it matters most for — a second drive, a copied folder, a linked
 * install, a machine where Elite lives somewhere unusual — and the preference used to be written to
 * `<projectRoot>/edexo-compare-paths.json`, which in a packaged app is the **install tree**. Every
 * update threw it away and sent the app quietly back to Saved Games, where it would find nothing and
 * look broken.
 *
 * It lives beside the user settings now. The old path is still read so that an update does not lose
 * an answer already given, and never written again.
 *
 * Extracted from `edexoBootstrap.ts` so this can be tested without booting the server.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveJournalPathsPath } from "./paths.js";
import { findLinuxJournalDirs, type ProtonFs } from "./protonJournals.js";

/** The file name, in both the current location and the old one. */
export const PATHS_FILE = "edexo-compare-paths.json";

/** The real file system, for the Proton search. */
export const nodeProtonFs: ProtonFs = {
  isDir: (p) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  readText: (p) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return null;
    }
  },
  listDir: (p) => {
    try {
      return readdirSync(p);
    } catch {
      return [];
    }
  },
  mtimeMs: (p) => {
    try {
      return statSync(p).mtimeMs;
    } catch {
      return null;
    }
  },
  realPath: (p) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  },
};

/*
  Off Windows the game runs in a Proton or Wine prefix, and its journals are inside it
  (protonJournals.ts). The old default, `~/.local/share/Frontier Developments/…`, is a folder Elite
  never writes to; it stays only as the last resort, so the launcher still shows a path to fix.
*/
function linuxDefaultJournalDir(): string {
  const home = process.env.HOME || "";
  const found = home ? findLinuxJournalDirs(home, nodeProtonFs)[0] : undefined;
  return found ? found.dir : path.join(home, ".local/share/Frontier Developments/Elite Dangerous");
}

export const DEFAULT_JOURNAL_DIR =
  process.platform === "win32"
    ? path.join(process.env.USERPROFILE || "", "Saved Games", "Frontier Developments", "Elite Dangerous")
    : linuxDefaultJournalDir();

function readJournalDirFrom(file: string): string | null {
  try {
    if (!existsSync(file)) return null;
    const j = JSON.parse(readFileSync(file, "utf8")) as { journalDir?: string };
    if (typeof j.journalDir === "string" && j.journalDir.trim()) return path.normalize(j.journalDir.trim());
  } catch {
    /* a hand-edited or truncated file falls back to the default folder */
  }
  return null;
}

/** The saved folder, preferring the current location and falling back to the pre-move one. */
export function loadPersistedJournalDir(projectRoot: string): string | null {
  return (
    readJournalDirFrom(resolveJournalPathsPath()) ?? readJournalDirFrom(path.join(projectRoot, PATHS_FILE))
  );
}

/** Write the preference to the current location. Best-effort: a read-only home is not fatal. */
export function persistJournalDirPreference(journalDir: string): void {
  try {
    writeFileSync(
      resolveJournalPathsPath(),
      `${JSON.stringify({ journalDir: path.normalize(journalDir.trim()) }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    /* optional */
  }
}

/** `ED_JOURNAL_DIR` wins, then the saved preference, then the platform default. */
export function resolveInitialJournalDir(projectRoot: string): string {
  const env = process.env.ED_JOURNAL_DIR?.trim();
  if (env) return path.normalize(env);
  return loadPersistedJournalDir(projectRoot) ?? DEFAULT_JOURNAL_DIR;
}
