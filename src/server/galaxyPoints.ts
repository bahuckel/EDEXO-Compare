/**
 * Every system in the bio index as one binary buffer: the galaxy map's overview (G0/G1, owner
 * 2026-09-28: docs/galaxy-plan-28092026.md).
 *
 * The SVG map drew 241 sector circles; the index holds 5.3 million systems with coordinates. A GPU
 * draws that many points without effort, but not from JSON: 5.3 M objects would be a gigabyte on
 * either side. So positions travel as Int16 quantised over the index's own bounding box (about
 * 1.5 ly per step across the whole galaxy — plenty from afar; close up the map switches to tiles,
 * galaxyTiles.ts) and two bytes of summary per system.
 *
 * `stride` keeps every Nth system: the light overview for a machine rendering WebGL in software,
 * where 5.3 M points cost ~300 ms a frame (G0).
 *
 * Layout (little endian, every array aligned to its element size):
 *
 *   0   "EDXPTS01"                 8 bytes
 *   8   count                      u32
 *   12  min x, min y, min z        f32 × 3   (ly)
 *   24  step x, step y, step z     f32 × 3   (ly per Int16 step; value = min + (q + 32768) × step)
 *   36  stride                     u32
 *   40  positions                  i16 × 3 × count
 *   ..  tiers                      u8 × count   (TIER_* flags from bioIndex.ts)
 *   ..  species count              u8 × count
 *   ..  pad to 2
 *   ..  value                      u16 × count  (1× recorded value in 100,000 CR units; galaxyValueSearch.ts)
 */
import { loadBioIndex, loadBioIndexAsync, type BioIndex } from "./bioIndex.js";
import { galaxySystemValues } from "./galaxyValueSearch.js";
import { SLICE, runSliced, runSync } from "./sliced.js";

export const POINTS_MAGIC = "EDXPTS01";
export const POINTS_HEADER = 40;

export function buildGalaxyPoints(index: BioIndex, stride = 1, values?: Uint16Array): Buffer {
  return runSync(pointsSteps(index, stride, values));
}

/** Each pass over the index a slice at a time where the index allows it (sliced.ts). */
function* eachPoint(
  index: BioIndex,
  cb: (i: number, x: number, y: number, z: number, tiers: number, speciesCount: number) => void,
): Generator<void, void> {
  if (!index.forEachPointIn) return void index.forEachPoint(cb);
  for (let from = 0; from < index.systemCount; from += SLICE) {
    index.forEachPointIn(from, from + SLICE, cb);
    yield;
  }
}

function* pointsSteps(index: BioIndex, stride: number, values?: Uint16Array): Generator<void, Buffer> {
  const total = index.systemCount;
  const s = Math.max(1, Math.floor(stride));
  const n = Math.ceil(total / s);
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  yield* eachPoint(index, (_i, x, y, z) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  });
  if (total === 0) minX = minY = minZ = maxX = maxY = maxZ = 0;
  const step = (lo: number, hi: number) => Math.max((hi - lo) / 65535, 1e-6);
  const sx = step(minX, maxX);
  const sy = step(minY, maxY);
  const sz = step(minZ, maxZ);

  const valuesAt = POINTS_HEADER + n * 8 + ((n * 8) % 2);
  const buf = Buffer.alloc(valuesAt + n * 2);
  buf.write(POINTS_MAGIC, 0, "ascii");
  buf.writeUInt32LE(n, 8);
  buf.writeFloatLE(minX, 12);
  buf.writeFloatLE(minY, 16);
  buf.writeFloatLE(minZ, 20);
  buf.writeFloatLE(sx, 24);
  buf.writeFloatLE(sy, 28);
  buf.writeFloatLE(sz, 32);
  buf.writeUInt32LE(s, 36);
  const pos = new Int16Array(buf.buffer, buf.byteOffset + POINTS_HEADER, n * 3);
  const tiers = new Uint8Array(buf.buffer, buf.byteOffset + POINTS_HEADER + n * 6, n);
  const species = new Uint8Array(buf.buffer, buf.byteOffset + POINTS_HEADER + n * 7, n);
  const value = new Uint16Array(buf.buffer, buf.byteOffset + valuesAt, n);
  const q = (v: number, lo: number, st: number) => Math.min(65535, Math.max(0, Math.round((v - lo) / st))) - 32768;
  yield* eachPoint(index, (i, x, y, z, t, c) => {
    if (i % s) return;
    const k = i / s;
    pos[k * 3] = q(x, minX, sx);
    pos[k * 3 + 1] = q(y, minY, sy);
    pos[k * 3 + 2] = q(z, minZ, sz);
    tiers[k] = t;
    species[k] = c;
    value[k] = values?.[i] ?? 0;
  });
  return buf;
}

const cached = new Map<number, Buffer | null>();

/** Built once per stride from the index and held until the map goes idle; null without an index. */
export function galaxyPoints(stride = 1): Buffer | null {
  if (cached.has(stride)) return cached.get(stride)!;
  const index = loadBioIndex();
  const buf = index ? buildGalaxyPoints(index, stride, galaxySystemValues(index)) : null;
  cached.set(stride, buf);
  return buf;
}

const pending = new Map<number, Promise<Buffer | null>>();

/**
 * The same, built in slices with the index read off the main thread (owner, 2026-10-07: the app went
 * "Not responding" for a moment as the map loaded; this was a third of a second of it).
 */
export function galaxyPointsAsync(stride = 1): Promise<Buffer | null> {
  if (cached.has(stride)) return Promise.resolve(cached.get(stride)!);
  const was = pending.get(stride);
  if (was) return was;
  const p = (async () => {
    const index = await loadBioIndexAsync();
    const buf = index ? await runSliced(pointsSteps(index, stride, galaxySystemValues(index))) : null;
    if (!cached.has(stride)) cached.set(stride, buf);
    return cached.get(stride)!;
  })().finally(() => pending.delete(stride));
  pending.set(stride, p);
  return p;
}

export function clearGalaxyPoints(): void {
  cached.clear();
}
