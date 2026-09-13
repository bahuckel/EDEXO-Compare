/**
 * The catch-up run: every journal event EDSM has not been given yet.
 *
 * EDMC uploads what the game produces while it is running, and a commander who was not running it
 * has a gap. EDDiscovery's answer is a history sync, and this is the same thing: walk every journal
 * file oldest first, skip the lines the ledger says were accepted, send the rest.
 *
 * ## Why it reads the files rather than the merge cache
 *
 * The merge cache is a *result* — the app's own view of what the journals meant, with events it does
 * not care about dropped and the rest reshaped. EDSM wants the game's lines as the game wrote them.
 * Reconstructing those from the cache would be inventing journal entries, so this reads the files.
 *
 * ## Order is not optional
 *
 * `_systemName` and the rest are rebuilt from the stream as it passes ({@link EdsmTransientTracker}),
 * so a file read out of order stamps its events with the wrong system. Chronological, always, and
 * the whole of a file before the next one. Lines below the watermark are read too, and fed to the
 * tracker without being sent — the `Location` that says where the commander was usually sits in the
 * part already uploaded.
 *
 * ## Stopping
 *
 * Three ways out. The commander cancels; EDSM says something fatal (bad key, bad client), in which
 * case retrying is the wrong move and the error is kept for the panel; or the run finishes. A batch
 * that merely failed — network, timeout — stops the run too, but leaves the watermark intact so the
 * next one picks up where it left off.
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import { listJournalFilesChronological, readJournalFull } from "./journalWatcher.js";
import {
  EDSM_BATCH_GAP_MS,
  EDSM_BATCH_SIZE,
  EdsmTransientTracker,
  fetchEdsmDiscardList,
  postEdsmJournalBatch,
} from "./edsmUpload.js";
import {
  advanceLedger,
  ledgerLinesDoneFor,
  readEdsmUploadLedger,
  writeEdsmUploadLedger,
} from "./edsmUploadLedger.js";
import type { EdsmCredentials } from "./edsmCredentials.js";
import type { JournalLine } from "../shared/types.js";

export interface EdsmCatchUpProgress {
  running: boolean;
  /** Journal files finished, and how many there are. */
  filesDone: number;
  filesTotal: number;
  /** The file being read, for a progress line that means something. */
  currentFile: string | null;
  eventsSent: number;
  eventsRejected: number;
  /** Events skipped because EDSM publishes them as unwanted. */
  eventsDiscarded: number;
  error: string | null;
  /** True when the error is one retrying cannot fix. */
  fatal: boolean;
  finishedAt: string | null;
}

export interface EdsmCatchUpOptions {
  journalDir: string;
  credentials: EdsmCredentials;
  /** Called after each batch, so the UI can show a live count without polling the ledger. */
  onProgress?: (p: EdsmCatchUpProgress) => void;
  /** Returns true to stop at the next batch boundary. */
  isCancelled?: () => boolean;
  /** Test seam. */
  fetchImpl?: typeof fetch;
  /** Test seam — real runs wait between batches so EDSM is not hammered. */
  gapMs?: number;
}

const sleep = (ms: number): Promise<void> =>
  ms <= 0
    ? Promise.resolve()
    : new Promise((r) => {
        setTimeout(r, ms).unref?.();
      });

/** One line to send, with the position that acknowledges it. */
interface QueuedLine {
  event: Record<string, unknown>;
  /** 1-based line number in the file — the watermark once EDSM has taken it. */
  lineNo: number;
}

/**
 * Run it. Resolves with the final progress; never throws.
 *
 * One run at a time is the caller's job to enforce — two concurrent runs would both read from the
 * same watermark and send everything twice.
 */
