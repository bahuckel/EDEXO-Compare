/**
 * Write a file whole or not at all (code review 2026-10-10, A3): into a temporary file beside it, then
 * renamed over it, so a crash or power cut mid-write leaves the previous file, never half of the new one.
 * Ten user-data files were written in place; a torn settings, notices or prediction file was read back as
 * unreadable and replaced with defaults. Throws like `writeFileSync` does: callers keep their own catch.
 */
import { renameSync, rmSync, writeFileSync, type WriteFileOptions } from "node:fs";

export function writeFileAtomic(file: string, data: string, options: WriteFileOptions = "utf8"): void {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, data, options);
    renameSync(tmp, file);
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* nothing left to tidy */
    }
    throw e;
  }
}
