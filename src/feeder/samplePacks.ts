/**
 * The per-species sample archive — step 4a's packed layout, sized by measurement.
 *
 * The corpus keeps one JSON file per sighting: `raw/planets/<slug>/sample_<occurrence>.json`,
 * 39,088 of them across 168 MB. §7.2 queued packing them on the grounds that "that many small files
 * is slow to walk on Windows". **That was an assumption, and measuring it says it is wrong** — a
 * full read of all 39,088 packs takes 6.4 s, and a whole-corpus rebuild takes under 15 s including
 * process start. Speed is not the problem and packing does not need to claim it is.
 *
 * What measuring *does* say:
 *
 * | | loose | packed |
 * |---|---|---|
 * | Bacterium Aurasus, 4,370 packs | 11.4 MB | **0.99 MB** (8.7 %) |
 * | whole planet corpus | 168 MB, 39,088 files | **~15 MB, 100 files** |
 *
 * So the archive is justified on **disk and file count**, which are real costs on the owner's
 * machine — backup, sync and virus scanning all walk file counts — and not on a speed claim that
 * does not survive a stopwatch.
 *
 * ## Why gzipped JSONL and not the columnar blob §7.2 sketched
 *
 * Tier 3 was specified as fixed-width Float32 rows, ~44 bytes each, on the assumption the app would
 * want to drill into raw bodies. **Nothing consumes it**: the encyclopedia histograms (B7) were
 * built from the tier-1 display histograms instead, and the app has never read a sample pack. A
 * columnar blob would also have to choose a fixed field set today and migrate it later, while the
 * contexts here are EDSM's own shape and change when EDSM does.
 *
 * JSONL keeps the record exactly as hydration wrote it, so packing is provably lossless — the
 * acceptance test is a full rebuild before and after producing identical profiles — and gzip gets
 * 91 % of the size back anyway. The blob can be built later from the archive if a consumer ever
 * appears; the archive cannot be rebuilt from a blob.
 *
 * ## What is not packed
 *
 * `raw/systems/` — 119 MB across 2,884 files. Those are read by **random access** (by cache file
 * name, one lookup per distinct system, on both the hydration and the rebuild path), so packing them
 * means either an offset index or holding the whole thing in memory, and 119 MB of JSON parses to
 * several hundred MB of objects. The planet packs have the opposite access pattern — whole-species
 * sequential — which is what makes them cheap to archive. 93 % of the file count is here anyway.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

/** One sighting as hydration wrote it, plus the occurrence index its filename carried. */
export interface SamplePackRecord {
  /** Occurrence index — the `N` in `sample_N.json`, and the resume unit hydration checkpoints on. */
  i: number;
  systemName?: string;
  bodyName?: string;
  speciesLabel?: string;
  systemCacheFile?: string;
  context?: unknown;
}

export const PACKED_SAMPLES_FILE = "samples.jsonl.gz";

const LOOSE_PREFIX = "sample_";
const LOOSE_SUFFIX = ".json";

export function packedSamplesPath(speciesDir: string): string {
  return join(speciesDir, PACKED_SAMPLES_FILE);
}

/** The occurrence index a loose pack's filename encodes, or null when the name is not one. */
export function looseSampleIndex(fileName: string): number | null {
  if (!fileName.startsWith(LOOSE_PREFIX) || !fileName.endsWith(LOOSE_SUFFIX)) return null;
  // Digits only, and at least one: `Number("")` is 0, which would make `sample_.json` occurrence 0
  // and let one malformed name shadow a real sighting.
  const digits = fileName.slice(LOOSE_PREFIX.length, -LOOSE_SUFFIX.length);
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

export function looseSampleName(index: number): string {
  return `${LOOSE_PREFIX}${index}${LOOSE_SUFFIX}`;
}

/**
 * Every record in a species' archive, keyed by occurrence index.
 *
 * Returns an empty map when there is no archive, so callers never branch on its existence — a
 * species mid-hydration and a species never packed look the same from here.
 */
export async function readPackedSamples(speciesDir: string): Promise<Map<number, SamplePackRecord>> {
  const out = new Map<number, SamplePackRecord>();
  let buf: Buffer;
  try {
    buf = await readFile(packedSamplesPath(speciesDir));
  } catch {
    return out;
  }
  const text = gunzipSync(buf).toString("utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as SamplePackRecord;
      if (Number.isInteger(rec?.i)) out.set(rec.i, rec);
    } catch {
      // One unreadable line is one lost sighting out of tens of thousands, and throwing here would
      // cost the whole species. The rebuild reports the count it actually read.
    }
  }
  return out;
}

/** Write the archive atomically — a half-written `.gz` would take a whole species with it. */
export async function writePackedSamples(
  speciesDir: string,
  records: Iterable<SamplePackRecord>,
): Promise<{ records: number; bytes: number }> {
  const sorted = [...records].sort((a, b) => a.i - b.i);
  const body = sorted.map((r) => JSON.stringify(r)).join("\n");
  const gz = gzipSync(Buffer.from(body, "utf8"), { level: 9 });
  const target = packedSamplesPath(speciesDir);
  const tmp = `${target}.${createHash("sha1").update(target).digest("hex").slice(0, 8)}.tmp`;
  await writeFile(tmp, gz);
  await rename(tmp, target);
  return { records: sorted.length, bytes: gz.length };
}

export interface PackResult {
  /** Records in the archive after packing. */
  records: number;
  /** Loose files folded in and deleted this run. */
  folded: number;
  /** Bytes the loose files occupied. */
  looseBytes: number;
  /** Bytes the archive occupies. */
  packedBytes: number;
}

/**
 * Fold a species' loose sample files into its archive and delete them.
 *
 * Loose wins on collision: a re-hydrated occurrence is newer than the archived one. Deletion happens
 * only after the archive is renamed into place, so an interrupted pack leaves the loose files intact
 * and is simply re-runnable.
 */
export async function packSpeciesSamples(speciesDir: string): Promise<PackResult> {
  let names: string[];
  try {
    names = await readdir(speciesDir);
  } catch {
    return { records: 0, folded: 0, looseBytes: 0, packedBytes: 0 };
  }

  const loose = names
    .map((n) => ({ name: n, i: looseSampleIndex(n) }))
    .filter((x): x is { name: string; i: number } => x.i !== null);

  const merged = await readPackedSamples(speciesDir);
  let looseBytes = 0;
  for (const { name, i } of loose) {
    try {
      const text = await readFile(join(speciesDir, name), "utf8");
      looseBytes += Buffer.byteLength(text);
      merged.set(i, { i, ...(JSON.parse(text) as Omit<SamplePackRecord, "i">) });
    } catch {
      // Unreadable loose file: leave it on disk rather than deleting evidence we could not parse.
    }
  }

  if (loose.length === 0) {
    return { records: merged.size, folded: 0, looseBytes: 0, packedBytes: 0 };
  }

  const written = await writePackedSamples(speciesDir, merged.values());
  let folded = 0;
  for (const { name, i } of loose) {
    if (!merged.has(i)) continue;
    try {
      await unlink(join(speciesDir, name));
      folded++;
    } catch {
      /* already gone */
    }
  }

  return { records: written.records, folded, looseBytes, packedBytes: written.bytes };
}
