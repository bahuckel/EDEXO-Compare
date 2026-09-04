import path from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { deserialize, serialize } from "node:v8";
import { perfTime } from "./perf.js";
import {
  decodeJournalMergeCache,
  encodeJournalMergeCache,
  JOURNAL_MERGE_CACHE_ENCODING,
} from "./journalMergeCacheEncoding.js";
import { promises as fsp } from "node:fs";
import type { GameStateStore } from "./gameState.js";
import { JOURNAL_MERGE_CACHE_FORMAT, type JournalMergeCachePayload } from "./gameState.js";
import type { JournalHistoryPreset } from "../shared/journalHistoryPreset.js";
import { projectLocalJournalMergeCacheDir, resolveJournalMergeCacheRoot } from "./paths.js";

/**
 * Wrapper version for the JSON file envelope (payload has its own {@link JOURNAL_MERGE_CACHE_FORMAT}).
 * Bumped to 2 when the payload gained the compact on-disk encoding — a v1 meta is ignored, so the
 * cache is simply rebuilt from the journals on first run.
 */
const JOURNAL_CACHE_FILE_VERSION = 2;

export type JournalFileFingerprint = { baseName: string; size: number; mtimeMs: number };

type JournalMergeMetaFile = {
  version: typeof JOURNAL_CACHE_FILE_VERSION;
  journalDir: string;
  files: JournalFileFingerprint[];
  /** Must match payload embedded `format`. */
  payloadFormat: number;
  /** On-disk encoding of the payload file; see journalMergeCacheEncoding.ts. */
  payloadEncoding?: number;
  /** Rolling journal window; absent on older caches (= treat as "all"). */
  journalHistoryPreset?: JournalHistoryPreset;
};

/** Incremental replay after hydrating a payload (newest log tail and/or brand-new log files). */
export type JournalCacheReplayStep =
  | { kind: "tail"; path: string; startByte: number }
  | { kind: "full"; path: string };

export type JournalCacheLoadResult =
  | { hit: false }
  | {
      hit: true;
      payload: JournalMergeCachePayload;
      steps: JournalCacheReplayStep[];
      /** True when cache was read from `<projectRoot>/.edexo-cache` (migrate to user data on save). */
      loadedFromLegacy: boolean;
    };

type PrepareFromDirResult =
  | { hit: false }
  | { hit: true; payload: JournalMergeCachePayload; steps: JournalCacheReplayStep[] };

function journalMergeMetaPathInDir(cacheDir: string): string {
  return path.join(cacheDir, "journal-merge.meta.json");
}

/**
 * Payload container: `v8.serialize` + gzip.
 *
 * The structural encoding (journalMergeCacheEncoding.ts) took the file from 20.8 MB to 15.1 MB;
 * this container takes the same data to ~3 MB at the same load cost, measured on the reference
 * history: JSON 15.15 MB / 77 ms parse vs v8+gzip 3.08 MB / 77 ms read. JSON+gzip is 0.7 MB
 * smaller but 35 ms slower, and plain v8 saves almost nothing without the gzip.
 */
function journalMergePayloadPathInDir(cacheDir: string): string {
  return path.join(cacheDir, "journal-merge.payload.v8gz");
}

/** @deprecated JSON payload written before the v8+gzip container; deleted on the next save. */
function journalMergeJsonPayloadPathInDir(cacheDir: string): string {
  return path.join(cacheDir, "journal-merge.payload.json");
}

/** @deprecated Single-file cache from v1 — removed after first save with split files. */
function journalMergeSingleFilePathInDir(cacheDir: string): string {
  return path.join(cacheDir, "journal-merge.json");
}

/** @deprecated Use {@link resolveJournalMergeCacheRoot} — kept for external callers/tests. */
export function journalMergeCacheDir(projectRoot: string): string {
  return projectLocalJournalMergeCacheDir(projectRoot);
}

export function journalMergeMetaPath(projectRoot: string): string {
  return journalMergeMetaPathInDir(projectLocalJournalMergeCacheDir(projectRoot));
}

export function journalMergePayloadPath(projectRoot: string): string {
  return journalMergePayloadPathInDir(projectLocalJournalMergeCacheDir(projectRoot));
}

export async function buildJournalFileManifest(fullPaths: string[]): Promise<JournalFileFingerprint[]> {
  const out: JournalFileFingerprint[] = [];
  for (const p of fullPaths) {
    const st = await fsp.stat(p);
    out.push({ baseName: path.basename(p), size: st.size, mtimeMs: st.mtimeMs });
  }
  return out;
}

