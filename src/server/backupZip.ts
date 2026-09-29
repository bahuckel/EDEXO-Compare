/**
 * A small zip writer and reader for the backups (docs/galaxy-plan-28092026.md, section B).
 *
 * No dependency: Node's zlib does the deflate, this file does the container. The writer streams each
 * file through `deflateRaw` into the archive, so a 300 MB journal folder never sits in memory; sizes
 * and the CRC travel in a data descriptor after each entry (general purpose bit 3), which Windows
 * Explorer, 7-Zip and `unzip` all read. The CRC is computed here rather than with `zlib.crc32`
 * because the console builds run on Node 18, which does not have it.
 *
 * **Copying an entry from another zip** (`addCopy`) moves its compressed bytes as they are — no
 * inflate/deflate — after checking them against their CRC. That is what makes every backup complete
 * without making every backup slow: an unchanged journal or the 0.5 GB bio-bodies file is copied from
 * the previous backup in the time it takes to read it.
 *
 * Limits, checked rather than assumed: no ZIP64, so every entry and the whole archive must stay under
 * 4 GiB and there can be at most 65,535 entries. A backup is tens of megabytes; the checks are there
 * so the day one is not, it fails loudly instead of writing a broken archive.
 */
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { createDeflateRaw, createInflateRaw, inflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array, prev = 0): number {
  let c = (prev ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const MAX_32 = 0xffffffff;

/** MS-DOS date and time, local time, 2-second resolution (what every unzip tool shows). */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

interface Written {
  name: Buffer;
  /** General purpose flags: 0x0808 streamed with a data descriptor, 0x0800 copied with sizes known. */
  flags: number;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

export class ZipWriter {
  private readonly out: WriteStream;
  private offset = 0;
  private readonly entries: Written[] = [];
  private readonly names = new Set<string>();

  constructor(path: string) {
    this.out = createWriteStream(path);
  }

  private write(buf: Buffer): Promise<void> {
    this.offset += buf.length;
    return new Promise((resolve, reject) => {
      this.out.write(buf, (err) => (err ? reject(err) : resolve()));
    });
  }

  /** Add a file from disk under `name` (forward slashes, no leading slash). */
  async addFile(name: string, sourcePath: string, mtime?: Date): Promise<void> {
    const st = await stat(sourcePath);
    await this.addStream(name, () => createReadStream(sourcePath), mtime ?? st.mtime);
  }

  /** Add bytes held in memory (a manifest, an export built in-process). */
  async addBuffer(name: string, data: Buffer | string, mtime = new Date()): Promise<void> {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    await this.addStream(name, () => bufferStream(buf), mtime);
  }

  private async addStream(name: string, source: () => NodeJS.ReadableStream, mtime: Date): Promise<void> {
    const clean = name.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!clean || clean.split("/").some((p) => p === ".." || p === "")) throw new Error(`bad entry name: ${name}`);
    if (this.names.has(clean)) throw new Error(`duplicate entry: ${clean}`);
    if (this.entries.length >= 0xffff) throw new Error("too many files for a zip without ZIP64");
    this.names.add(clean);
    const nameBuf = Buffer.from(clean, "utf8");
    const { time, date } = dosDateTime(mtime);
    const offset = this.offset;

    // Local header: CRC and sizes are zero here and follow in the data descriptor (bit 3).
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed: 2.0 (deflate)
    lh.writeUInt16LE(0x0808, 6); // bit 3 data descriptor, bit 11 UTF-8 names
    lh.writeUInt16LE(8, 8); // deflate
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt16LE(nameBuf.length, 26);
    await this.write(lh);
    await this.write(nameBuf);

    let crc = 0;
    let size = 0;
    let compressed = 0;
    await new Promise<void>((resolve, reject) => {
      const input = source();
      const deflate = createDeflateRaw({ level: 6 });
      input.on("data", (chunk: Buffer) => {
        crc = crc32(chunk, crc);
        size += chunk.length;
      });
      input.on("error", reject);
      deflate.on("error", reject);
      deflate.on("data", (chunk: Buffer) => {
        compressed += chunk.length;
        this.offset += chunk.length;
        if (!this.out.write(chunk)) {
          deflate.pause();
          this.out.once("drain", () => deflate.resume());
        }
      });
      deflate.on("end", () => resolve());
      input.pipe(deflate);
    });
    if (size > MAX_32 || compressed > MAX_32 || this.offset > MAX_32) {
      throw new Error(`${clean} is too large for a zip without ZIP64`);
    }

    const dd = Buffer.alloc(16);
    dd.writeUInt32LE(0x08074b50, 0);
    dd.writeUInt32LE(crc, 4);
    dd.writeUInt32LE(compressed, 8);
    dd.writeUInt32LE(size, 12);
    await this.write(dd);
    this.entries.push({ name: nameBuf, flags: 0x0808, method: 8, crc, compressed, size, offset, time, date });
  }

  /**
   * Copy an entry of another zip under `name`, compressed bytes as they are. The caller checks them
   * first ({@link verifyZipEntry}); a copy of a damaged entry would carry the damage forward.
   */
  async addCopy(name: string, sourceZip: string, e: ZipEntry): Promise<void> {
    const clean = name.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!clean || clean.split("/").some((p) => p === ".." || p === "")) throw new Error(`bad entry name: ${name}`);
    if (this.names.has(clean)) throw new Error(`duplicate entry: ${clean}`);
    if (this.entries.length >= 0xffff) throw new Error("too many files for a zip without ZIP64");
    const at = await entryDataOffset(sourceZip, e);
    this.names.add(clean);
    const nameBuf = Buffer.from(clean, "utf8");
    const { time, date } = dosDateTime(e.mtime);
    const offset = this.offset;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // UTF-8 names; sizes are known, so no data descriptor
    lh.writeUInt16LE(e.method, 8);
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(e.crc, 14);
    lh.writeUInt32LE(e.compressed, 18);
    lh.writeUInt32LE(e.size, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    await this.write(lh);
    await this.write(nameBuf);
    if (e.compressed > 0) {
      await new Promise<void>((resolve, reject) => {
        const input = createReadStream(sourceZip, { start: at, end: at + e.compressed - 1 });
        input.on("error", reject);
        input.on("data", (data: string | Buffer) => {
          const chunk = typeof data === "string" ? Buffer.from(data) : data;
          this.offset += chunk.length;
          if (!this.out.write(chunk)) {
            input.pause();
            this.out.once("drain", () => input.resume());
          }
        });
        input.on("end", () => resolve());
      });
    }
    if (this.offset > MAX_32) throw new Error(`${clean} is too large for a zip without ZIP64`);
    this.entries.push({ name: nameBuf, flags: 0x0800, method: e.method, crc: e.crc, compressed: e.compressed, size: e.size, offset, time, date });
  }

  /** Write the central directory and close the file. Returns the archive's size in bytes. */
  async finish(): Promise<number> {
    const cdStart = this.offset;
    for (const e of this.entries) {
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0);
      ch.writeUInt16LE(0x0314, 4); // made by: Unix 2.0 — so the attributes below read as mode bits
      ch.writeUInt16LE(20, 6);
      ch.writeUInt16LE(e.flags, 8);
      ch.writeUInt16LE(e.method, 10);
      ch.writeUInt16LE(e.time, 12);
      ch.writeUInt16LE(e.date, 14);
      ch.writeUInt32LE(e.crc, 16);
      ch.writeUInt32LE(e.compressed, 20);
      ch.writeUInt32LE(e.size, 24);
      ch.writeUInt16LE(e.name.length, 28);
      ch.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a regular file, rw-r--r--
      ch.writeUInt32LE(e.offset, 42);
      await this.write(ch);
      await this.write(e.name);
    }
    const cdSize = this.offset - cdStart;
    if (this.offset > MAX_32) throw new Error("the backup is too large for a zip without ZIP64");
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    await this.write(eocd);
    await new Promise<void>((resolve, reject) => this.out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    return this.offset;
  }

  /** Close and leave the partial file for the caller to delete (a failed backup). */
  abort(): Promise<void> {
    return new Promise((resolve) => this.out.end(() => resolve()));
  }
}

function bufferStream(buf: Buffer): NodeJS.ReadableStream {
  return Readable.from([buf]);
}

export interface ZipEntry {
  name: string;
  size: number;
  compressed: number;
  crc: number;
  mtime: Date;
  /** Offset of the local header. */
  offset: number;
  method: number;
}

/** The entries of a zip, from its central directory. */
export async function listZip(path: string): Promise<ZipEntry[]> {
  const fh = await open(path, "r");
  try {
    const { size } = await fh.stat();
    const tail = Math.min(size, 22 + 0xffff);
    const buf = Buffer.alloc(tail);
    await fh.read(buf, 0, tail, size - tail);
    let at = -1;
    for (let i = tail - 22; i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        at = i;
        break;
      }
    }
    if (at < 0) throw new Error("not a zip file (no end of central directory)");
    const count = buf.readUInt16LE(at + 10);
    const cdSize = buf.readUInt32LE(at + 12);
    const cdStart = buf.readUInt32LE(at + 16);
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdStart);
    const out: ZipEntry[] = [];
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error("damaged central directory");
      const method = cd.readUInt16LE(p + 10);
      const time = cd.readUInt16LE(p + 12);
      const date = cd.readUInt16LE(p + 14);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      out.push({
        name: cd.toString("utf8", p + 46, p + 46 + nameLen),
        crc: cd.readUInt32LE(p + 16),
        compressed: cd.readUInt32LE(p + 20),
        size: cd.readUInt32LE(p + 24),
        offset: cd.readUInt32LE(p + 42),
        method,
        mtime: new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2),
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  } finally {
    await fh.close();
  }
}

/** Where an entry's compressed bytes start (past its local header). */
async function entryDataOffset(path: string, e: ZipEntry): Promise<number> {
  const fh = await open(path, "r");
  try {
    const lh = Buffer.alloc(30);
    await fh.read(lh, 0, 30, e.offset);
    if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error(`damaged entry: ${e.name}`);
    return e.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  } finally {
    await fh.close();
  }
}

/**
 * Does an entry still read back to its CRC and size? Streamed: a 0.5 GB entry is never held in
 * memory. False on any damage, never a throw.
 */
export async function verifyZipEntry(path: string, e: ZipEntry): Promise<boolean> {
  if (e.method !== 8 && e.method !== 0) return false;
  let at: number;
  try {
    at = await entryDataOffset(path, e);
  } catch {
    return false;
  }
  return new Promise<boolean>((resolve) => {
    let crc = 0;
    let size = 0;
    const count = (data: string | Buffer) => {
      const chunk = typeof data === "string" ? Buffer.from(data) : data;
      crc = crc32(chunk, crc);
      size += chunk.length;
    };
    const done = () => resolve(crc === e.crc && size === e.size);
    if (e.compressed === 0) return done();
    const input = createReadStream(path, { start: at, end: at + e.compressed - 1 });
    input.on("error", () => resolve(false));
    if (e.method === 0) {
      input.on("data", count);
      input.on("end", done);
      return;
    }
    const inflate = createInflateRaw();
    inflate.on("error", () => resolve(false));
    inflate.on("data", count);
    inflate.on("end", done);
    input.pipe(inflate);
  });
}

/** One entry's bytes, checked against its CRC. */
export async function readZipEntry(path: string, e: ZipEntry): Promise<Buffer> {
  const fh = await open(path, "r");
  try {
    const lh = Buffer.alloc(30);
    await fh.read(lh, 0, 30, e.offset);
    if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error(`damaged entry: ${e.name}`);
    const dataAt = e.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    const raw = Buffer.alloc(e.compressed);
    await fh.read(raw, 0, e.compressed, dataAt);
    const data = e.method === 8 ? inflateRawSync(raw) : e.method === 0 ? raw : null;
    if (!data) throw new Error(`${e.name}: compression method ${e.method} is not supported`);
    if (data.length !== e.size || crc32(data) !== e.crc) throw new Error(`${e.name} is damaged (checksum)`);
    return data;
  } finally {
    await fh.close();
  }
}
