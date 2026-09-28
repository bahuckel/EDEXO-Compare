/**
 * Finding Elite's journals on Linux (docs/linux-plan-28092026.md, Phase A). The game runs in a Proton
 * or Wine prefix; these drive the search over a fake file tree shaped like the real launchers'.
 */
import { describe, expect, it } from "vitest";
import {
  elitePrefixes,
  findLinuxJournalDirs,
  optionsDirForJournalDir,
  steamLibraries,
  type ProtonFs,
} from "../src/server/protonJournals.js";
import { eliteDisplaySettingsPath } from "../src/server/eliteDisplayMode.js";

const HOME = "/home/cmdr";
const ELITE = "Saved Games/Frontier Developments/Elite Dangerous";

/** A file tree from a list of files (with optional mtimes) and their text. */
function tree(files: Record<string, string | number>): ProtonFs {
  const dirs = new Set<string>();
  for (const f of Object.keys(files)) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join("/") || "/");
  }
  return {
    isDir: (p) => dirs.has(p),
    readText: (p) => (typeof files[p] === "string" ? (files[p] as string) : null),
    listDir: (p) => {
      const out = new Set<string>();
      for (const f of [...Object.keys(files), ...dirs]) {
        if (f.startsWith(p + "/")) out.add(f.slice(p.length + 1).split("/")[0]!);
      }
      return [...out];
    },
    mtimeMs: (p) => (typeof files[p] === "number" ? (files[p] as number) : null),
  };
}

const steamPrefix = (lib: string) => `${lib}/steamapps/compatdata/359320/pfx`;
const journal = (prefix: string, name: string, t: number) => ({
  [`${prefix}/drive_c/users/steamuser/${ELITE}/${name}`]: t,
});

describe("Steam", () => {
  it("reads every library from libraryfolders.vdf, the root included", () => {
    const fs = tree({
      [`${HOME}/.local/share/Steam/steamapps/libraryfolders.vdf`]: `"libraryfolders"
{
  "0" { "path"  "/home/cmdr/.local/share/Steam" }
  "1" { "path"  "/mnt/games/SteamLibrary" }
}`,
    });
    expect(steamLibraries(`${HOME}/.local/share/Steam`, fs)).toEqual([
      `${HOME}/.local/share/Steam`,
      "/mnt/games/SteamLibrary",
    ]);
  });

  it("finds Elite's prefix in a second library", () => {
    const fs = tree({
      [`${HOME}/.local/share/Steam/steamapps/libraryfolders.vdf`]: `"path" "/mnt/games/SteamLibrary"`,
      ...journal(steamPrefix("/mnt/games/SteamLibrary"), "Journal.2026-09-28T100000.01.log", 5),
    });
    const found = findLinuxJournalDirs(HOME, fs);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      dir: `/mnt/games/SteamLibrary/steamapps/compatdata/359320/pfx/drive_c/users/steamuser/${ELITE}`,
      source: "Steam",
    });
  });

  it("lists one install once, when ~/.steam/steam is a link to ~/.local/share/Steam", () => {
    const real = `${HOME}/.local/share/Steam`;
    const base = tree(journal(steamPrefix(real), "Journal.2026-09-28T100000.01.log", 5));
    const fs: ProtonFs = {
      ...base,
      isDir: (p) => base.isDir(p.replace(`${HOME}/.steam/steam`, real)),
      listDir: (p) => base.listDir(p.replace(`${HOME}/.steam/steam`, real)),
      realPath: (p) => p.replace(`${HOME}/.steam/steam`, real),
    };
    expect(findLinuxJournalDirs(HOME, fs)).toHaveLength(1);
  });

  it("finds Flatpak Steam", () => {
    const flatpak = `${HOME}/.var/app/com.valvesoftware.Steam/.local/share/Steam`;
    const fs = tree(journal(steamPrefix(flatpak), "Journal.2026-09-28T100000.01.log", 5));
    expect(findLinuxJournalDirs(HOME, fs)[0]?.source).toBe("Steam (Flatpak)");
  });
});

describe("Heroic and Lutris", () => {
  it("finds a Heroic prefix with Proton (pfx/) and a Lutris one (drive_c/ directly)", () => {
    const fs = tree({
      ...journal(`${HOME}/Games/Heroic/Prefixes/EliteDangerous/pfx`, "Journal.a.log", 1),
      [`${HOME}/Games/elite-dangerous/drive_c/users/cmdr/${ELITE}/Journal.b.log`]: 2,
    });
    const prefixes = elitePrefixes(HOME, fs);
    expect(prefixes).toEqual([
      { source: "Heroic", prefix: `${HOME}/Games/Heroic/Prefixes/EliteDangerous/pfx` },
      { source: "Lutris", prefix: `${HOME}/Games/elite-dangerous` },
    ]);
  });
});

describe("several installs", () => {
  it("puts the folder with the newest journal first", () => {
    const steam = `${HOME}/.local/share/Steam`;
    const fs = tree({
      ...journal(steamPrefix(steam), "Journal.2026-01-01T100000.01.log", 100),
      ...journal(`${HOME}/Games/Heroic/Prefixes/Elite/pfx`, "Journal.2026-09-28T100000.01.log", 900),
    });
    const found = findLinuxJournalDirs(HOME, fs);
    expect(found.map((f) => f.source)).toEqual(["Heroic", "Steam"]);
    expect(found[0]!.newestJournalMs).toBe(900);
  });

  it("finds nothing on a machine without the game", () => {
    expect(findLinuxJournalDirs(HOME, tree({ [`${HOME}/Documents/x.txt`]: "x" }))).toEqual([]);
  });
});

describe("Elite's display settings, beside the journals", () => {
  const dir = `${steamPrefix(`${HOME}/.local/share/Steam`)}/drive_c/users/steamuser/${ELITE}`;

  it("maps the journal folder to the same user's Options folder", () => {
    expect(optionsDirForJournalDir(dir)).toBe(
      `${steamPrefix(`${HOME}/.local/share/Steam`)}/drive_c/users/steamuser/AppData/Local/Frontier Developments/Elite Dangerous/Options`,
    );
    expect(optionsDirForJournalDir("/somewhere/else")).toBeNull();
  });

  it("is used off Windows only; Windows keeps %LOCALAPPDATA%", () => {
    expect(eliteDisplaySettingsPath(dir, "linux").replace(/\\/g, "/")).toMatch(
      /steamuser\/AppData\/Local\/Frontier Developments\/Elite Dangerous\/Options\/Graphics\/DisplaySettings\.xml$/,
    );
    expect(eliteDisplaySettingsPath(dir, "win32")).not.toContain("steamuser");
  });
});