function buildReplaySteps(
  c: JournalFileFingerprint[],
  m: JournalFileFingerprint[],
  paths: string[],
): JournalCacheReplayStep[] | null {
  const k = c.length;
  const n = m.length;
  if (n < k) return null;
  for (let i = 0; i < k; i++) {
    if (m[i]!.baseName !== c[i]!.baseName) return null;
  }
  for (let i = 0; i < k - 1; i++) {
    if (m[i]!.size !== c[i]!.size) return null;
  }
  if (m[k - 1]!.size < c[k - 1]!.size) return null;

  const lastMatches = m[k - 1]!.size === c[k - 1]!.size;
  const steps: JournalCacheReplayStep[] = [];

  if (lastMatches && n === k) return steps;

  if (!lastMatches && n === k) {
    steps.push({ kind: "tail", path: paths[k - 1]!, startByte: c[k - 1]!.size });
    return steps;
  }

  if (lastMatches && n > k) {
    for (let j = k; j < n; j++) {
      steps.push({ kind: "full", path: paths[j]! });
    }
    return steps;
  }

  if (!lastMatches && n > k) {
    steps.push({ kind: "tail", path: paths[k - 1]!, startByte: c[k - 1]!.size });
    for (let j = k; j < n; j++) {
      steps.push({ kind: "full", path: paths[j]! });
    }
    return steps;
  }

  return null;
}

function tryPrepareJournalCacheLoadFromDir(
  cacheDir: string,
  journalDirNorm: string,
  orderedFullPaths: string[],
  manifest: JournalFileFingerprint[],
  journalHistoryPreset: JournalHistoryPreset,
): PrepareFromDirResult {
  if (manifest.length === 0 || orderedFullPaths.length !== manifest.length) {
    return { hit: false };
  }

  const metaPath = journalMergeMetaPathInDir(cacheDir);
  const payloadPath = journalMergePayloadPathInDir(cacheDir);
  const legacySinglePath = journalMergeSingleFilePathInDir(cacheDir);

  if (existsSync(metaPath)) {
    let meta: JournalMergeMetaFile;
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf8")) as JournalMergeMetaFile;
    } catch {
      return { hit: false };
    }
    if (
      meta.version !== JOURNAL_CACHE_FILE_VERSION ||
      !meta.files?.length ||
      meta.payloadFormat !== JOURNAL_MERGE_CACHE_FORMAT ||
      meta.payloadEncoding !== JOURNAL_MERGE_CACHE_ENCODING
    ) {
      return { hit: false };
    }
    if (path.normalize(meta.journalDir) !== path.normalize(journalDirNorm)) return { hit: false };
    const metaPreset = meta.journalHistoryPreset ?? "all";
    if (metaPreset !== journalHistoryPreset) return { hit: false };

    const steps = buildReplaySteps(meta.files, manifest, orderedFullPaths);
    if (steps === null) return { hit: false };

    if (!existsSync(payloadPath)) return { hit: false };
    let payload: JournalMergeCachePayload;
    try {
      const decoded = perfTime("boot.mergeCacheParse", () => {
        const doc = readPayloadFile(payloadPath);
        return doc === null ? null : decodeJournalMergeCache(doc);
      });
      if (!decoded) return { hit: false };
      payload = decoded;
    } catch {
      return { hit: false };
    }
    if (payload.format !== JOURNAL_MERGE_CACHE_FORMAT) return { hit: false };

    return { hit: true, payload, steps };
  }

  if (existsSync(legacySinglePath)) {
    try {
      const doc = JSON.parse(readFileSync(legacySinglePath, "utf8")) as {
        version?: number;
        journalDir?: string;
        files?: JournalFileFingerprint[];
        payload?: JournalMergeCachePayload;
      };
      if (
        doc.version !== JOURNAL_CACHE_FILE_VERSION ||
        !doc.files?.length ||
        !doc.payload ||
        doc.payload.format !== JOURNAL_MERGE_CACHE_FORMAT
      ) {
        return { hit: false };
      }
      if (path.normalize(doc.journalDir ?? "") !== path.normalize(journalDirNorm)) {
        return { hit: false };
      }
      const docPreset = (doc as { journalHistoryPreset?: JournalHistoryPreset }).journalHistoryPreset ?? "all";
      if (docPreset !== journalHistoryPreset) return { hit: false };
      const steps = buildReplaySteps(doc.files, manifest, orderedFullPaths);
      if (steps === null) return { hit: false };
      return { hit: true, payload: doc.payload, steps };
    } catch {
      return { hit: false };
    }
  }

  return { hit: false };
}

