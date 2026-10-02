/**
 * The live tail and a character split across two reads (plan 2.4, O-19 + Fable 8.4). Elite writes a
 * line in more than one go now and then; when a read ends inside a multi-byte character — a system
 * or a commander name with "ö" or "ā" — decoding each read on its own turned both halves into U+FFFD,
 * and the line reached the store with a broken name.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startJournalWatcher, type JournalWatcherHandle } from "../src/server/journalWatcher.js";
import type { JournalLine } from "../src/shared/types.js";

let dir: string;
let watcher: JournalWatcherHandle | null = null;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-utf8-"));
});
afterEach(async () => {
  await watcher?.close();
  watcher = null;
  rmSync(dir, { recursive: true, force: true });
});

describe("live tail", () => {
  it("keeps a multi-byte character whole when a read ends inside it", async () => {
    const file = path.join(dir, "Journal.2026-10-02T100000.01.log");
    writeFileSync(file, "");
    const seen: JournalLine[] = [];
    watcher = startJournalWatcher(
      dir,
      (l) => seen.push(l),
      async () => {},
      { path: file, size: 0 },
      () => ({ minFileStartUtcMs: null }),
      () => 100,
    );
    const name = "Hēlen Löwe's Star";
    const bytes = Buffer.from(`{"timestamp":"2026-10-02T10:00:00Z","event":"FSDJump","StarSystem":"${name}"}\r\n`, "utf8");
    const cut = bytes.indexOf(Buffer.from("ē", "utf8")) + 1; // inside the two bytes of "ē"
    await wait(150);
    appendFileSync(file, bytes.subarray(0, cut));
    await wait(400);
    appendFileSync(file, bytes.subarray(cut));
    await wait(400);
    expect(seen.map((l) => l.StarSystem)).toEqual([name]);
  });
});
