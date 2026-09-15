/**
 * The galaxy's biology *bodies*: the physics of every world somebody honked and walked away from.
 *
 * The companion to `bioIndex.ts`, and it exists because that index cannot answer the question the
 * owner actually asked — *"someone might have just FSS-ed the place and left without scanning any
 * plant or DSS-ing the planet, but when we have atmosphere, gravity, temperatures and so on, and we
 * know if its landable, we can pretty easily determine if there is going to be plant X"*.
 *
 * `bio-index.bin` knows which species have been **recorded** in a system, and that record only
 * exists because a commander landed and logged one. Measured on the shipped index: of 5,286,282
 * systems, the 1,713,156 carrying a species name are exactly the 1,713,156 somebody has walked. So
 * "untouched" and "contains species X" select disjoint sets, and the filter as literally asked
 * returns zero rows, always. What *is* known about an untouched system is the body — subtype,
 * atmosphere, temperature, gravity, pressure, volcanism — which is precisely what the matcher gates
 * on when the commander is standing there reading their own FSS. This file carries that, so the
 * same gates can run over somebody else's honk.
 *
 * Built by `scripts/build-bio-bodies.ts`, which documents the format; the offsets are repeated here
 * because a reader that re-derives them from prose is a reader that gets them wrong.
 *
 * ## Read as bytes, and hand out one cursor
 *
 * 10.3 million bodies inflated into objects is several gigabytes. The buffer is held as-is and read
 * through a `DataView`, and `forEachInRegion` hands the callback **one reusable cursor** rather than
 * a record per body — a region walk touches ~180,000 bodies, and a fresh object for each of them is
 * garbage for nothing. The cursor is only valid inside the callback; anything worth keeping must be
 * copied out with `snapshot()`.
 *
 * ## Units are the dump's, not the journal's
 *
 * `gravityG` is already Earth gees and `pressureAtm` already atmospheres, where the journal writes
 * m/s² and pascals. Getting that backwards produces plausible nonsense rather than an error — a
 * 2.5 g world reads as 0.255 g — so it is said here as well as in the builder.
 *
 * What a consumer should do about it is not symmetrical, and `galaxyBodyScan.ts` explains why: the
 * gravity has to go back to m/s², and the pressure has to stay in atmospheres.
 *
 * ## Local, and optional
 *
 * The file lives beside the user's settings, **not** under `data/`: `dist-win.mjs` copies the whole
 * of `data/` into the installer, which is how `bio-index.bin` came to be 234 MB of a 369 MB exe. It
 * is built from a dump only its owner has, so a missing file is the ordinary case and not an error
 * — the feature hides itself, exactly as the galaxy search already does without `bio-index.bin`.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { resolveUserSettingsJsonPath } from "./paths.js";

const MAGIC = "EDEXOBOD";
const HEADER = 24;
const SYS_RECORD = 28;
const BODY_RECORD = 24;

/** The body is landable. Without this there is nothing to walk on and no biology to sample. */
export const BODY_LANDABLE = 1;
/**
 * The dump carried a `genuses` list for this body — somebody has already probed it with a DSS.
 *
 * The evidence axis the whole feature turns on: clear means nobody has been past the honk.
 */
export const BODY_DSS = 2;

/**
 * One body, read straight out of the buffer.
 *
 * Every field is a getter over a stored offset, so the walk allocates nothing. **The instance is
 * reused** — hold on to it past the callback and it will be describing some other world.
 */
