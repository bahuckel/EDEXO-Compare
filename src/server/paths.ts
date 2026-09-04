import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve as pathResolve } from "node:path";

/** File name only; full path from {@link resolveUserSettingsJsonPath}. */
export const USER_SETTINGS_FILENAME = "edexo-compare-user-settings.json";

/**
 * Writable JSON for user preferences (bacterium, map +/++ CR, exploration scan in data value).
 * - Electron: set `EDEXO_USER_DATA_DIR` from `app.getPath("userData")` in `electron/main.cjs`.
 * - Else: OS app data dir under the user profile (survives reinstalls / new builds).
 */
export function resolveUserSettingsJsonPath(): string {
  const forced = process.env.EDEXO_USER_DATA_DIR?.trim();
  let dir: string;
  if (forced) {
    dir = forced;
  } else if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    dir = join(local && local.length > 0 ? local : join(homedir(), "AppData", "Local"), "ED Exo Compare");
  } else if (process.platform === "darwin") {
    dir = join(homedir(), "Library", "Application Support", "ED Exo Compare");
  } else {
    const xdg = process.env.XDG_CONFIG_HOME;
    dir = join(xdg && xdg.length > 0 ? xdg : join(homedir(), ".config"), "edexo-compare");
  }
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* write may still fail; persistence is best-effort */
  }
  return join(dir, USER_SETTINGS_FILENAME);
}

/**
 * LAN access key (see lanAuth.ts). Its own file, next to the user settings: a key does not belong
 * in a settings JSON that gets pasted into bug reports, and deleting just this file re-pairs every
 * device without losing preferences.
 */
export function resolveLanKeyPath(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "edexo-compare-lan-key.txt");
}

/**
 * Species the commander found that the app failed to offer (see exoOutlierLog.ts). Its own file
 * beside the user settings: append-only evidence that must survive a cache rebuild, since a cache is
 * regenerated routinely and this is the only record of what the predictor got wrong.
 */
export function resolveExoOutlierLogPath(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "edexo-outliers.jsonl");
}

/**
 * Writable journal merge cache (fast launcher / boot). Same tree as user settings — survives
 * `npm run build`, Electron `resources/` replacement, and unpackaged installs.
 */
export function resolveJournalMergeCacheRoot(): string {
  const base = dirname(resolveUserSettingsJsonPath());
  const dir = join(base, ".edexo-cache");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* best-effort */
  }
  return dir;
}

/** Pre-user-data-cache location: `<projectRoot>/.edexo-cache` (lost when resources are rebuilt). */
export function projectLocalJournalMergeCacheDir(projectRoot: string): string {
  return join(projectRoot, ".edexo-cache");
}

/**
 * Additional project roots to mirror `fixes_*` JSON stubs (semicolon-separated absolute paths).
 * Each path should be an ED-Exo “project root” (contains `data/species/`), e.g. dev repo while the app runs from Electron resources.
 */
