/**
 * How much of each journal file EDSM has already been given.
 *
 * The catch-up run has to answer "what has not been sent yet" across four years of logs, and it has
 * to answer it after a crash, a restart, or a commander who closed the app halfway through.
 *
 * ## Lines, not bytes
 *
 * A byte offset is the obvious answer and it is wrong here. The offset would have to be accumulated
 * while reading, and the only length available at that point is `JSON.stringify(line).length` — the
 * re-serialised form, which does not reproduce the file's bytes. Key order, whitespace and number
 * formatting all differ, so the watermark drifts a little on every line and eventually resumes in
 * the middle of an event. Journals are append-only and line-oriented, so **"the first n lines of
 * this file have been accepted"** is exact, needs no arithmetic, and survives being read with a
 * different parser.
 *
 * Reading a file from line 0 every time to skip the first n costs a few milliseconds on a few MB,
 * and the run wants those lines anyway: `_systemName` is rebuilt from the stream, so the events
 * already uploaded still have to pass through the tracker before the new ones can be stamped.
 *
 * **The count only advances on a reply EDSM actually accepted.** A batch that failed leaves the
 * watermark where it was and is read again next run. That makes the whole thing re-runnable and a
 * half-finished catch-up harmless — the cost of a crash is re-sending one batch, and EDSM ignores an
 * event it already holds.
 *
 * Beside the user settings, like the other observation files. It is not derived from anything and
 * cannot be rebuilt: delete it and the next run offers the whole history again, which is safe but
 * slow and impolite to a volunteer service.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveEdsmUploadLedgerPath } from "./paths.js";

export interface EdsmLedgerFileEntry {
  /** Lines of this file whose events EDSM has accepted, counted from the top. */
  linesDone: number;
  /** Events actually sent from this file — smaller than `linesDone`, since most are discarded. */
  events: number;
  /** File size when it was last read, so a rotated or restored file can be spotted. */
  size: number;
  lastAt: string;
}

export interface EdsmUploadLedger {
  formatVersion: 1;
  /** Keyed by journal file **basename** — the directory can move, the file name does not. */
  files: Record<string, EdsmLedgerFileEntry>;
  /** Totals across every run, for the Options panel. */
  totals: { accepted: number; rejected: number };
  /** The last thing that went wrong, so a stalled upload can say why without a log dive. */
  lastError: string | null;
  lastRunAt: string | null;
}

let cached: EdsmUploadLedger | null = null;

function empty(): EdsmUploadLedger {
  return {
    formatVersion: 1,
    files: {},
    totals: { accepted: 0, rejected: 0 },
    lastError: null,
    lastRunAt: null,
  };
}

export function readEdsmUploadLedger(): EdsmUploadLedger {
  if (cached) return cached;
  const p = resolveEdsmUploadLedgerPath();
  if (existsSync(p)) {
    try {
      const parsed = JSON.parse(readFileSync(p, "utf8")) as Partial<EdsmUploadLedger>;
      cached = {
        formatVersion: 1,
        files: parsed.files && typeof parsed.files === "object" ? parsed.files : {},
        totals: {
          accepted: parsed.totals?.accepted ?? 0,
          rejected: parsed.totals?.rejected ?? 0,
        },
        lastError: parsed.lastError ?? null,
        lastRunAt: parsed.lastRunAt ?? null,
      };
      return cached;
    } catch {
      /* an unreadable ledger starts over: re-offering events EDSM already has is harmless */
    }
  }
  cached = empty();
  return cached;
}

export function writeEdsmUploadLedger(ledger: EdsmUploadLedger): void {
  cached = ledger;
  const p = resolveEdsmUploadLedgerPath();
  try {
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  } catch {
    /*
      A ledger that cannot be written is a catch-up that repeats itself next time, not a crash.
      Worth not failing over: the upload itself succeeded, and saying otherwise would be a lie.
    */
  }
}

/** Test seam — the ledger is held for the life of the process. */
export function resetEdsmUploadLedgerForTests(): void {
  cached = null;
}

/**
 * Where to resume in this file.
 *
 * Zero when the file has grown shorter than the ledger remembers — that is a rotated, truncated or
 * restored file, and the lines at those positions are not the lines that were sent. Re-reading it is
 * the safe answer; EDSM discards what it already holds.
 */
export function ledgerLinesDoneFor(ledger: EdsmUploadLedger, fileName: string, currentSize: number): number {
  const e = ledger.files[fileName];
  if (!e) return 0;
  if (currentSize < e.size) return 0;
  return e.linesDone;
}

/** Move one file's watermark forward. Never backwards — see {@link ledgerLinesDoneFor}. */
export function advanceLedger(
  ledger: EdsmUploadLedger,
  fileName: string,
  linesDone: number,
  eventsSent: number,
  size: number,
  at = new Date().toISOString(),
): void {
  const prev = ledger.files[fileName];
  ledger.files[fileName] = {
    linesDone: Math.max(prev?.linesDone ?? 0, linesDone),
    events: (prev?.events ?? 0) + eventsSent,
    size,
    lastAt: at,
  };
}

/** What the Options panel shows: totals and when, never the key or the file list. */
export interface EdsmUploadLedgerSummary {
  filesTracked: number;
  eventsAccepted: number;
  eventsRejected: number;
  lastRunAt: string | null;
  lastError: string | null;
}

export function edsmUploadLedgerSummary(): EdsmUploadLedgerSummary {
  const l = readEdsmUploadLedger();
  return {
    filesTracked: Object.keys(l.files).length,
    eventsAccepted: l.totals.accepted,
    eventsRejected: l.totals.rejected,
    lastRunAt: l.lastRunAt,
    lastError: l.lastError,
  };
}