export interface BioBodyCursor {
  /** Ordinal of the system in the file, for {@link BioBodies.systemName} and the system getters. */
  readonly systemIndex: number;
  /** Ordinal of the body in the file, for {@link BioBodies.bodyName}. */
  readonly bodyIndex: number;
  readonly bodyId: number;
  /** Planet class, e.g. `Icy body`. Empty when the dump did not record one. */
  readonly subType: string;
  /** Journal-style atmosphere name, e.g. `Thin Oxygen`. Empty when unrecorded. */
  readonly atmosphere: string;
  readonly volcanism: string;
  readonly flags: number;
  readonly landable: boolean;
  /** Somebody has probed this body; the genus is known and it is not untouched. */
  readonly dssMapped: boolean;
  /** Kelvin. 0 means unrecorded, which is not the same as absolute zero. */
  readonly temperatureK: number;
  /** **Earth gees** — the dump's own unit. See the note at the top of this file. */
  readonly gravityG: number;
  /** **Atmospheres** — the dump's own unit. */
  readonly pressureAtm: number;
  /** How many biological signals the FSS counted here. */
  readonly bioCount: number;
  /** A plain object copy, for a row that has to outlive the walk. */
  snapshot(): BioBodyRow;
}

/** A cursor copied out, for the handful of bodies a search actually returns. */
export interface BioBodyRow {
  systemIndex: number;
  bodyIndex: number;
  bodyId: number;
  subType: string;
  atmosphere: string;
  volcanism: string;
  flags: number;
  temperatureK: number;
  gravityG: number;
  pressureAtm: number;
  bioCount: number;
}

export interface BioBodySystem {
  index: number;
  id64: bigint;
  name: string;
  x: number;
  y: number;
  z: number;
  /** klightspeed region index, 1-42; 0 when outside any named region. */
  regionId: number;
  /**
   * The system primary's spectral class as the dump writes it — `K3`, `M9`, `AeBe7`, or occasionally
   * a subtype string. Empty when the dump named no main star.
   */
  starType: string;
  bioBodyCount: number;
}

export interface BioBodies {
  systemCount: number;
  bodyCount: number;
  /** Bytes on disk, for a status line — this is half a gigabyte and a reader should be able to say so. */
  fileBytes: number;
  /**
   * Every bio body in one region, the cheapest walk this file can offer.
   *
   * The system table is in encounter order rather than sorted by region, so this is a linear pass
   * over the 5.05 M system records (24 ms measured) with a bounded walk of each matching system's
   * bodies. Return `false` from the callback to stop early.
   */
  forEachInRegion(regionId: number, cb: (body: BioBodyCursor) => boolean | void): void;
  /**
   * The ordinals of every system in a region, so a caller can walk them in its own time.
   *
   * {@link forEachInRegion} is one uninterruptible pass, which is right for a count and wrong for
   * work measured in seconds: a 36-second walk on the event loop stops the journal watcher, the
   * websocket and everything else in the process. Handing back the indices lets a caller take them
   * a few thousand at a time and yield in between. 6 MB for the largest region.
   */
  regionSystemIndices(regionId: number): Uint32Array;
  /** The bodies of one system, by ordinal. Return `false` from the callback to stop. */
  forEachBodyOfSystem(systemIndex: number, cb: (body: BioBodyCursor) => boolean | void): void;
  system(systemIndex: number): BioBodySystem;
  systemName(systemIndex: number): string;
  /** The full body name: the system's name plus the suffix the dump recorded (`A 4 c`). */
  bodyName(systemIndex: number, bodyIndex: number): string;
  /** How many systems the file holds per region index, so a picker need not offer empty ones. */
  systemsByRegion(): Uint32Array;
  /**
   * Every planet class the file interns, including the empty string for "not recorded".
   *
   * Six of them across 10.3 M bodies, which is what makes a per-class decision worth precomputing:
   * a caller can ask the matcher once per class instead of once per body. The strings are the
   * **dump's** spelling — `High metal content world`, not the journal's `High metal content body`.
   */
  planetClasses(): string[];
  /** Every atmosphere the file interns, the dump's spelling, empty string included. */
  atmospheres(): string[];
}

