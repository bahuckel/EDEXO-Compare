/**
 * Reading a journal from a saved offset (the cache fast path, combined plan 1.1a, 2026-10-01).
 *
 * The cache records each journal's size, and the game writes whole lines, so that size is the start
 * of a line. The reader used to discard everything up to the first newline whenever the offset was
 * above zero — the first complete new line, on every warm start: a Scan, a ScanOrganic, a sale.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readJournalFromOffset, readJournalFull } from "../src/server/journalWatcher.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-tail-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function eventsFrom(text: string, startByte: number): Promise<string[]> {
  const f = path.join(dir, "Journal.log");
  writeFileSync(f, text);
  const got: string[] = [];
  await readJournalFromOffset(f, startByte, (l) => got.push(String(l.event)));
  return got;
}

const A = '{"event":"A"}\r\n';
const B = '{"event":"B"}\r\n';
const C = '{"event":"C"}\r\n';

describe("readJournalFromOffset", () => {
  it("keeps the first new line when the offset is a line start (CRLF)", async () => {
    expect(await eventsFrom(A + B + C, Buffer.byteLength(A))).toEqual(["B", "C"]);
  });

  it("keeps it with LF-only lines too", async () => {
    expect(await eventsFrom('{"event":"A"}\n{"event":"B"}\n', Buffer.byteLength('{"event":"A"}\n'))).toEqual(["B"]);
  });

  it("still skips a partial line when the offset lands inside one", async () => {
    expect(await eventsFrom(A + B + C, Buffer.byteLength(A) + 5)).toEqual(["C"]);
  });

  it("reads everything from offset zero", async () => {
    expect(await eventsFrom(A + B, 0)).toEqual(["A", "B"]);
  });

  it("reads nothing when nothing was added", async () => {
    expect(await eventsFrom(A, Buffer.byteLength(A))).toEqual([]);
  });

  it("returns the offset reached, and a line still being written is left for the next read (1.1b)", async () => {
    const f = path.join(dir, "Journal.log");
    writeFileSync(f, A + B + '{"event":"C","Bod');
    const got: string[] = [];
    const end = await readJournalFull(f, (l) => got.push(String(l.event)));
    expect(got).toEqual(["A", "B"]);
    expect(end).toBe(Buffer.byteLength(A + B));
    const rest = 'y":1}\r\n' + '{"event":"D"}\r\n';
    appendFileSync(f, rest);
    const more: string[] = [];
    const end2 = await readJournalFromOffset(f, end, (l) => more.push(String(l.event)));
    expect(more).toEqual(["C", "D"]);
    expect(end2).toBe(Buffer.byteLength(A + B + '{"event":"C","Bod' + rest));
  });

  it("counts a complete last line without its newline, and does not apply it twice", async () => {
    const f = path.join(dir, "Journal.log");
    writeFileSync(f, A + '{"event":"B"}');
    const got: string[] = [];
    const end = await readJournalFull(f, (l) => got.push(String(l.event)));
    expect(got).toEqual(["A", "B"]);
    appendFileSync(f, "\r\n" + C);
    const more: string[] = [];
    await readJournalFromOffset(f, end, (l) => more.push(String(l.event)));
    expect(more).toEqual(["C"]);
  });
});
