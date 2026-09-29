/**
 * The galaxy map's close-up data (G1): the bio index cut into the game's 1,280 ly sector cubes, one
 * binary tile per cube, positions to 0.02 ly. The overview buffer (galaxyPoints.ts) carries every
 * system at ~1.5 ly, which is fine from afar and visibly snaps systems together close up.
 *
 * Built lazily the first time a tile or the cell list is asked for, and released with the rest of the
 * map's memory when the map has been idle (galaxyMemory.ts). It holds only the grouping — one u32 per
 * system and a range per cell, ~21 MB — and reads positions back out of the index per tile.
 *
 * Cell list (`/api/galaxy/cells`), little endian:
 *   0  "EDXCEL01"     8
 *   8  count          u32
 *   12 min cx, cy, cz i16 × 3     bounds of the non-empty cells (for the client's mask texture)
 *   18 dims x, y, z   u16 × 3
 *   24 per cell (28 bytes): cx, cy, cz i16 × 3, pad u16, systems u32, centroid x, y, z f32 × 3 (ly),
 *      top value u16 (100,000 CR units), pad u16
 *
 * Tile (`/api/galaxy/tile?c=cx:cy:cz`):
 *   0  "EDXTIL01"     8
 *   8  cx, cy, cz     i16 × 3
 *   14 pad            u16
 *   16 count          u32
 *   20 pad            u32
 *   24 positions      i16 × 3 × count   (quantiseInCell against cellMin)
 *   .. pad to 4
 *   .. tiers          u8 × count
 *   .. species count  u8 × count
 *   .. pad to 4
 *   .. value          u16 × count      (1× recorded value, 100,000 CR units)
 *   .. pad to 4
 *   .. system ordinal u32 × count      (index into the bio index: picking, names, the detail panel)
 */
import { loadBioIndex, type BioIndex } from "./bioIndex.js";
import { galaxySystemValues } from "./galaxyValueSearch.js";
import { systemSector } from "../shared/sectorName.js";
import { cellMin, quantiseInCell, TILE_ORIGIN, TILE_SIZE_LY, type CellCoord } from "../shared/galaxyGrid.js";

export const CELLS_MAGIC = "EDXCEL01";
export const TILE_MAGIC = "EDXTIL01";

/** Cell coordinates packed into one integer: each axis offset by 512 into 10 bits. */
const packCell = (cx: number, cy: number, cz: number) => ((cx + 512) * 1024 + (cy + 512)) * 1024 + (cz + 512);
const unpackCell = (id: number): CellCoord => ({
  cx: Math.floor(id / 1048576) - 512,
  cy: (Math.floor(id / 1024) % 1024) - 512,
  cz: (id % 1024) - 512,
});

export interface TileIndex {
  index: BioIndex;
  cells: CellCoord[];
  /** Packed cell → [start, end) into `order`. */
  ranges: Map<number, [number, number]>;
  /** System ordinals grouped by cell. */
  order: Uint32Array;
  /** Per system, 100,000 CR units (zeros when built without prices). */
  values: Uint16Array;
  /** Per cell, same order as `cells`: centroid (ly) and top value. */
  centroids: Float32Array;
  topValue: Uint16Array;
  sectorNames?: string[];
}

const align4 = (n: number) => (n + 3) & ~3;

export function buildTileIndex(index: BioIndex, values: Uint16Array = new Uint16Array(index.systemCount)): TileIndex {
  const n = index.systemCount;
  const cellOfSystem = new Float64Array(n);
  // One pass: which cell, and per cell the count, the coordinate sums and the best value.
  const acc = new Map<number, { n: number; sx: number; sy: number; sz: number; top: number }>();
  index.forEachPoint((i, x, y, z) => {
    const id = packCell(
      Math.floor((x - TILE_ORIGIN.x) / TILE_SIZE_LY),
      Math.floor((y - TILE_ORIGIN.y) / TILE_SIZE_LY),
      Math.floor((z - TILE_ORIGIN.z) / TILE_SIZE_LY),
    );
    cellOfSystem[i] = id;
    let a = acc.get(id);
    if (!a) acc.set(id, (a = { n: 0, sx: 0, sy: 0, sz: 0, top: 0 }));
    a.n++;
    a.sx += x;
    a.sy += y;
    a.sz += z;
    if (values[i]! > a.top) a.top = values[i]!;
  });
  const ranges = new Map<number, [number, number]>();
  const cursor = new Map<number, number>();
  const cells: CellCoord[] = [];
  // Where each cell's systems actually are, and its best one: the far-zoom groups (G2).
  const centroids = new Float32Array(acc.size * 3);
  const topValue = new Uint16Array(acc.size);
  let at = 0;
  for (const [id, a] of acc) {
    const k = cells.length;
    ranges.set(id, [at, at + a.n]);
    cursor.set(id, at);
    cells.push(unpackCell(id));
    centroids[k * 3] = a.sx / a.n;
    centroids[k * 3 + 1] = a.sy / a.n;
    centroids[k * 3 + 2] = a.sz / a.n;
    topValue[k] = a.top;
    at += a.n;
  }
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const id = cellOfSystem[i]!;
    const p = cursor.get(id)!;
    order[p] = i;
    cursor.set(id, p + 1);
  }
  return { index, cells, ranges, order, values, centroids, topValue };
}

/**
 * Each cell's sector name, same order as the cell list: the most common procgen prefix among up to
 * 40 of its systems (a cube can straddle two named sectors; the majority names it). Empty where no
 * system there has a procgen name. Built on first use and kept with the tile index.
 */
