import { createReadStream, promises as fs, unwatchFile, watchFile } from "node:fs";
import path from "node:path";
import type { JournalLine } from "../shared/types.js";

function isJournalFile(name: string): boolean {
  return name.startsWith("Journal.") && name.endsWith(".log");
}

/** Resolve + compare so Windows casing / equivalent paths do not force endless “new file” resyncs. */
function sameJournalPath(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  if (process.platform === "win32") {
    return ra.toLowerCase() === rb.toLowerCase();
  }
  return ra === rb;
}

/** Parse Elite journal filename time; fallback 0 (sort by name). */
function filenameUtcMs(name: string): number {
  const m = name.match(/^Journal\.(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})\./);
  if (!m) return 0;
  const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Best-effort log start time for filtering: parsed filename stamp, else file mtime. */
function journalFileLogicalStartUtcMs(name: string, mtimeMs: number): number {
  const fromName = filenameUtcMs(name);
  return fromName > 0 ? fromName : mtimeMs;
}

export type JournalListFilterOpts = {
  /** When set, omit logs whose logical start is strictly before this instant (UTC). */
  minFileStartUtcMs: number | null;
};

/**
 * All journal logs, oldest → newest (session order).
 * Uses embedded timestamp in the filename; ties / legacy names use mtime then name.
 */
export async function listJournalFilesChronological(
  journalDir: string,
  filter: JournalListFilterOpts = { minFileStartUtcMs: null },
): Promise<string[]> {
  try {
    const names = await fs.readdir(journalDir);
    const journals = names.filter(isJournalFile);
    const rows = await Promise.all(
      journals.map(async (name) => {
        const p = path.resolve(path.join(journalDir, name));
        const st = await fs.stat(p);
        const key = filenameUtcMs(name);
        return { p, name, key, mtime: st.mtimeMs };
      }),
    );
    rows.sort((a, b) => a.key - b.key || a.mtime - b.mtime || a.name.localeCompare(b.name));
    const cutoff = filter.minFileStartUtcMs;
    return rows
      .filter((r) => {
        if (cutoff == null) return true;
        return journalFileLogicalStartUtcMs(r.name, r.mtime) >= cutoff;
      })
      .map((r) => r.p);
  } catch {
    return [];
  }
}

export async function resolveLatestJournal(
  journalDir: string,
  filter: JournalListFilterOpts = { minFileStartUtcMs: null },
): Promise<string | null> {
  const all = await listJournalFilesChronological(journalDir, filter);
  return all.length ? all[all.length - 1]! : null;
}

async function processLines(
  chunk: string,
  leftover: { buf: string },
  onLine: (j: JournalLine) => void,
): Promise<void> {
  leftover.buf += chunk;
  const parts = leftover.buf.split(/\r?\n/);
  leftover.buf = parts.pop() ?? "";
  for (const line of parts) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      onLine(JSON.parse(t) as JournalLine);
    } catch {
      /* ignore */
    }
  }
}