class Cursor implements BioBodyCursor {
  bodyIndex = -1;
  private o = 0;
  constructor(private readonly f: Bodies) {}
  seek(bodyIndex: number): void {
    this.bodyIndex = bodyIndex;
    this.o = this.f.bodiesAt + bodyIndex * BODY_RECORD;
  }
  get systemIndex(): number {
    return this.f.view.getUint32(this.o, true);
  }
  get bodyId(): number {
    return this.f.view.getUint16(this.o + 4, true);
  }
  get subType(): string {
    return this.f.strings.subTypes[this.f.view.getUint8(this.o + 6) - 1] ?? "";
  }
  get atmosphere(): string {
    return this.f.strings.atmospheres[this.f.view.getUint8(this.o + 7) - 1] ?? "";
  }
  get volcanism(): string {
    return this.f.strings.volcanisms[this.f.view.getUint8(this.o + 8) - 1] ?? "";
  }
  get flags(): number {
    return this.f.view.getUint8(this.o + 9);
  }
  get landable(): boolean {
    return (this.flags & BODY_LANDABLE) !== 0;
  }
  get dssMapped(): boolean {
    return (this.flags & BODY_DSS) !== 0;
  }
  get temperatureK(): number {
    return this.f.view.getFloat32(this.o + 10, true);
  }
  get gravityG(): number {
    return this.f.view.getFloat32(this.o + 14, true);
  }
  get pressureAtm(): number {
    return this.f.view.getFloat32(this.o + 18, true);
  }
  get bioCount(): number {
    return this.f.view.getUint8(this.o + 22);
  }
  snapshot(): BioBodyRow {
    return {
      systemIndex: this.systemIndex,
      bodyIndex: this.bodyIndex,
      bodyId: this.bodyId,
      subType: this.subType,
      atmosphere: this.atmosphere,
      volcanism: this.volcanism,
      flags: this.flags,
      temperatureK: this.temperatureK,
      gravityG: this.gravityG,
      pressureAtm: this.pressureAtm,
      bioCount: this.bioCount,
    };
  }
}

interface StringTables {
  subTypes: string[];
  atmospheres: string[];
  volcanisms: string[];
  starTypes: string[];
}

class Bodies implements BioBodies {
  readonly view: DataView;
  readonly strings: StringTables;
  readonly systemCount: number;
  readonly bodyCount: number;
  readonly fileBytes: number;
  private readonly systemsAt: number;
  readonly bodiesAt: number;
  private readonly sysNamesAt: number;
  private readonly sysNameOffsets: Uint32Array;
  private readonly bodyNamesAt: number;
  /**
   * Where each body's name run starts, built on first use.
   *
   * 41 MB for 10.3 M entries, and a search returns a few hundred names — so it is not paid for by
   * anyone who only ever filters. The system offsets below have no such choice: the body name run
   * begins where the system name run ends, so finding it at all means walking it.
   */
  private bodyNameOffsets: Uint32Array | null = null;
  private readonly cursor: Cursor;

  constructor(
    private readonly buf: Buffer,
    fileBytes: number,
  ) {
    if (buf.length < HEADER || buf.toString("ascii", 0, 8) !== MAGIC) {
      throw new Error("not a bio bodies file");
    }
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.fileBytes = fileBytes;
    this.systemCount = this.view.getUint32(12, true);
    this.bodyCount = this.view.getUint32(16, true);
    const jsonLen = this.view.getUint32(20, true);
    const raw = JSON.parse(buf.toString("utf8", HEADER, HEADER + jsonLen)) as Partial<StringTables>;
    this.strings = {
      subTypes: raw.subTypes ?? [],
      atmospheres: raw.atmospheres ?? [],
      volcanisms: raw.volcanisms ?? [],
      starTypes: raw.starTypes ?? [],
    };
    this.systemsAt = HEADER + jsonLen;
    this.bodiesAt = this.systemsAt + this.systemCount * SYS_RECORD;
    this.sysNamesAt = this.bodiesAt + this.bodyCount * BODY_RECORD;
    if (this.sysNamesAt > buf.length) throw new Error("bio bodies file is truncated");

    // Prefix sum over the system name run. The lengths are already on disk; an offset table would
    // only be the same numbers written twice, and 20 MB of them.
    this.sysNameOffsets = new Uint32Array(this.systemCount + 1);
    let at = this.sysNamesAt;
    for (let i = 0; i < this.systemCount; i++) {
      this.sysNameOffsets[i] = at;
      if (at >= buf.length) continue;
      at += 1 + this.view.getUint8(at);
    }
    this.sysNameOffsets[this.systemCount] = at;
    if (at > buf.length) throw new Error("bio bodies system name run is truncated");
    this.bodyNamesAt = at;
    this.cursor = new Cursor(this);
  }

