/**
 * The galaxy biology index: which species are known to be in which system.
 *
 * 1.7 million systems, the species edastro's codex has recorded in each, and where each system is.
 * Built by `scripts/build-bio-index.ts`; the format is documented there.
 *
 * This is the only layer that can answer "where in the galaxy is something worth 19 M" — the journal
 * knows where this commander has been, and the feeder corpus knows where it has profiles, and
 * neither is a galaxy.
 *
 * ## Read as bytes, not as objects
 *
 * 40 MB of records inflated into 1.7 M JavaScript objects is roughly a gigabyte of heap and several
 * seconds of construction, for a structure that is then only ever scanned or searched. The buffer is
 * held as-is and read through a DataView, so loading is the time it takes to read the file.
 *
 * The species run is variable-length, so offsets are a prefix sum built once at load rather than
 * stored — 6.8 MB saved on disk for a Uint32Array that costs the same in memory either way.
 *
 * Missing file is not an error. The index is optional data: the app works without it, minus the
 * galaxy-wide filter, exactly as it did before this existed.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./paths.js";

const MAGIC = "EDEXOBIO";
const RECORD = 22;

export interface BioIndexSystem {
  id64: bigint;
  /** What to type into the galaxy map. Empty only if the source had no name. */
  name: string;
  x: number;
  y: number;
  z: number;
  /** klightspeed region index, 1-42; 0 when unknown. */
  regionId: number;
  /** Our own species ids. */
  species: string[];
}

export interface BioIndex {
  systemCount: number;
  species: string[];
  /** Species present in a system, or null when the index has never heard of it. */
  lookup(id64: bigint): BioIndexSystem | null;
  /** Every system holding at least one of `speciesIds`. */
  systemsWithAny(speciesIds: Iterable<string>): BioIndexSystem[];
}

class Index implements BioIndex {
  private readonly view: DataView;
  private readonly tableAt: number;
  private readonly runsAt: number;
  private readonly offsets: Uint32Array;
  private readonly namesAt: number;
  private readonly nameOffsets: Uint32Array;
  readonly systemCount: number;
  readonly species: string[];

  constructor(private readonly buf: Buffer) {
    if (buf.length < 20 || buf.toString("ascii", 0, 8) !== MAGIC) {
      throw new Error("not a bio index file");
    }
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const jsonLen = this.view.getUint32(16, true);
    this.systemCount = this.view.getUint32(12, true);
    this.species = (JSON.parse(buf.toString("utf8", 20, 20 + jsonLen)) as { species: string[] }).species;
    this.tableAt = 20 + jsonLen;
    this.runsAt = this.tableAt + this.systemCount * RECORD;

    // Prefix sum over the per-system species counts: the start of each system's run.
    this.offsets = new Uint32Array(this.systemCount + 1);
    let at = 0;
    for (let i = 0; i < this.systemCount; i++) {
      this.offsets[i] = at;
      at += this.view.getUint8(this.tableAt + i * RECORD + 21);
    }
    this.offsets[this.systemCount] = at;
    if (this.runsAt + at > buf.length) throw new Error("bio index is truncated");

    // v2 appends a name run: u8 length + UTF-8, one per system, same order. Offsets are a prefix sum
    // for the same reason as the species runs — the length is already on disk, an offset would not be.
    this.namesAt = this.runsAt + at;
    this.nameOffsets = new Uint32Array(this.systemCount + 1);
    let nAt = this.namesAt;
    const hasNames = nAt < buf.length;
    for (let i = 0; i < this.systemCount; i++) {
      this.nameOffsets[i] = nAt;
      if (!hasNames || nAt >= buf.length) continue;
      nAt += 1 + this.view.getUint8(nAt);
    }
    this.nameOffsets[this.systemCount] = nAt;
    if (hasNames && nAt > buf.length) throw new Error("bio index name run is truncated");
  }

  private at(i: number): BioIndexSystem {
    const o = this.tableAt + i * RECORD;
    const from = this.offsets[i]!;
    const to = this.offsets[i + 1]!;
    const species: string[] = [];
    for (let s = from; s < to; s++) {
      const name = this.species[this.view.getUint8(this.runsAt + s)];
      if (name) species.push(name);
    }
    return {
      id64: this.view.getBigUint64(o, true),
      name: this.nameAt(i),
      x: this.view.getFloat32(o + 8, true),
      y: this.view.getFloat32(o + 12, true),
      z: this.view.getFloat32(o + 16, true),
      regionId: this.view.getUint8(o + 20),
      species,
    };
  }

  /** Empty string on a v1 file, which carried no names — absent, not a wrong name. */
  private nameAt(i: number): string {
    const at = this.nameOffsets[i]!;
    if (at >= this.buf.length) return "";
    const len = this.view.getUint8(at);
    return this.buf.toString("utf8", at + 1, at + 1 + len);
  }

  /** Binary search — the file is written ascending by id64 precisely so this needs no index. */
  lookup(id64: bigint): BioIndexSystem | null {
    let lo = 0;
    let hi = this.systemCount - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const at = this.view.getBigUint64(this.tableAt + mid * RECORD, true);
      if (at === id64) return this.at(mid);
      if (at < id64) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  systemsWithAny(speciesIds: Iterable<string>): BioIndexSystem[] {
    const wanted = new Set<number>();
    for (const id of speciesIds) {
      const i = this.species.indexOf(id);
      if (i >= 0) wanted.add(i);
    }
    if (wanted.size === 0) return [];
    const out: BioIndexSystem[] = [];
    for (let i = 0; i < this.systemCount; i++) {
      const from = this.offsets[i]!;
      const to = this.offsets[i + 1]!;
      for (let s = from; s < to; s++) {
        if (wanted.has(this.view.getUint8(this.runsAt + s))) {
          out.push(this.at(i));
          break;
        }
      }
    }
    return out;
  }
}

export function bioIndexPath(projectRoot = getProjectRoot()): string {
  return path.join(projectRoot, "data", "galaxy", "bio-index.bin");
}

let cached: BioIndex | null | undefined;

/** The index, or null on a build without one. Read once and held. */
export function loadBioIndex(file = bioIndexPath()): BioIndex | null {
  if (cached !== undefined) return cached;
  if (!existsSync(file)) return (cached = null);
  try {
    cached = new Index(readFileSync(file));
  } catch (e) {
    console.warn(`ED Exo Compare — bio index unreadable, continuing without it: ${String(e)}`);
    cached = null;
  }
  return cached;
}

/** Test seam. */
export function clearBioIndexCache(): void {
  cached = undefined;
}
