/**
 * The galaxy map's index files, as a separate download (owner, 2026-10-04, plan 4.2: "separate download
 * button marked as EDAstro again, with size").
 *
 * `bio-index.bin` (every system with recorded biology, from EDAstro's codex export) and
 * `system-traits.bin.gz` (their stars and planets, from Spansh's dump) were a quarter of a gigabyte of
 * every download, for a map not everyone opens. Builds leave them out (scripts/packagedData.mjs); the
 * map offers them from a fixed GitHub release and they land beside the user's settings, where an
 * update leaves them alone. A developer tree keeps reading its own `data/galaxy/` copies.
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getProjectRoot, resolveUserSettingsJsonPath } from "./paths.js";

export const GALAXY_INDEX_FILES = ["bio-index.bin", "system-traits.bin.gz"] as const;
export type GalaxyIndexFile = (typeof GALAXY_INDEX_FILES)[number];

/** Where the release keeps them: one release, updated when the index is rebuilt. */
export const GALAXY_INDEX_BASE_URL = "https://github.com/bahuckel/EDEXO-Compare/releases/download/galaxy-index";

function userGalaxyDir(): string {
  return path.join(path.dirname(resolveUserSettingsJsonPath()), "galaxy");
}

/** The file to read: the downloaded copy when there is one, else the project's `data/galaxy/`. */
export function galaxyIndexFilePath(name: GalaxyIndexFile, projectRoot = getProjectRoot()): string {
  const own = path.join(userGalaxyDir(), name);
  if (existsSync(own)) return own;
  return path.join(projectRoot, "data", "galaxy", name);
}

export interface GalaxyIndexStatus {
  /** The bio index is readable, so the map can draw. */
  present: boolean;
  files: { name: GalaxyIndexFile; bytes: number | null }[];
  /** A download in progress: bytes so far and the total, when the server said it. */
  downloading: { name: GalaxyIndexFile; done: number; total: number | null } | null;
  error: string | null;
  /** What the download would weigh (from the release), for the button; null until asked. */
  downloadBytes: number | null;
  /**
   * The release holds other files than these (a size differs; owner, 2026-10-07: "I still don't see a
   * way to download the index" once one was there). Null until the release has been asked.
   */
  updateAvailable: boolean | null;
}

let downloading: GalaxyIndexStatus["downloading"] = null;
let lastError: string | null = null;
let downloadBytes: number | null = null;
/** Each file's size on the release, from the last probe. */
let remoteSizes: Map<string, number> | null = null;

export function galaxyIndexStatus(): GalaxyIndexStatus {
  const files = GALAXY_INDEX_FILES.map((name) => {
    const p = galaxyIndexFilePath(name);
    let bytes: number | null = null;
    try {
      bytes = existsSync(p) ? statSync(p).size : null;
    } catch {
      bytes = null;
    }
    return { name, bytes };
  });
  const updateAvailable = remoteSizes ? files.some((f) => f.bytes != null && f.bytes !== remoteSizes!.get(f.name)) : null;
  return { present: files[0]!.bytes != null, files, downloading, error: lastError, downloadBytes, updateAvailable };
}

/** Ask the release how big the files are (HEAD requests), for the button's label. Quiet on failure. */
export async function probeGalaxyIndexSize(fetchImpl: typeof fetch = fetch): Promise<number | null> {
  try {
    let total = 0;
    const sizes = new Map<string, number>();
    for (const name of GALAXY_INDEX_FILES) {
      const r = await fetchImpl(`${GALAXY_INDEX_BASE_URL}/${name}`, { method: "HEAD", redirect: "follow" });
      const n = Number(r.headers.get("content-length"));
      if (!r.ok || !Number.isFinite(n) || n <= 0) return null;
      sizes.set(name, n);
      total += n;
    }
    downloadBytes = total;
    remoteSizes = sizes;
    return total;
  } catch {
    return null;
  }
}

/**
 * Download both files into the user's folder, one after the other, each to a `.part` file renamed into
 * place when complete — a cut download never looks like an index. `onDone` clears the caches that read
 * them. A second call while one runs is ignored.
 */
export async function downloadGalaxyIndex(onDone: () => void, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (downloading) return;
  lastError = null;
  const dir = userGalaxyDir();
  mkdirSync(dir, { recursive: true });
  try {
    for (const name of GALAXY_INDEX_FILES) {
      downloading = { name, done: 0, total: null };
      const r = await fetchImpl(`${GALAXY_INDEX_BASE_URL}/${name}`, { redirect: "follow" });
      if (!r.ok || !r.body) throw new Error(`${name}: HTTP ${r.status}`);
      const total = Number(r.headers.get("content-length"));
      downloading = { name, done: 0, total: Number.isFinite(total) && total > 0 ? total : null };
      const part = path.join(dir, `${name}.part`);
      const body = Readable.fromWeb(r.body as import("node:stream/web").ReadableStream<Uint8Array>);
      body.on("data", (chunk: Buffer) => {
        if (downloading) downloading = { ...downloading, done: downloading.done + chunk.length };
      });
      await pipeline(body, createWriteStream(part));
      renameSync(part, path.join(dir, name));
    }
    downloading = null;
    remoteSizes = null; // asked again next time: the files here are now the release's
    onDone();
  } catch (e) {
    downloading = null;
    lastError = e instanceof Error ? e.message : String(e);
    for (const name of GALAXY_INDEX_FILES) rmSync(path.join(dir, `${name}.part`), { force: true });
  }
}