  private sysOffset(i: number): number {
    return this.systemsAt + i * SYS_RECORD;
  }

  system(i: number): BioBodySystem {
    const o = this.sysOffset(i);
    return {
      index: i,
      id64: this.view.getBigUint64(o, true),
      name: this.systemName(i),
      x: this.view.getFloat32(o + 8, true),
      y: this.view.getFloat32(o + 12, true),
      z: this.view.getFloat32(o + 16, true),
      regionId: this.view.getUint8(o + 20),
      starType: this.strings.starTypes[this.view.getUint8(o + 21) - 1] ?? "",
      bioBodyCount: this.view.getUint16(o + 22, true),
    };
  }

  systemName(i: number): string {
    const at = this.sysNameOffsets[i] ?? this.buf.length;
    if (at >= this.buf.length) return "";
    const len = this.view.getUint8(at);
    return this.buf.toString("utf8", at + 1, at + 1 + len);
  }

  private ensureBodyNames(): Uint32Array {
    if (this.bodyNameOffsets) return this.bodyNameOffsets;
    const off = new Uint32Array(this.bodyCount + 1);
    let at = this.bodyNamesAt;
    for (let i = 0; i < this.bodyCount; i++) {
      off[i] = at;
      if (at >= this.buf.length) continue;
      at += 1 + this.view.getUint8(at);
    }
    off[this.bodyCount] = at;
    return (this.bodyNameOffsets = off);
  }

  bodyName(systemIndex: number, bodyIndex: number): string {
    const off = this.ensureBodyNames();
    const at = off[bodyIndex] ?? this.buf.length;
    if (at >= this.buf.length) return "";
    const len = this.view.getUint8(at);
    const suffix = this.buf.toString("utf8", at + 1, at + 1 + len);
    const sys = this.systemName(systemIndex);
    /*
      The builder stored only the part after the system name, so the two halves are joined here. A
      suffix that already carries the system name is left alone rather than doubled — the dump does
      not always agree with itself about how a body is spelled, and `Foo Foo A 1` would be a name
      that exists nowhere and cannot be pasted into the galaxy map.
    */
    if (!sys) return suffix;
    if (!suffix) return sys;
    return suffix.startsWith(sys) ? suffix : `${sys} ${suffix}`;
  }

  forEachInRegion(regionId: number, cb: (body: BioBodyCursor) => boolean | void): void {
    const cur = this.cursor;
    for (let i = 0; i < this.systemCount; i++) {
      const o = this.sysOffset(i);
      if (this.view.getUint8(o + 20) !== regionId) continue;
      const n = this.view.getUint16(o + 22, true);
      const first = this.view.getUint32(o + 24, true);
      for (let b = 0; b < n; b++) {
        cur.seek(first + b);
        if (cb(cur) === false) return;
      }
    }
  }

  regionSystemIndices(regionId: number): Uint32Array {
    // Counted first so the array is allocated once at its true size: the largest region holds 1.57 M
    // systems, and growing an array to that through doubling costs more than the second pass.
    let n = 0;
    for (let i = 0; i < this.systemCount; i++) {
      if (this.view.getUint8(this.sysOffset(i) + 20) === regionId) n++;
    }
    const out = new Uint32Array(n);
    let at = 0;
    for (let i = 0; i < this.systemCount && at < n; i++) {
      if (this.view.getUint8(this.sysOffset(i) + 20) === regionId) out[at++] = i;
    }
    return out;
  }