/**
 * Reads **small** meta first; only loads and parses the large payload when fingerprints allow a fast path.
 * Tries persistent user-data cache first, then `<projectRoot>/.edexo-cache` for one-run migration.
 */
export function tryPrepareJournalCacheLoad(
  projectRoot: string,
  journalDirNorm: string,
  orderedFullPaths: string[],
  manifest: JournalFileFingerprint[],
  journalHistoryPreset: JournalHistoryPreset,
): JournalCacheLoadResult {
  const persistentDir = resolveJournalMergeCacheRoot();
  const a = tryPrepareJournalCacheLoadFromDir(
    persistentDir,
    journalDirNorm,
    orderedFullPaths,
    manifest,
    journalHistoryPreset,
  );
  if (a.hit) {
    return { hit: true, payload: a.payload, steps: a.steps, loadedFromLegacy: false };
  }

  const legacyDir = projectLocalJournalMergeCacheDir(projectRoot);
  const b = tryPrepareJournalCacheLoadFromDir(legacyDir, journalDirNorm, orderedFullPaths, manifest, journalHistoryPreset);
  if (b.hit) {
    return { hit: true, payload: b.payload, steps: b.steps, loadedFromLegacy: true };
  }

  return { hit: false };
}

function atomicWriteJson(filePath: string, obj: unknown): void {
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj), "utf8");
  renameSync(tmp, filePath);
}

/** Same atomic rename, but the payload container (see {@link journalMergePayloadPathInDir}). */
function atomicWritePayload(filePath: string, obj: unknown): void {
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, gzipSync(serialize(obj), { level: 6 }));
  renameSync(tmp, filePath);
}

/** Returns null when the file is missing or not a readable container. */
function readPayloadFile(filePath: string): unknown | null {
  try {
    return deserialize(gunzipSync(readFileSync(filePath)));
  } catch {
    return null;
  }
}

function unlinkQuiet(p: string): void {
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* ignore */
  }
}

/** Remove split + single-file cache files under one directory (best-effort). */
function clearJournalMergeFilesInDir(cacheDir: string): void {
  for (const p of [
    journalMergeMetaPathInDir(cacheDir),
    journalMergePayloadPathInDir(cacheDir),
    journalMergeJsonPayloadPathInDir(cacheDir),
    journalMergeSingleFilePathInDir(cacheDir),
  ]) {
    unlinkQuiet(p);
  }
}

/**
 * Writes journal merge cache under user data (survives rebuilds). Clears project-local cache
 * so stale duplicates are not left next to `resources/`.
 */
export function saveJournalMergeCache(
  journalDirNorm: string,
  manifest: JournalFileFingerprint[],
  store: GameStateStore,
  projectRoot: string,
  journalHistoryPreset: JournalHistoryPreset,
): void {
  if (manifest.length === 0) return;
  try {
    const dir = resolveJournalMergeCacheRoot();
    mkdirSync(dir, { recursive: true });
    const payload = store.serializeJournalMergePayload();
    const meta: JournalMergeMetaFile = {
      version: JOURNAL_CACHE_FILE_VERSION,
      journalDir: path.normalize(journalDirNorm),
      files: manifest,
      payloadFormat: JOURNAL_MERGE_CACHE_FORMAT,
      payloadEncoding: JOURNAL_MERGE_CACHE_ENCODING,
      journalHistoryPreset,
    };
    atomicWritePayload(journalMergePayloadPathInDir(dir), encodeJournalMergeCache(payload));
    atomicWriteJson(journalMergeMetaPathInDir(dir), meta);
    try {
      for (const stale of [journalMergeSingleFilePathInDir(dir), journalMergeJsonPayloadPathInDir(dir)]) {
        if (existsSync(stale)) unlinkSync(stale);
      }
    } catch {
      /* ignore */
    }
    clearJournalMergeFilesInDir(projectLocalJournalMergeCacheDir(projectRoot));
  } catch {
    /* non-fatal */
  }
}

export function removeJournalMergeCache(projectRoot: string): void {
  clearJournalMergeFilesInDir(resolveJournalMergeCacheRoot());
  clearJournalMergeFilesInDir(projectLocalJournalMergeCacheDir(projectRoot));
}