export async function runEdsmCatchUp(opts: EdsmCatchUpOptions): Promise<EdsmCatchUpProgress> {
  const progress: EdsmCatchUpProgress = {
    running: true,
    filesDone: 0,
    filesTotal: 0,
    currentFile: null,
    eventsSent: 0,
    eventsRejected: 0,
    eventsDiscarded: 0,
    error: null,
    fatal: false,
    finishedAt: null,
  };
  const report = (): void => opts.onProgress?.({ ...progress });

  const discard = await fetchEdsmDiscardList();
  if (!discard) {
    progress.running = false;
    progress.error = "EDSM's list of unwanted events could not be fetched, so nothing was sent.";
    progress.finishedAt = new Date().toISOString();
    report();
    return progress;
  }

  const ledger = readEdsmUploadLedger();
  ledger.lastRunAt = new Date().toISOString();

  // `minFileStartUtcMs: null` is the whole history, not the app's rolling window — the point of a
  // catch-up is the gap before today, and that window exists to keep the *matcher* fast.
  const files = await listJournalFilesChronological(opts.journalDir, { minFileStartUtcMs: null });
  progress.filesTotal = files.length;
  report();

  const tracker = new EdsmTransientTracker();
  const gap = opts.gapMs ?? EDSM_BATCH_GAP_MS;

  for (const file of files) {
    if (opts.isCancelled?.()) break;
    const name = path.basename(file);
    progress.currentFile = name;
    report();

    let size = 0;
    try {
      size = (await fs.stat(file)).size;
    } catch {
      progress.filesDone++;
      continue;
    }
    const resumeAfter = ledgerLinesDoneFor(ledger, name, size);

    /*
      A file that has not changed since it was finished is not opened at all.

      Journals are append-only, so identical size means identical content, and re-reading two hundred
      of them on every run to discover that is the difference between a catch-up that can be repeated
      every few minutes and one that can be run once a day.

      Safe only because every journal file begins with `Fileheader`, `Commander`, `LoadGame` and
      `Location` — the game re-states where the commander is at the top of each one, so skipping the
      earlier files does not leave the tracker without a system for the next file's first events.
    */
    const done = ledger.files[name];
    if (done && done.size === size && done.linesDone > 0) {
      progress.filesDone++;
      report();
      continue;
    }

    /*
      The whole file is read, and the lines at or below the watermark are fed to the tracker without
      being queued. That is not waste: those lines carry the system the later ones happened in.
    */
    const queue: QueuedLine[] = [];
    let lineNo = 0;
    let readError: string | null = null;
    const collect = (line: JournalLine): void => {
      lineNo++;
      tracker.observe(line);
      if (lineNo <= resumeAfter) return;
      const event = (line as unknown as { event?: unknown }).event;
      if (typeof event !== "string" || !event) return;
      if (discard.has(event)) {
        progress.eventsDiscarded++;
        return;
      }
      queue.push({ event: tracker.stamp(line), lineNo });
    };

    try {
      await readJournalFull(file, collect);
    } catch (e) {
      readError = e instanceof Error ? e.message : "journal file could not be read";
    }
    if (readError) {
      progress.error = readError;
      break;
    }

    const totalLines = lineNo;
    let stopped = false;
    let fatalOrFailed: string | null = null;

    for (let i = 0; i < queue.length; i += EDSM_BATCH_SIZE) {
      if (opts.isCancelled?.()) {
        stopped = true;
        break;
      }
      const batch = queue.slice(i, i + EDSM_BATCH_SIZE);
      const res = await postEdsmJournalBatch(
        opts.credentials,
        batch.map((q) => q.event),
        tracker.snapshot(),
        opts.fetchImpl ?? fetch,
      );
      if (!res.ok) {
        fatalOrFailed = res.error ?? "upload failed";
        progress.fatal = res.fatal;
        stopped = true;
        break;
      }
      progress.eventsSent += res.accepted;
      progress.eventsRejected += res.rejected;
      ledger.totals.accepted += res.accepted;
      ledger.totals.rejected += res.rejected;
      // The last line in the batch is now acknowledged; everything before it in the file is too,
      // including the discarded lines between queued ones.
      advanceLedger(ledger, name, batch[batch.length - 1]!.lineNo, batch.length, size);
      writeEdsmUploadLedger(ledger);
      report();
      if (gap > 0) await sleep(gap);
    }

    if (fatalOrFailed) {
      progress.error = fatalOrFailed;
      break;
    }
    if (stopped) break;

    /*
      A finished file's watermark goes to its last line, not to its last *sent* line.

      Otherwise a journal whose remaining events are all on EDSM's discard list is re-read in full on
      every run for ever, because the watermark never moves — nothing was ever sent from it.
    */
    advanceLedger(ledger, name, totalLines, 0, size);
    progress.filesDone++;
    report();
  }

  ledger.lastError = progress.error;
  writeEdsmUploadLedger(ledger);

  progress.running = false;
  progress.currentFile = null;
  progress.finishedAt = new Date().toISOString();
  report();
  return progress;
}
