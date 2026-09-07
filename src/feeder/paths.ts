/**
 * Where the feeder keeps its working data, now that it lives inside the app.
 *
 * The feeder used to be a separate project with its own `data/` folder, and the profiles it built
 * had to be exported from a browser and copied into `data/species/<genus>/exomastery/` by hand. That
 * is the entire reason 76 profiles shipped while two were stale and three were never copied at all.
 * The analysis now runs here and writes where the app reads, so the export step has no reason to
 * exist.
 *
 * What does *not* move is the raw sample corpus — 247 MB of per-body EDSM records across 34,000
 * files. It is a build input, not a shipped asset, and it stays out of git. Resolution order:
 *
 *   1. `EDEXO_FEEDER_DATA_DIR`, if set — for a corpus kept on another drive.
 *   2. `feeder-data-dir.json` in user data, the path the owner picked in Options.
 *   3. `<repo>/feeder-data`, the intended home (gitignored).
 *   4. `../exomastery-feeder/data`, the old sibling checkout — so a machine that already holds the
 *      corpus keeps working without moving 266 MB first.
 *
 * **Rung 2 exists because rungs 3 and 4 cannot work in a packaged build.** Both are relative to
 * `PROJECT_ROOT`, which in the installed app is the resources directory inside `win-unpacked`, so
 * they resolve to two folders that will never exist and the feeder reports itself unavailable. The
 * owner's corpus sits beside the *repository*, which the exe has no way to find and no business
 * guessing at. The dev server found it and the shipped app never could — the toolbar entry was
 * gated on `feederDataDirExists()`, so a feature that merged correctly was invisible to the only
 * person who has a corpus.
 *
 * Nothing here creates directories; {@link feederDataDirExists} lets a caller find out whether there
 * is a corpus at all before offering to do anything with it.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getProjectRoot, resolveUserSettingsJsonPath } from "../server/paths.js";

/**
 * The repository root.
 *
 * `import.meta.url` is the obvious way for a module to find its own directory, and it is a trap
 * here: `scripts/bundle.mjs` emits CJS, esbuild replaces `import.meta` with an empty object in that
 * format (and warns about it), and `fileURLToPath(undefined)` throws *"The 'path' argument must be
 * of type string or an instance of URL"* at import time. The Options status panel imports this
 * module through `server/feederStatus.ts`, so the packaged app refused to start at all —
 * `openUrl.ts` carries a comment warning about exactly this hazard in a third-party package.
 *
 * The app's own resolver already answers the question in every shape this code runs in: Electron,
 * portable exe, pkg, the CJS bundle, `tsx` for the feeder CLI, and vitest. Use it, and keep
 * `import.meta` out of anything the bundler will see.
 */
export const PROJECT_ROOT = getProjectRoot();

/** The pointer file that survives a reinstall, beside the other user settings. */
export function feederDataDirConfigPath(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "feeder-data-dir.json");
}

/** The remembered corpus path, or null when none is set or it no longer exists. */
export function configuredFeederDataDir(): string | null {
  try {
    const cfg = feederDataDirConfigPath();
    if (!existsSync(cfg)) return null;
    const j = JSON.parse(readFileSync(cfg, "utf8")) as { feederDataDir?: unknown };
    const p = typeof j.feederDataDir === "string" ? j.feederDataDir.trim() : "";
    if (!p) return null;
    const abs = resolve(p);
    return existsSync(abs) && statSync(abs).isDirectory() ? abs : null;
  } catch {
    return null; // invalid JSON, unreadable file — same answer as none set
  }
}

/**
 * Remember a corpus directory, or forget it when passed null.
 *
 * Validates before writing: a path that is not a directory is rejected rather than stored, because a
 * pointer to nothing is indistinguishable from no pointer at the next boot and the commander would
 * be told their choice took effect.
 */
export function setConfiguredFeederDataDir(dir: string | null): { ok: boolean; error?: string } {
  const cfg = feederDataDirConfigPath();
  try {
    if (dir == null || !dir.trim()) {
      writeFileSync(cfg, JSON.stringify({ feederDataDir: "" }, null, 2), "utf8");
      resolvedDataDir = null;
      return { ok: true };
    }
    const abs = resolve(dir.trim());
    if (!existsSync(abs)) return { ok: false, error: "Path does not exist." };
    if (!statSync(abs).isDirectory()) return { ok: false, error: "Corpus path must be a folder." };
    mkdirSync(dirname(cfg), { recursive: true });
    writeFileSync(cfg, JSON.stringify({ feederDataDir: abs }, null, 2), "utf8");
    resolvedDataDir = null; // re-resolve on the next read rather than serving the old answer
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the path." };
  }
}

/** Candidate corpus locations, most specific first. */
function candidateDataDirs(): string[] {
  const out: string[] = [];
  const env = process.env.EDEXO_FEEDER_DATA_DIR?.trim();
  if (env) out.push(resolve(env));
  const configured = configuredFeederDataDir();
  if (configured) out.push(configured);
  out.push(join(PROJECT_ROOT, "feeder-data"));
  out.push(resolve(PROJECT_ROOT, "..", "exomastery-feeder", "data"));
  return out;
}

/** Everywhere the app looks, in order — so an unavailable feeder can say where it looked. */
export function feederDataDirCandidates(): string[] {
  return candidateDataDirs();
}

let resolvedDataDir: string | null = null;

/**
 * The corpus directory in use. Falls back to `<repo>/feeder-data` when none of the candidates
 * exists yet, so a first run has somewhere to create.
 *
 * The result is cached, so anything that changes the answer must clear it — see
 * {@link setConfiguredFeederDataDir}.
 */
export function feederDataDir(): string {
  if (resolvedDataDir) return resolvedDataDir;
  const candidates = candidateDataDirs();
  const fallback = candidates.find((d) => d.endsWith("feeder-data")) ?? candidates[candidates.length - 1]!;
  resolvedDataDir = candidates.find((d) => existsSync(d)) ?? fallback;
  return resolvedDataDir;
}

/** Test seam / CLI override: point every path below at a different corpus. */
export function setFeederDataDirForTests(dir: string | null): void {
  resolvedDataDir = dir;
}

export function feederDataDirExists(): boolean {
  return existsSync(feederDataDir());
}

/** Cached EDSM system responses, one file per system. */
export function rawSystemsDir(): string {
  return join(feederDataDir(), "raw", "systems");
}

/** `raw/planets/<species slug>/sample_N.json` — one pack per observed occurrence. */
export function rawPlanetsDir(): string {
  return join(feederDataDir(), "raw", "planets");
}

/** Legacy JSON mirror of the species index. The SQLite store is the source of truth. */
export function indexPath(): string {
  return join(feederDataDir(), "exomastery_index.json");
}

export function feederDbPath(): string {
  return join(feederDataDir(), "feeder_store.sqlite");
}

/** Per-species EDSM hydration resume state, so a rate-limited run picks up where it stopped. */
export function fetchCheckpointsDir(): string {
  return join(feederDataDir(), "fetch_checkpoints");
}

/** Where the app reads profiles from — the whole point of the merge. */
export function speciesDataDir(): string {
  return join(PROJECT_ROOT, "data", "species");
}
