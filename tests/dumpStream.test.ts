/**
 * The dump readers take a `.jsonl.gz` or a plain `.jsonl` (owner, 2026-09-28: the in-app import of the
 * packaged 1.2.2 failed with zlib's "incorrect header check" on an uncompressed dump), and refuse a
 * `.zip` with a message rather than a zlib error.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { dumpLines, sniffDumpEncoding } from "../src/feeder/dumpStream.js";

const dir = mkdtempSync(path.join(tmpdir(), "edexo-dump-"));
const text = '{"kind":"system","id64":"1"}\n{"kind":"body","id64":"2"}\n';

async function read(file: string): Promise<string[]> {
  const out: string[] = [];
  for await (const l of dumpLines(file)) out.push(l);
  return out;
}

describe("dump files, gzipped or not", () => {
  it("reads a gzipped dump", async () => {
    const f = path.join(dir, "a.jsonl.gz");
    writeFileSync(f, gzipSync(text));
    expect(sniffDumpEncoding(f)).toBe("gzip");
    expect(await read(f)).toHaveLength(2);
  });

  it("reads an uncompressed dump the same way", async () => {
    const f = path.join(dir, "b.jsonl");
    writeFileSync(f, text);
    expect(sniffDumpEncoding(f)).toBe("text");
    expect(await read(f)).toEqual(text.trim().split("\n"));
  });

  it("refuses a zip with a message a person can act on", () => {
    const f = path.join(dir, "c.zip");
    writeFileSync(f, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]));
    expect(() => dumpLines(f)).toThrow(/Extract it first/);
  });
});
