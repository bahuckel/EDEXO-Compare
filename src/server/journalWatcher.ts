import { promises as fs, unwatchFile, watchFile } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { JournalLine } from "../shared/types.js";
import { JOURNAL_POLL_DEFAULT_MS, clampJournalPollMs } from "../shared/pollRates.js";

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
/**
 * When a journal file starts, from its name (epoch ms), or 0 for a name without the stamp.
 *
 * The game stamps the name in the PC's local time — `Journal.2026-09-30T080630.01.log` begins at
 * `2026-09-30T05:06:25Z` on the owner's UTC+3 PC — while every line inside is UTC. Read as UTC, the
 * history window ("the last N days") was cut off by the time zone's offset (plan 2.4, Fable S8).
 */
export function filenameUtcMs(name: string): number {
  const m = name.match(/^Journal\.(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})\./);
  if (!m) return 0;
  const t = new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!).getTime();
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

/**
 * How long a replay may hold the thread before it gives the event loop a turn (plan F, 2026-10-01).
 * The server runs in Electron's main process: a whole journal file applied in one go froze the
 * launcher, the tray and the HTTP server the launcher loads from, for as long as the file took.
 */
const REPLAY_SLICE_MS = 25;
const REPLAY_CHECK_EVERY = 200;

const nextTurn = (): Promise<void> => new Promise((r) => setImmediate(r));