export async function readJournalFull(filePath: string, onLine: (j: JournalLine) => void): Promise<void> {
  const leftover = { buf: "" };
  const text = await fs.readFile(filePath, "utf8");
  await processLines(text, leftover, onLine);
  if (leftover.buf.trim().startsWith("{")) {
    try {
      onLine(JSON.parse(leftover.buf) as JournalLine);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Apply journal lines appended after `startByte` (merged-cache fast path).
 * When `startByte > 0`, skips bytes until after the next newline so we never parse a truncated JSON line.
 */
export async function readJournalFromOffset(
  filePath: string,
  startByte: number,
  onLine: (j: JournalLine) => void,
): Promise<void> {
  const st = await fs.stat(filePath);
  if (startByte >= st.size) return;
  const leftover = { buf: "" };
  let discardUntilNl = startByte > 0;
  const stream = createReadStream(filePath, {
    start: startByte,
    end: st.size - 1,
    encoding: "utf8",
  });
  for await (const chunk of stream) {
    let s = chunk as string;
    if (discardUntilNl) {
      const idx = s.indexOf("\n");
      if (idx === -1) continue;
      s = s.slice(idx + 1);
      discardUntilNl = false;
    }
    if (s.length) await processLines(s, leftover, onLine);
  }
  if (leftover.buf.trim().startsWith("{")) {
    try {
      onLine(JSON.parse(leftover.buf) as JournalLine);
    } catch {
      /* ignore */
    }
  }
}

export type JournalWatcherHandle = {
  close: () => Promise<void>;
  getPath: () => string | null;
};

const POLL_MS = 500;

/**
 * After game restart Elite adds a new log; we must merge **all** journal files in order, then tail only the newest.
 */
export function startJournalWatcher(
  journalDir: string,
  onLiveLine: (j: JournalLine) => void,
  resyncAllJournalFiles: () => Promise<void>,
  /** After a full replay, pass latest file path + size so the first poll tails instead of replaying again. */
  seed: { path: string; size: number } | null,
  /** Rolling journal window — recomputed each poll so age cutoffs track real time. */
  getListFilterOpts: () => JournalListFilterOpts,
): JournalWatcherHandle {
  let currentPath: string | null = seed?.path != null ? path.resolve(seed.path) : null;
  let position = seed?.size ?? 0;
  const leftover = { buf: "" };
  let tailing = false;
  let resyncing = false;
  /** Detects when the filtered file set changes while the newest path stays the same (rolling cutoff). */
  let lastListIdentity: string | null = null;

  let poll: ReturnType<typeof setInterval> | null = null;
  /** Path we passed to watchFile — must match listener identity for unwatchFile. */
  let watchTarget: string | null = null;
  const onWatchEvent = (): void => {
    void tailChunk().catch((e) => console.error("[journalWatcher] tailChunk (watch):", e));
  };

  function stopTailWatch(): void {
    if (!watchTarget) return;
    try {
      unwatchFile(watchTarget, onWatchEvent);
    } catch {
      /* ignore */
    }
    watchTarget = null;
  }

  function refreshTailWatch(): void {
    stopTailWatch();
    if (!currentPath) return;
    watchTarget = currentPath;
    try {
      watchFile(watchTarget, { interval: 200 }, onWatchEvent);
    } catch {
      watchTarget = null;
    }
  }

  function ensurePoll(): void {
    if (poll != null) return;
    poll = setInterval(() => {
      void pulse().catch((e) => console.error("[journalWatcher] pulse:", e));
    }, POLL_MS);
  }

  const tailChunk = async (): Promise<void> => {
    if (!currentPath || tailing || resyncing) return;
    tailing = true;
    try {
      const st = await fs.stat(currentPath);
      if (st.size < position) {
        position = 0;
        leftover.buf = "";
      }
      if (st.size <= position) return;

      const byteLen = st.size - position;
      const fh = await fs.open(currentPath, "r");
      try {
        const buf = Buffer.allocUnsafe(byteLen);
        const { bytesRead } = await fh.read(buf, 0, byteLen, position);
        const data = buf.subarray(0, bytesRead).toString("utf8");
        position = st.size;
        await processLines(data, leftover, onLiveLine);
      } finally {
        await fh.close();
      }
    } catch {
      /* ignore transient read errors (e.g. Elite has the file momentarily locked) */
    } finally {
      tailing = false;
    }
  };

  const pulse = async (): Promise<void> => {
    const listOpts = getListFilterOpts();
    const files = await listJournalFilesChronological(journalDir, listOpts);
    const latest = files.length ? files[files.length - 1]! : null;
    const identity = files.map((p) => path.basename(p)).join("|");

    if (!latest) {
      stopTailWatch();
      lastListIdentity = null;
      return;
    }

    if (!sameJournalPath(latest, currentPath)) {
      stopTailWatch();
      resyncing = true;
      try {
        currentPath = latest;
        position = 0;
        leftover.buf = "";
        await resyncAllJournalFiles();
        position = (await fs.stat(latest)).size;
        lastListIdentity = identity;
      } catch (e) {
        console.error("[journalWatcher] resync after journal rotation failed:", e);
        throw e;
      } finally {
        resyncing = false;
      }
      refreshTailWatch();
      return;
    }

    if (lastListIdentity !== null && identity !== lastListIdentity) {
      stopTailWatch();
      resyncing = true;
      try {
        currentPath = latest;
        position = 0;
        leftover.buf = "";
        await resyncAllJournalFiles();
        position = (await fs.stat(latest)).size;
        lastListIdentity = identity;
      } catch (e) {
        console.error("[journalWatcher] resync after journal window change failed:", e);
        throw e;
      } finally {
        resyncing = false;
      }
      refreshTailWatch();
      return;
    }

    if (lastListIdentity === null) lastListIdentity = identity;
    await tailChunk();
  };

  void (async () => {
    try {
      await pulse();
    } catch (e) {
      console.error("[journalWatcher] initial pulse failed:", e);
    } finally {
      /** Must always run: if the first pulse rejects, we still need to poll (previous bug = zero live updates). */
      ensurePoll();
      refreshTailWatch();
    }
  })();

  return {
    getPath: () => currentPath,
    close: async () => {
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
      stopTailWatch();
    },
  };
}
