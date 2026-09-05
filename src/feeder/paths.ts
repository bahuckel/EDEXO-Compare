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
 *   2. `<repo>/feeder-data`, the intended home (gitignored).
 *   3. `../exomastery-feeder/data`, the old sibling checkout — so a machine that already holds the
 *      corpus keeps working without moving 266 MB first.
 *
 * Nothing here creates directories; {@link feederDataDirExists} lets a caller find out whether there
 * is a corpus at all before offering to do anything with it.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getProjectRoot } from "../server/paths.js";

/**
 * The repository root, resolved in a way the esbuild bundle survives.
 *
 * `import.meta.url` is the obvious answer and it is a trap here: `scripts/bundle.mjs` emits CJS, and
 * esbuild replaces `import.meta` with an empty object in that format. `fileURLToPath(undefined)`
 * then throws *"The 'path' argument must be of type string or an instance of URL"* at import time —
 * so the packaged app refused to start at all, from the moment the Options status panel pulled this
 * module into the server bundle. `openUrl.ts` carries a comment warning about exactly this hazard
 * for a third-party package; this file walked into it anyway.
 *
 * Under ESM (tsx, vitest) the meta URL is used as before, so the feeder CLI and the tests keep the
 * repository root they had. In the bundle it falls through to the app's own resolver, which already
 * knows about the Electron, portable, pkg and dev layouts.
 */
function resolveProjectRoot(): string {
  const metaUrl = (import.meta as unknown as { url?: string } | undefined)?.url;
  if (typeof metaUrl === "string" && metaUrl) {
    return resolve(dirname(fileURLToPath(metaUrl)), "..", "..");
  }
  return getProjectRoot();
}

export const PROJECT_ROOT = resolveProjectRoot();

/** Candidate corpus locations, most specific first. */
function candidateDataDirs(): string[] {
  const out: string[] = [];
  const env = process.env.EDEXO_FEEDER_DATA_DIR?.trim();
  if (env) out.push(resolve(env));
  out.push(join(PROJECT_ROOT, "feeder-data"));
  out.push(resolve(PROJECT_ROOT, "..", "exomastery-feeder", "data"));
  return out;
}

let resolvedDataDir: string | null = null;

/**
 * The corpus directory in use. Falls back to `<repo>/feeder-data` when none of the candidates
 * exists yet, so a first run has somewhere to create.
 */
export function feederDataDir(): string {
  if (resolvedDataDir) return resolvedDataDir;
  const candidates = candidateDataDirs();
  resolvedDataDir = candidates.find((d) => existsSync(d)) ?? candidates[1]!;
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