async function processLines(
  chunk: string,
  leftover: { buf: string },
  onLine: (j: JournalLine) => void,
  /** Replays only: yield every {@link REPLAY_SLICE_MS}. The live tail applies its few lines at once. */
  breathe = false,
): Promise<void> {
  leftover.buf += chunk;
  const parts = leftover.buf.split(/\r?\n/);
  leftover.buf = parts.pop() ?? "";
  let sliceStart = breathe ? performance.now() : 0;
  for (let i = 0; i < parts.length; i++) {
    if (breathe && i > 0 && i % REPLAY_CHECK_EVERY === 0 && performance.now() - sliceStart > REPLAY_SLICE_MS) {
      await nextTurn();
      sliceStart = performance.now();
    }
    const t = parts[i]!.trim();
    if (!t.startsWith("{")) continue;
    try {
      onLine(JSON.parse(t) as JournalLine);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Apply the complete lines in `buf`, which holds the file's bytes from offset `base`, and return the
 * file offset just past what was applied (combined plan 1.1b, 2026-10-01).
 *
 * That offset is what the journal cache records and where the live tail starts, so the two agree on
 * the byte: the cache used to record sizes taken before the replay and the tail started from a size
 * taken after it, so lines written in between were applied twice (next boot) or never. A last line
 * with no newline yet is applied, and counted, only when it is complete JSON; otherwise it is left
 * for the next read, which starts at its first byte.
 */
async function applyJournalBytes(
  buf: Buffer,
  base: number,
  skipFirstPartial: boolean,
  onLine: (j: JournalLine) => void,
): Promise<number> {
  let start = 0;
  if (skipFirstPartial) {
    const nl = buf.indexOf(0x0a);
    if (nl === -1) return base;
    start = nl + 1;
  }
  const lastNl = buf.lastIndexOf(0x0a);
  let end = lastNl >= start ? lastNl + 1 : start;
  if (end > start) {
    await processLines(buf.toString("utf8", start, end), { buf: "" }, onLine, true);
  }
  if (end < buf.length) {
    const tail = buf.toString("utf8", end).trim();
    if (tail.startsWith("{")) {
      try {
        onLine(JSON.parse(tail) as JournalLine);
        end = buf.length;
      } catch {
        /* still being written: the next read takes it whole */
      }
    }
  }
  return base + end;
}

/** Apply a whole journal; returns the offset just past the last line applied (see applyJournalBytes). */
export async function readJournalFull(filePath: string, onLine: (j: JournalLine) => void): Promise<number> {
  return applyJournalBytes(await fs.readFile(filePath), 0, false, onLine);
}

/**
 * Apply journal lines appended after `startByte` (merged-cache fast path); returns the offset just past
 * the last line applied. Skips to the next line only when `startByte` is inside one (see below).
 */
export async function readJournalFromOffset(
  filePath: string,
  startByte: number,
  onLine: (j: JournalLine) => void,
): Promise<number> {
  const fh = await fs.open(filePath, "r");
  let buf: Buffer;
  let discardUntilNl: boolean;
  try {
    const size = (await fh.stat()).size;
    if (startByte >= size) return startByte;
    /*
      Skip to the next line only when the offset is inside one. The cache records each file's size and
      the game writes whole lines, so the offset is normally a line start: skipping then threw away the
      first complete new line on every warm start (combined plan 1.1a, 2026-10-01).
    */
    const prev = Buffer.alloc(1);
    discardUntilNl = startByte > 0 && !((await fh.read(prev, 0, 1, startByte - 1)).bytesRead === 1 && prev[0] === 0x0a);
    buf = Buffer.alloc(size - startByte);
    const { bytesRead } = await fh.read(buf, 0, buf.length, startByte);
    buf = buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
  return applyJournalBytes(buf, startByte, discardUntilNl, onLine);
}

/** Where the live tail starts in the newest journal after a resync (the byte the replay reached). */
export type JournalTailSeed = { path: string; size: number };

export type JournalWatcherHandle = {
  close: () => Promise<void>;
  getPath: () => string | null;
  /**
   * Re-read `getPollMs` and re-arm the interval. Called when the commander changes the rate in the
   * launcher: without it the new number would only take effect on the next journal-pipeline
   * restart, which for most sessions means "never".
   */
  retimePoll: () => void;
  /** The interval currently armed, for tests and for the settings route's reply. */
  currentPollMs: () => number;
};

/**
 * After game restart Elite adds a new log; we must merge **all** journal files in order, then tail only the newest.
 */
export function startJournalWatcher(
  journalDir: string,
  onLiveLine: (j: JournalLine) => void,
  /** Resolves with where the tail must start in the newest journal (see JournalTailSeed). */
  resyncAllJournalFiles: () => Promise<JournalTailSeed | null | void>,
  /** After a full replay, pass latest file path + size so the first poll tails instead of replaying again. */
  seed: { path: string; size: number } | null,
  /** Rolling journal window — recomputed each poll so age cutoffs track real time. */
  getListFilterOpts: () => JournalListFilterOpts,
  /**
   * The poll interval, read every time the timer is armed rather than captured once.
   *
   * Owner's standing preference is a slow log poll, and the `watchFile` below still wakes the tail
   * early, so this is the backstop for rotation and the rolling window — not the delivery path for
   * events. Absent, it is the shipped default.
   */
  getPollMs: () => number = () => JOURNAL_POLL_DEFAULT_MS,
): JournalWatcherHandle {
  let currentPath: string | null = seed?.path != null ? path.resolve(seed.path) : null;
  let position = seed?.size ?? 0;
  const leftover = { buf: "" };
  /*
    One decoder for the tail, so a read that ends inside a multi-byte character ("ā", "ö" in a name)
    keeps its first bytes for the next read instead of turning both halves into U+FFFD (plan 2.4,
    O-19). Replaced wherever the line buffer is dropped.
  */
  let decoder = new StringDecoder("utf8");
  let tailing = false;
  let resyncing = false;
  /** Detects when the filtered file set changes while the newest path stays the same (rolling cutoff). */
  let lastListIdentity: string | null = null;

  let poll: ReturnType<typeof setInterval> | null = null;
  /*
    Closed for good (combined plan 1.2). `close()` can land while the first pulse is still awaiting,
    and that pulse's `finally` re-armed the poll and the file watch afterwards: a closed watcher came
    back to life beside its replacement, and every live line was applied once per survivor. A restart
    during the boot replay (a history-window change in the launcher) did it every time.
  */
  let closed = false;
  /** The interval the armed timer was created with, so `retimePoll` can tell a change from a no-op. */
  let armedPollMs = clampJournalPollMs(getPollMs());
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
    if (closed || !currentPath) return;
    watchTarget = currentPath;
    try {
      watchFile(watchTarget, { interval: 1000 }, onWatchEvent);
    } catch {
      watchTarget = null;
    }
  }

  function ensurePoll(): void {
    if (closed || poll != null) return;
    armedPollMs = clampJournalPollMs(getPollMs());
    poll = setInterval(() => {
      void pulse().catch((e) => console.error("[journalWatcher] pulse:", e));
    }, armedPollMs);
  }

  /** Re-arm only when the number actually moved; a needless clear/set drops part of an interval. */
  function retimePoll(): void {
    const next = clampJournalPollMs(getPollMs());
    if (poll != null && next === armedPollMs) return;
    if (poll != null) {
      clearInterval(poll);
      poll = null;
    }
    ensurePoll();
  }

  const tailChunk = async (): Promise<void> => {
    if (closed || !currentPath || tailing || resyncing) return;
    tailing = true;
    try {
      const st = await fs.stat(currentPath);
      if (st.size < position) {
        position = 0;
        leftover.buf = "";
        decoder = new StringDecoder("utf8");
      }
      if (st.size <= position) return;

      const byteLen = st.size - position;
      const fh = await fs.open(currentPath, "r");
      try {
        const buf = Buffer.allocUnsafe(byteLen);
        const { bytesRead } = await fh.read(buf, 0, byteLen, position);
        // A rotation started a resync while this read was waiting: the store it would feed has been
        // reset, and the replay reads these lines itself (combined plan 1.2).
        if (resyncing || closed) return;
        const data = decoder.write(buf.subarray(0, bytesRead));
        position += bytesRead;
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

  /** The byte the resync reached in `latest` when it says so (1.1b); else the file's size, as before. */
  const tailStartAfterResync = async (seed: JournalTailSeed | null | void, latest: string): Promise<number> =>
    seed && sameJournalPath(seed.path, latest) ? seed.size : (await fs.stat(latest)).size;

  const pulse = async (): Promise<void> => {
    /*
      Never while a resync is running.

      A rotation sends `pulse` into `resyncAllJournalFiles`, which resets the store and re-merges
      every log — about fifteen seconds on a full journal folder. The interval keeps firing the
      whole time, and the later pulses do **not** fall back out: `currentPath` is already the new
      file so they skip the rotation branch, then meet `identity !== lastListIdentity` — which is
      still stale, because that is only updated once the first resync finishes — and start a resync
      of their own. Each one resets the store the others are filling, and whichever finishes last
      saves the remains as a complete cache.

      That is how a 19,000-body merge became 215 bodies with one codex species, recorded as all 271
      files merged. It was always possible; a poll of 500 ms made it likely, because it is the ratio
      of the poll to the resync that decides how many of these pile up.
    */
    if (resyncing || closed) return;
    const listOpts = getListFilterOpts();
    const files = await listJournalFilesChronological(journalDir, listOpts);
    if (closed) return;
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
        decoder = new StringDecoder("utf8");
        position = await tailStartAfterResync(await resyncAllJournalFiles(), latest);
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
        decoder = new StringDecoder("utf8");
        position = await tailStartAfterResync(await resyncAllJournalFiles(), latest);
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
    // The folder vanished (a drive unplugged, a sync tool) and came back with the same newest file: the
    // file watch stopped with it, and only this poll was left to notice new lines (Fable 8.4).
    if (!watchTarget) refreshTailWatch();
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
    retimePoll,
    currentPollMs: () => armedPollMs,
    close: async () => {
      closed = true;
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
      stopTailWatch();
    },
  };
}
