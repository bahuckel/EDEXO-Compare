import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve as pathResolve } from "node:path";

/** File name only; full path from {@link resolveUserSettingsJsonPath}. */
export const USER_SETTINGS_FILENAME = "edexo-compare-user-settings.json";

/**
 * Writable JSON for user preferences (bacterium, map +/++ CR, exploration scan in data value).
 *
 * **One location for every entry point** — packaged Electron, dev server, CLI and probes alike.
 * Electron used to force this to `app.getPath("userData")`, which gave the packaged app its own
 * copy of the settings, the LAN key, the miss log and a 7.6 MB journal cache (§47). It now hands
 * that directory over as `EDEXO_LEGACY_USER_DATA_DIR` for {@link migrateLegacyUserData} instead.
 *
 * `EDEXO_USER_DATA_DIR` remains an explicit override for portable installs and tests; nothing sets
 * it automatically.
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
 * The commander's own EDSM account credentials (see edsmCredentials.ts).
 *
 * Its own file, next to the user settings and for the same reason the LAN key has one: a secret does
 * not belong in a settings JSON that gets pasted into bug reports. Deleting just this file turns the
 * auto-fetch off and leaves every other preference alone.
 */
export function resolveEdsmCredentialsPath(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "edexo-compare-edsm-key.json");
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
 * Why the app suggested what it suggested, body by body.
 *
 * Beside the outlier log and for the same reason: it is an observation the commander made, it never
 * ships, and it cannot be rebuilt from the journal — the narrowing it records is the app's own
 * changing opinion, which nothing else writes down.
 */
export function resolvePredictionAuditPath(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "edexo-predictions.json");
}

/**
 * Where plants were sampled and where the ship is parked — the overlay radar's memory.
 *
 * Its own file beside the user settings, and **not** part of the journal merge cache, because it is
 * not derived from the journal: `ScanOrganic` carries no coordinates, so a plant's position exists
 * only because this app read `Status.json` as the scan landed. A cache rebuilt from the logs cannot
 * regenerate it, which means losing this file loses the positions for good.
 */
export function resolveSurfaceMarksPath(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "edexo-surface-marks.json");
}

/**
 * The half-finished sampling run — which plant, how many scans down, and where each one was.
 *
 * Beside the user settings for the same reason the marks are, and it was not: it used to be written
 * to `<projectRoot>/data/`, which in the portable build is a temporary extraction directory that is
 * new on every launch. The file was written faithfully and then never found again, so a commander
 * who restarted the app mid-run came back to a tracker that knew nothing — no count, and none of
 * the positions, which exist nowhere else because `ScanOrganic` carries no coordinates.
 */
export function resolveOrganicSampleSessionPath(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "edexo-organic-sample-session.json");
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

/**
 * Where the app is installed, worked out once.
 *
 * Everything below answers by probing the filesystem, and the answer cannot change while the process
 * lives: it is derived from `process.execPath`, `argv` and environment variables that are all fixed
 * before the server starts. Recomputing it was costing more than everything else in the app put
 * together — a CPU profile of one system-map build (27 bodies, Blu Thua ML-P b47-2) spent **82 % of
 * its time in `existsSync`**, because the matcher asks each of the six observation modules for the
 * project root, once per species, once per body, three times over. Roughly a quarter of a million
 * stat calls to learn the same path. The map took 2.5 seconds to build and the window went
 * unresponsive, which is what the owner reported from the field.
 *
 * Cached as a three-state box rather than a truthy check, because `null` is a real answer for the
 * two that can return it.
 */
let cachedElectronRes: { v: string | null } | null = null;
let cachedPortableRoot: { v: string | null } | null = null;
let cachedProjectRoot: { v: string } | null = null;

/** Drop the memoized install paths. For tests that move the tree or rewrite the environment. */
export function resetInstallPathCache(): void {
  cachedElectronRes = null;
  cachedPortableRoot = null;
  cachedProjectRoot = null;
}

/** Next to the .exe: `data/species/` (per-genus JSON tree), `web/index.html`, or legacy `dist/web/index.html`. */
export function getPortableExeRoot(): string | null {
  if (cachedPortableRoot) return cachedPortableRoot.v;
  const v = computePortableExeRoot();
  cachedPortableRoot = { v };
  return v;
}

function computePortableExeRoot(): string | null {
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
  if (cachedElectronRes) return cachedElectronRes.v;
  const v = computeElectronPackagedResourcesRoot();
  cachedElectronRes = { v };
  return v;
}

function computeElectronPackagedResourcesRoot(): string | null {
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
  if (cachedProjectRoot) return cachedProjectRoot.v;
  const v = computeProjectRoot();
  cachedProjectRoot = { v };
  return v;
}

function computeProjectRoot(): string {
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
