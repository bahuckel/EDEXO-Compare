/**
 * Two guards of the boot replay (combined plan 1.2), out of `startEdexo` so they can be tested
 * (Phase 6):
 *
 * - One bad line must not end the merge. A throw used to abort the replay, and the pipeline never
 *   reached its watcher, so nothing live arrived until a restart. The live path already catches per
 *   line; the replay does too, and says so for the first few.
 * - Only a journal folder that is really there and empty costs the cache. A journal drive not
 *   mounted yet must not mean a full replay at the next start.
 */
import { readdirSync, statSync } from "node:fs";
import type { JournalLine } from "../shared/types.js";

/** Lines logged before the rest go quietly: a broken event repeats on every line of its kind. */
const LOGGED_ERRORS = 3;

export function makeReplayLineApplier(
  apply: (line: JournalLine) => void,
  log: (...args: unknown[]) => void = console.error,
): { apply: (line: JournalLine) => void; errors: () => number } {
  let errors = 0;
  return {
    apply(line) {
      try {
        apply(line);
      } catch (e) {
        errors += 1;
        if (errors <= LOGGED_ERRORS) log("[edexo-compare] journal line skipped in replay:", line.event, e);
      }
    },
    errors: () => errors,
  };
}

/** The folder exists and can be listed: an empty one is really empty, not unmounted. */
export function journalFolderIsReadable(dir: string): boolean {
  try {
    return statSync(dir).isDirectory() && Array.isArray(readdirSync(dir));
  } catch {
    return false;
  }
}
