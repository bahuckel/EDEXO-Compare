/**
 * Where Elite's journals are on Linux (owner, 2026-09-28: Linux build, docs/linux-plan-28092026.md).
 *
 * Elite runs on Linux through Proton (Steam) or Wine (Heroic, Lutris), inside a Windows-shaped
 * prefix, so the journals sit at the usual Windows place under that prefix's `drive_c`:
 *
 *   <prefix>/drive_c/users/steamuser/Saved Games/Frontier Developments/Elite Dangerous
 *
 * The old default, `~/.local/share/Frontier Developments/Elite Dangerous`, is a path the game never
 * writes to. The prefix is found where each launcher keeps it:
 *
 *  - **Steam**: `<library>/steamapps/compatdata/359320/pfx` (359320 is Elite's app id), in whichever
 *    library holds the game — every library listed in `steamapps/libraryfolders.vdf`. Steam's own
 *    folder is `~/.local/share/Steam` (also reached as `~/.steam/steam`), the Flatpak one
 *    `~/.var/app/com.valvesoftware.Steam/.local/share/Steam`, the Snap one
 *    `~/snap/steam/common/.local/share/Steam`.
 *  - **Heroic** (Epic): `~/Games/Heroic/Prefixes/<name>` — a Wine prefix, or `<name>/pfx` with Proton.
 *  - **Lutris**: `~/Games/<slug>` by default.
 *
 * Several found (a Steam and an Epic copy): the one whose newest journal is newest wins. Pure — the
 * file system comes in as an argument, so tests run the whole search on a fake tree.
 */
import path from "node:path";

export interface ProtonFs {
  isDir(p: string): boolean;
  readText(p: string): string | null;
  listDir(p: string): string[];
  mtimeMs(p: string): number | null;
  /** The path with symlinks resolved (`~/.steam/steam` is usually a link to `~/.local/share/Steam`). */
  realPath?(p: string): string;
}

/** Elite: Dangerous on Steam. */
export const ELITE_STEAM_APP_ID = "359320";

const ELITE_REL = ["Saved Games", "Frontier Developments", "Elite Dangerous"];
const OPTIONS_REL = ["AppData", "Local", "Frontier Developments", "Elite Dangerous", "Options"];

/** Steam's own folders, native, Flatpak and Snap. */
export function steamRoots(home: string): string[] {
  return [
    path.posix.join(home, ".local/share/Steam"),
    path.posix.join(home, ".steam/steam"),
    path.posix.join(home, ".steam/root"),
    path.posix.join(home, ".var/app/com.valvesoftware.Steam/.local/share/Steam"),
    path.posix.join(home, "snap/steam/common/.local/share/Steam"),
  ];
}

/** Every library in `libraryfolders.vdf` (`"path"  "/mnt/games/SteamLibrary"`), the root included. */
export function steamLibraries(root: string, fs: ProtonFs): string[] {
  const out = [root];
  const vdf = fs.readText(path.posix.join(root, "steamapps", "libraryfolders.vdf"));
  if (vdf) {
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
      const p = m[1]!.replace(/\\\\/g, "\\");
      if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

/** A Wine/Proton prefix (the folder holding `drive_c`), given a folder that is one or holds `pfx/`. */
function asPrefix(dir: string, fs: ProtonFs): string | null {
  if (fs.isDir(path.posix.join(dir, "pfx", "drive_c"))) return path.posix.join(dir, "pfx");
  if (fs.isDir(path.posix.join(dir, "drive_c"))) return dir;
  return null;
}

export interface ElitePrefix {
  /** Where it was found, for the launcher: "Steam", "Steam (Flatpak)", "Heroic", "Lutris". */
  source: string;
  prefix: string;
}

/** Every prefix that could hold Elite, most likely first, without duplicates. */
export function elitePrefixes(home: string, fs: ProtonFs): ElitePrefix[] {
  const out: ElitePrefix[] = [];
  const seen = new Set<string>();
  const add = (source: string, prefix: string | null) => {
    if (!prefix) return;
    const real = fs.realPath ? fs.realPath(prefix) : prefix;
    if (seen.has(real)) return;
    seen.add(real);
    out.push({ source, prefix: real });
  };
  for (const root of steamRoots(home)) {
    if (!fs.isDir(root)) continue;
    const source = root.includes("com.valvesoftware.Steam")
      ? "Steam (Flatpak)"
      : root.includes("/snap/")
        ? "Steam (Snap)"
        : "Steam";
    for (const lib of steamLibraries(root, fs)) {
      add(source, asPrefix(path.posix.join(lib, "steamapps", "compatdata", ELITE_STEAM_APP_ID), fs));
    }
  }
  const heroic = path.posix.join(home, "Games", "Heroic", "Prefixes");
  for (const name of fs.listDir(heroic)) add("Heroic", asPrefix(path.posix.join(heroic, name), fs));
  const games = path.posix.join(home, "Games");
  for (const name of fs.listDir(games)) {
    if (name === "Heroic") continue;
    add("Lutris", asPrefix(path.posix.join(games, name), fs));
  }
  return out;
}

/** The Elite journal folders inside one prefix (normally one, under `steamuser`). */
export function journalDirsInPrefix(prefix: string, fs: ProtonFs): string[] {
  const users = path.posix.join(prefix, "drive_c", "users");
  return fs
    .listDir(users)
    .map((u) => path.posix.join(users, u, ...ELITE_REL))
    .filter((d) => fs.isDir(d));
}

/** The newest `Journal.*.log` in a folder, as a time; 0 when there is none. */
export function newestJournalMs(dir: string, fs: ProtonFs): number {
  let best = 0;
  for (const f of fs.listDir(dir)) {
    if (!/^Journal\..*\.log$/.test(f)) continue;
    const t = fs.mtimeMs(path.posix.join(dir, f)) ?? 0;
    if (t > best) best = t;
  }
  return best;
}

export interface LinuxJournalCandidate {
  dir: string;
  source: string;
  newestJournalMs: number;
}

/** Every Elite journal folder found, the one with the newest journal first. */
export function findLinuxJournalDirs(home: string, fs: ProtonFs): LinuxJournalCandidate[] {
  const out: LinuxJournalCandidate[] = [];
  for (const { source, prefix } of elitePrefixes(home, fs)) {
    for (const dir of journalDirsInPrefix(prefix, fs)) {
      if (!out.some((c) => c.dir === dir))
        out.push({ dir, source, newestJournalMs: newestJournalMs(dir, fs) });
    }
  }
  return out.sort((a, b) => b.newestJournalMs - a.newestJournalMs);
}

/**
 * Elite's Options folder for a journal folder, when the journal folder has the Windows shape
 * (`…/<user>/Saved Games/Frontier Developments/Elite Dangerous`): the same user's
 * `AppData/Local/Frontier Developments/Elite Dangerous/Options`. That is where the game writes
 * `Graphics/DisplaySettings.xml` inside a Proton prefix. Null for any other shape.
 */
export function optionsDirForJournalDir(journalDir: string): string | null {
  const norm = journalDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const suffix = "/" + ELITE_REL.join("/");
  if (!norm.toLowerCase().endsWith(suffix.toLowerCase())) return null;
  return norm.slice(0, norm.length - suffix.length) + "/" + OPTIONS_REL.join("/");
}
