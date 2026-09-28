/**
 * A dump file as a line stream, gzipped or not.
 *
 * Both dump readers piped every file through `createGunzip()`, and the owner's first in-app import of
 * the packaged 1.2.2 failed with zlib's "incorrect header check" — the file he picked was the
 * uncompressed `.jsonl`, which is a perfectly good export. The first bytes decide now: `1f 8b` is gzip,
 * `PK` is a zip (which Node cannot stream, so it says so), anything else is read as text.
 */
import { closeSync, createReadStream, openSync, readSync } from "node:fs";
import { createInterface, type Interface } from "node:readline";
import { createGunzip } from "node:zlib";

export type DumpEncoding = "gzip" | "zip" | "text";

export function sniffDumpEncoding(path: string): DumpEncoding {
  const fd = openSync(path, "r");
  try {
    const b = Buffer.alloc(2);
    const n = readSync(fd, b, 0, 2, 0);
    if (n === 2 && b[0] === 0x1f && b[1] === 0x8b) return "gzip";
    if (n === 2 && b[0] === 0x50 && b[1] === 0x4b) return "zip";
    return "text";
  } finally {
    closeSync(fd);
  }
}

/** Lines of a `.jsonl` or `.jsonl.gz` dump. A `.zip` is refused with a message a person can act on. */
export function dumpLines(path: string): Interface {
  const enc = sniffDumpEncoding(path);
  if (enc === "zip") {
    throw new Error("This is a .zip file. Extract it first, or pick the .jsonl.gz / .jsonl dump itself.");
  }
  const raw = createReadStream(path);
  return createInterface({ input: enc === "gzip" ? raw.pipe(createGunzip()) : raw, crlfDelay: Infinity });
}