export function sectorNames(t: TileIndex): string[] {
  if (t.sectorNames) return t.sectorNames;
  t.sectorNames = t.cells.map((c) => {
    const [from, to] = t.ranges.get(packCell(c.cx, c.cy, c.cz))!;
    const counts = new Map<string, number>();
    const stepBy = Math.max(1, Math.floor((to - from) / 40));
    for (let j = from; j < to; j += stepBy) {
      const sector = systemSector(t.index.nameOf(t.order[j]!));
      if (sector) counts.set(sector, (counts.get(sector) ?? 0) + 1);
    }
    let best = "";
    let bestN = 0;
    for (const [name, k] of counts) if (k > bestN) [best, bestN] = [name, k];
    return best;
  });
  return t.sectorNames;
}

export function encodeCells(t: TileIndex): Buffer {
  const cells = t.cells;
  const min = { cx: Infinity, cy: Infinity, cz: Infinity };
  const max = { cx: -Infinity, cy: -Infinity, cz: -Infinity };
  for (const c of cells) {
    min.cx = Math.min(min.cx, c.cx);
    min.cy = Math.min(min.cy, c.cy);
    min.cz = Math.min(min.cz, c.cz);
    max.cx = Math.max(max.cx, c.cx);
    max.cy = Math.max(max.cy, c.cy);
    max.cz = Math.max(max.cz, c.cz);
  }
  if (!cells.length) {
    Object.assign(min, { cx: 0, cy: 0, cz: 0 });
    Object.assign(max, { cx: -1, cy: -1, cz: -1 });
  }
  const buf = Buffer.alloc(24 + cells.length * 28);
  buf.write(CELLS_MAGIC, 0, "ascii");
  buf.writeUInt32LE(cells.length, 8);
  buf.writeInt16LE(min.cx, 12);
  buf.writeInt16LE(min.cy, 14);
  buf.writeInt16LE(min.cz, 16);
  buf.writeUInt16LE(max.cx - min.cx + 1, 18);
  buf.writeUInt16LE(max.cy - min.cy + 1, 20);
  buf.writeUInt16LE(max.cz - min.cz + 1, 22);
  cells.forEach((c, i) => {
    const o = 24 + i * 28;
    buf.writeInt16LE(c.cx, o);
    buf.writeInt16LE(c.cy, o + 2);
    buf.writeInt16LE(c.cz, o + 4);
    const r = t.ranges.get(packCell(c.cx, c.cy, c.cz))!;
    buf.writeUInt32LE(r[1] - r[0], o + 8);
    buf.writeFloatLE(t.centroids[i * 3]!, o + 12);
    buf.writeFloatLE(t.centroids[i * 3 + 1]!, o + 16);
    buf.writeFloatLE(t.centroids[i * 3 + 2]!, o + 20);
    buf.writeUInt16LE(t.topValue[i]!, o + 24);
  });
  return buf;
}

/** One cell's tile, or null when the cell holds no system. */
export function encodeTile(t: TileIndex, c: CellCoord): Buffer | null {
  const r = t.ranges.get(packCell(c.cx, c.cy, c.cz));
  if (!r) return null;
  const count = r[1] - r[0];
  const posAt = 24;
  const tiersAt = align4(posAt + count * 6);
  const speciesAt = tiersAt + count;
  const valuesAt = align4(speciesAt + count);
  const ordAt = align4(valuesAt + count * 2);
  const buf = Buffer.alloc(ordAt + count * 4);
  buf.write(TILE_MAGIC, 0, "ascii");
  buf.writeInt16LE(c.cx, 8);
  buf.writeInt16LE(c.cy, 10);
  buf.writeInt16LE(c.cz, 12);
  buf.writeUInt32LE(count, 16);
  const m = cellMin(c);
  for (let j = 0; j < count; j++) {
    const i = t.order[r[0] + j]!;
    const [x, y, z, tiers, species] = t.index.pointAt(i);
    buf.writeInt16LE(quantiseInCell(x, m.x), posAt + j * 6);
    buf.writeInt16LE(quantiseInCell(y, m.y), posAt + j * 6 + 2);
    buf.writeInt16LE(quantiseInCell(z, m.z), posAt + j * 6 + 4);
    buf[tiersAt + j] = tiers;
    buf[speciesAt + j] = species;
    buf.writeUInt16LE(t.values[i]!, valuesAt + j * 2);
    buf.writeUInt32LE(i, ordAt + j * 4);
  }
  return buf;
}

let cached: TileIndex | null | undefined;

export function tileIndex(): TileIndex | null {
  if (cached !== undefined) return cached;
  const index = loadBioIndex();
  cached = index ? buildTileIndex(index, galaxySystemValues(index)) : null;
  return cached;
}

export function clearTileIndex(): void {
  cached = undefined;
}

/** `cx:cy:cz` → a cell, or null for anything else. */
export function parseCellParam(v: unknown): CellCoord | null {
  if (typeof v !== "string") return null;
  const m = /^(-?\d{1,3}):(-?\d{1,3}):(-?\d{1,3})$/.exec(v);
  if (!m) return null;
  const c = { cx: Number(m[1]), cy: Number(m[2]), cz: Number(m[3]) };
  return Math.abs(c.cx) < 512 && Math.abs(c.cy) < 512 && Math.abs(c.cz) < 512 ? c : null;
}
