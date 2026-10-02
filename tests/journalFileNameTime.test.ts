/**
 * Journal file names carry the PC's local time (plan 2.4, Fable S8): on the owner's UTC+3 PC
 * `Journal.2026-09-30T080630.01.log` starts at 05:06:25Z. Read as UTC, the history window was off by
 * the time zone's offset.
 */
import { describe, expect, it } from "vitest";
import { filenameUtcMs } from "../src/server/journalWatcher.js";

describe("a journal file's start from its name", () => {
  it("is the local time the game wrote it in", () => {
    expect(filenameUtcMs("Journal.2026-09-30T080630.01.log")).toBe(new Date(2026, 8, 30, 8, 6, 30).getTime());
  });
  it("is 0 for a name without the stamp", () => {
    expect(filenameUtcMs("Journal.240930080630.01.log")).toBe(0);
  });
});