  forEachBodyOfSystem(systemIndex: number, cb: (body: BioBodyCursor) => boolean | void): void {
    const o = this.sysOffset(systemIndex);
    const n = this.view.getUint16(o + 22, true);
    const first = this.view.getUint32(o + 24, true);
    const cur = this.cursor;
    for (let b = 0; b < n; b++) {
      cur.seek(first + b);
      if (cb(cur) === false) return;
    }
  }

  systemsByRegion(): Uint32Array {
    const out = new Uint32Array(256);
    for (let i = 0; i < this.systemCount; i++) out[this.view.getUint8(this.sysOffset(i) + 20)]!++;
    return out;
  }

  // The empty string leads both lists because index 0 means "the dump did not record this", and a
  // caller deciding per value has to be given that case rather than left to discover it.
  planetClasses(): string[] {
    return ["", ...this.strings.subTypes];
  }

  atmospheres(): string[] {
    return ["", ...this.strings.atmospheres];
  }
}

/** Everything the region picker needs, without holding the file that answers it. */
export interface BioBodiesSummary {
  systemCount: number;
  bodyCount: number;
  fileBytes: number;
  /** Systems per region index, 0 = outside any named region. */
  systemsByRegion: Uint32Array;
}

/**
 * The region counts, read without loading half a gigabyte into the process.
 *
 * The map screen asks for the region list the moment it opens, and {@link loadBioBodies} would
 * answer it by reading the whole 536 MB file and **keeping it** — so merely visiting the map would
 * cost that much resident memory for the rest of the session, whether or not anybody searched.
 *
 * Only one byte in each 28-byte system record is needed, so the system table is read in chunks and
 * dropped as it goes. Transient cost is the chunk; nothing survives the call. The full file is
 * still loaded when somebody actually runs a scan, which is when it is worth paying for.
 */
export function readBioBodiesSummary(file = bioBodiesPath()): BioBodiesSummary | null {
  if (!existsSync(file)) return null;
  let fd: number | null = null;
  try {
    const fileBytes = statSync(file).size;
    fd = openSync(file, "r");
    const head = Buffer.alloc(HEADER);
    readSync(fd, head, 0, HEADER, 0);
    if (head.toString("ascii", 0, 8) !== MAGIC) return null;
    const systemCount = head.readUInt32LE(12);
    const bodyCount = head.readUInt32LE(16);
    const jsonLen = head.readUInt32LE(20);
    const systemsAt = HEADER + jsonLen;

    const systemsByRegion = new Uint32Array(256);
    // A whole number of records per chunk, so a record is never split across two reads.
    const perChunk = 65536;
    const chunk = Buffer.alloc(perChunk * SYS_RECORD);
    for (let done = 0; done < systemCount; done += perChunk) {
      const want = Math.min(perChunk, systemCount - done) * SYS_RECORD;
      const got = readSync(fd, chunk, 0, want, systemsAt + done * SYS_RECORD);
      for (let o = 20; o + 1 <= got; o += SYS_RECORD) systemsByRegion[chunk[o]!]!++;
      if (got < want) break;
    }
    return { systemCount, bodyCount, fileBytes, systemsByRegion };
  } catch (e) {
    console.warn(`ED Exo Compare — bio bodies file unreadable, continuing without it: ${String(e)}`);
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export function bioBodiesPath(): string {
  return path.join(path.dirname(resolveUserSettingsJsonPath()), "edexo-bio-bodies.bin");
}

let cached: BioBodies | null | undefined;

/** The body file, or null when this machine has not built one. Read once and held. */
export function loadBioBodies(file = bioBodiesPath()): BioBodies | null {
  if (cached !== undefined) return cached;
  if (!existsSync(file)) return (cached = null);
  try {
    cached = new Bodies(readFileSync(file), statSync(file).size);
  } catch (e) {
    console.warn(`ED Exo Compare — bio bodies file unreadable, continuing without it: ${String(e)}`);
    cached = null;
  }
  return cached;
}

/** Test seam. */
export function clearBioBodiesCache(): void {
  cached = undefined;
}
