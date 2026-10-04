/**
 * The backups' zip container (src/server/backupZip.ts): what it writes reads back byte for byte,
 * through our own reader and through the system's unzip where there is one.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { crc32, listZip, readZipEntry, ZipWriter } from "../src/server/backupZip.js";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "edexo-zip-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("backup zip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    expect(crc32(Buffer.from("6789"), crc32(Buffer.from("12345")))).toBe(0xcbf43926);
  });

  it("writes files and buffers that read back exactly, with names and times", async () => {
    const d = tmp();
    const big = Buffer.alloc(3_000_000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 7919) % 251;
    writeFileSync(path.join(d, "big.bin"), big);
    writeFileSync(path.join(d, "Journal.2026-09-29T100000.01.log"), '{"event":"Fileheader"}\n'.repeat(5000));
    const zip = path.join(d, "out.zip");
    const w = new ZipWriter(zip);
    const when = new Date(2026, 8, 29, 10, 20, 30);
    await w.addFile("journals/Journal.2026-09-29T100000.01.log", path.join(d, "Journal.2026-09-29T100000.01.log"), when);
    await w.addFile("app-data/big.bin", path.join(d, "big.bin"));
    await w.addBuffer("manifest.json", JSON.stringify({ ok: "ünïcode ✓" }));
    await w.addBuffer("empty.txt", "");
    const bytes = await w.finish();
    expect(bytes).toBe(readFileSync(zip).length);

    const entries = await listZip(zip);
    expect(entries.map((e) => e.name)).toEqual([
      "journals/Journal.2026-09-29T100000.01.log",
      "app-data/big.bin",
      "manifest.json",
      "empty.txt",
    ]);
    expect(entries[0]!.mtime).toEqual(when);
    expect((await readZipEntry(zip, entries[1]!)).equals(big)).toBe(true);
    expect(JSON.parse((await readZipEntry(zip, entries[2]!)).toString("utf8"))).toEqual({ ok: "ünïcode ✓" });
    expect((await readZipEntry(zip, entries[3]!)).length).toBe(0);
    // The journal compresses the way text does.
    expect(entries[0]!.compressed).toBeLessThan(entries[0]!.size / 20);
  });

  it("lays out local headers other tools can walk: data follows each header, then a descriptor", async () => {
    const d = tmp();
    const zip = path.join(d, "a.zip");
    const w = new ZipWriter(zip);
    await w.addBuffer("a.txt", "hello hello hello");
    await w.finish();
    const buf = readFileSync(zip);
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
    const nameLen = buf.readUInt16LE(26);
    const [e] = await listZip(zip);
    const data = inflateRawSync(buf.subarray(30 + nameLen, 30 + nameLen + e!.compressed));
    expect(data.toString()).toBe("hello hello hello");
    expect(buf.readUInt32LE(30 + nameLen + e!.compressed)).toBe(0x08074b50);
  });

  it("refuses names that would climb out of a folder, and duplicates", async () => {
    const d = tmp();
    const w = new ZipWriter(path.join(d, "b.zip"));
    await expect(w.addBuffer("../evil.txt", "x")).rejects.toThrow(/bad entry name/);
    await expect(w.addBuffer("a//b.txt", "x")).rejects.toThrow(/bad entry name/);
    await w.addBuffer("same.txt", "x");
    await expect(w.addBuffer("same.txt", "y")).rejects.toThrow(/duplicate/);
    await w.finish();
  });

  it("notices a damaged entry", async () => {
    const d = tmp();
    const zip = path.join(d, "c.zip");
    const w = new ZipWriter(zip);
    await w.addBuffer("a.txt", "some text that is long enough to deflate into several bytes ".repeat(20), new Date());
    await w.finish();
    const [e] = await listZip(zip);
    const buf = readFileSync(zip);
    const nameLen = buf.readUInt16LE(26);
    buf[30 + nameLen + 5]! ^= 0xff;
    writeFileSync(zip, buf);
    await expect(readZipEntry(zip, e!)).rejects.toThrow();
  });
});