export function getExoDataFixWriteRoots(): string[] {
  const out: string[] = [];
  const primary = getProjectRoot();
  if (primary) out.push(primary);
  const speciesDir = getSpeciesDataDir(primary);
  const alt = speciesDataDirParentProjectRoot(speciesDir);
  if (alt && !out.includes(alt)) out.push(alt);
  const raw = process.env.EDEXO_FIX_EXTRA_SPECIES_ROOTS?.trim();
  if (raw) {
    for (const part of raw.split(/[;|]/)) {
      const t = part.trim();
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

/**
 * Live species tree (`<genusDir>/<genus>.json`, `exomastery/`, photos): defaults to
 * `<projectRoot>/data/species`, or absolute path from env `EDEXO_SPECIES_DATA_DIR` when set and present.
 * In packaged Electron the real project root is often `resources/` — set the env var (or portable
 * `data/species` next to the .exe, or `species-data-dir.json` in userData) so new exomastery files
 * in a dev repo are visible after **Refresh exomastery**.
 */
export function getSpeciesDataDir(projectRoot: string): string {
  const forced = process.env.EDEXO_SPECIES_DATA_DIR?.trim();
  if (forced) {
    const norm = forced.replace(/[/\\]+$/, "");
    try {
      if (existsSync(norm) && statSync(norm).isDirectory()) return norm;
    } catch {
      /* ignore */
    }
  }
  return join(projectRoot, "data", "species");
}

/**
 * Re-run the same discovery as `electron/main.cjs` `applySpeciesDataDirFromElectron` (portable
 * `<exeDir>/data/species`, then `species-data-dir.json` next to user settings).
 *
 * Call on **Refresh exomastery** so folders or config created after startup are honored without
 * restarting the app. When `EDEXO_SPECIES_DATA_DIR` is already set, does nothing — matching
 * Electron (explicit env or path chosen at boot is left unchanged).
 */
export function reapplySpeciesDataDirDiscoveryFromDisk(): void {
  if (process.env.EDEXO_SPECIES_DATA_DIR?.trim()) return;
  for (const base of portableCandidateDirs()) {
    const portable = join(base, "data", "species");
    try {
      if (existsSync(portable) && statSync(portable).isDirectory()) {
        process.env.EDEXO_SPECIES_DATA_DIR = portable.replace(/[/\\]+$/, "");
        return;
      }
    } catch {
      /* ignore */
    }
  }
  try {
    const cfg = join(dirname(resolveUserSettingsJsonPath()), "species-data-dir.json");
    if (!existsSync(cfg)) return;
    const raw = readFileSync(cfg, "utf8");
    const j = JSON.parse(raw) as { speciesDataDir?: unknown };
    const p = typeof j.speciesDataDir === "string" ? j.speciesDataDir.trim() : "";
    if (!p) return;
    const resolved = pathResolve(p);
    if (existsSync(resolved) && statSync(resolved).isDirectory()) {
      process.env.EDEXO_SPECIES_DATA_DIR = resolved;
    }
  } catch {
    /* invalid JSON or missing file */
  }
}

/**
 * When species live at `<root>/data/species`, returns `<root>` (for fix stubs and extra write roots).
 */
export function speciesDataDirParentProjectRoot(speciesDataDir: string): string | null {
  const norm = speciesDataDir.replace(/[/\\]+$/, "");
  try {
    if (basename(norm).toLowerCase() !== "species") return null;
    const dataDir = dirname(norm);
    if (basename(dataDir).toLowerCase() !== "data") return null;
    return dirname(dataDir);
  } catch {
    return null;
  }
}

function bundledDir(): string {
  if (typeof __dirname === "string" && __dirname.length > 0) {
    return __dirname;
  }
  const script = process.argv[1];
  if (script) return dirname(script);
  return dirname(process.execPath);
}

/** Candidate install dirs: pkg/yao-pkg can differ between execPath and argv[0]. */
function portableCandidateDirs(): string[] {
  const out: string[] = [];
  const push = (d: string) => {
    if (d && !out.includes(d)) out.push(d);
  };
  try {
    push(dirname(process.execPath));
  } catch {
    /* ignore */
  }
  try {
    const a0 = process.argv[0];
    if (a0 && /\.exe$/i.test(a0)) push(dirname(a0));
  } catch {
    /* ignore */
  }
  return out;
}

/** Next to the .exe: `data/species/` (per-genus JSON tree), `web/index.html`, or legacy `dist/web/index.html`. */
export function getPortableExeRoot(): string | null {
  const markers: string[][] = [
    ["data", "species"],
    ["web", "index.html"],
    ["dist", "web", "index.html"],
  ];
  for (const base of portableCandidateDirs()) {
    for (const parts of markers) {
      if (existsSync(join(base, ...parts))) return base;
    }
  }
  return null;
}

/** Vite output lives under `web/` (release zip) or `dist/web/` (dev repo). */
export function getWebRoot(projectRoot: string): string {
  if (existsSync(join(projectRoot, "web", "index.html"))) return join(projectRoot, "web");
  return join(projectRoot, "dist", "web");
}

/**
 * Electron-packaged app: `web/` + `data/` live under `process.resourcesPath`.
 * `electron/main.cjs` sets `EDEXO_ELECTRON_PACKAGED` + `EDEXO_RESOURCES_ROOT` before loading
 * the server bundle so this code never `require("electron")` (keeps @yao-pkg/pkg CLI exes lean).
 */
function electronPackagedResourcesRoot(): string | null {
  try {
    if (process.env.EDEXO_ELECTRON_PACKAGED === "1") {
      const res = process.env.EDEXO_RESOURCES_ROOT?.trim();
      if (res && existsSync(join(res, "web", "index.html"))) return res;
    }
    // Fallback if an older main did not set env: real packaged layout under resourcesPath
    const v = process.versions as { electron?: string };
    const resPath = process.resourcesPath;
    if (v?.electron && resPath) {
      if (existsSync(join(resPath, "web", "index.html")) && existsSync(join(resPath, "edexo", "app.cjs"))) {
        return resPath;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Dev (tsx): argv[1] → src/server.
 * Built: argv[1] → build/app.cjs.
 * pkg: __dirname inside snapshot …/build.
 * Portable: folder containing the .exe (peer `web/` + `data/`).
 * Electron: resources folder with `web/index.html`.
 */
export function getProjectRoot(): string {
  const electronRes = electronPackagedResourcesRoot();
  if (electronRes) return electronRes;

  const portable = getPortableExeRoot();
  if (portable) return portable;

  const isPkg = typeof (process as NodeJS.Process & { pkg?: unknown }).pkg !== "undefined";
  const here = bundledDir();
  if (isPkg) return join(here, "..");

  if (existsSync(join(here, "devEntry.ts"))) {
    return join(here, "..", "..");
  }

  if (existsSync(join(here, "..", "dist", "web", "index.html"))) {
    return join(here, "..");
  }

  return join(here, "..", "..");
}
