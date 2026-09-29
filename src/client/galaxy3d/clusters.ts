/**
 * Groups of nearby systems for the 3D map (G2; his words: grouping by region, by sector and by "close
 * to each other dots" stays).
 *
 * The groups sit on **fixed grids on the galactic plane** — columns of the game's 1,280 ly sector
 * cubes, then 320 ly and 80 ly subdivisions of them — and the camera's distance picks the grid. A group is always the same
 * group at a given zoom, so nothing jumps around as you zoom, which is why the SVG map had refused
 * proximity grouping (galaxyLod.ts). Each group draws at the centre of its own systems, not of its
 * cube, so the map does not look like graph paper.
 */
import { cellMin, TILE_STEP_LY, type CellCoord } from "../../shared/galaxyGrid";

/** 0 = no groups at this distance. */
export type ClusterLevel = 0 | 1280 | 320 | 80;

export interface Cluster {
  key: string;
  /** Game coordinates of the systems' centroid, ly. */
  x: number;
  y: number;
  z: number;
  count: number;
  /** Best system's value, 100,000 CR units. */
  top: number;
}

/**
 * Which grid, from the camera's distance to its target:
 * far (> 45 k ly) the regions speak for themselves; then sectors; then 320 ly; then 80 ly; and inside
 * 800 ly the systems themselves are few enough on screen to read one by one.
 */
export function levelForDistance(d: number): ClusterLevel {
  if (d > 45_000) return 0;
  if (d > 14_000) return 1280;
  if (d > 3_500) return 320;
  if (d > 800) return 80;
  return 0;
}

/** Where to put the camera to see inside a group at this level: close enough for the next grid. */
export function distanceToOpen(level: ClusterLevel): number {
  return level === 1280 ? 9_000 : level === 320 ? 2_400 : level === 80 ? 600 : 30_000;
}

/**
 * Bucket one tile's systems into columns of `size` × `size` ly on the galactic plane inside its
 * 1,280 ly cube — every height together. Stacked cubes drew as one ring per layer, which from above
 * piled up into a starburst (first G2 screenshots); a group is a place on the map, not a voxel.
 */
export function clustersFromTile(
  cell: CellCoord,
  positions: Int16Array,
  values: Uint16Array,
  size: 320 | 80,
): Cluster[] {
  const m = cellMin(cell);
  const per = 1280 / size;
  const acc = new Map<number, { n: number; sx: number; sy: number; sz: number; top: number }>();
  const count = positions.length / 3;
  for (let j = 0; j < count; j++) {
    const x = m.x + (positions[j * 3]! + 32768) * TILE_STEP_LY;
    const y = m.y + (positions[j * 3 + 1]! + 32768) * TILE_STEP_LY;
    const z = m.z + (positions[j * 3 + 2]! + 32768) * TILE_STEP_LY;
    const bx = Math.min(per - 1, Math.floor((x - m.x) / size));
    const bz = Math.min(per - 1, Math.floor((z - m.z) / size));
    const id = bx * per + bz;
    let a = acc.get(id);
    if (!a) acc.set(id, (a = { n: 0, sx: 0, sy: 0, sz: 0, top: 0 }));
    a.n++;
    a.sx += x;
    a.sy += y;
    a.sz += z;
    if (values[j]! > a.top) a.top = values[j]!;
  }
  const out: Cluster[] = [];
  for (const [id, a] of acc) {
    out.push({
      // No cy: tiles stacked in height fall into the same column and are merged (mergeColumns).
      key: `${cell.cx}:${cell.cz}/${size}/${id}`,
      x: a.sx / a.n,
      y: a.sy / a.n,
      z: a.sz / a.n,
      count: a.n,
      top: a.top,
    });
  }
  return out;
}

/** 7 → "7", 1234 → "1.2k", 45 678 → "46k", 1 234 567 → "1.2M". */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** Credits from the 100,000 CR units the map carries: "480k", "12.5M", "1.1bn". */
export function formatValue(units: number): string {
  const cr = units * 100_000;
  if (cr <= 0) return "—";
  if (cr < 1_000_000) return `${Math.round(cr / 1000)}k CR`;
  if (cr < 1_000_000_000) return `${(cr / 1_000_000).toFixed(1).replace(/\.0$/, "")}M CR`;
  return `${(cr / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}bn CR`;
}

/**
 * Merge groups that share a column (the 1,280 ly level: sector cubes stacked in height) into one,
 * weighting the centroid by count; the name is the most populous member's.
 */
export function mergeColumns<T extends Cluster & { name: string | null }>(groups: readonly T[], keyOf: (g: T) => string): (Cluster & { name: string | null })[] {
  const acc = new Map<string, { n: number; sx: number; sy: number; sz: number; top: number; name: string | null; nameN: number }>();
  for (const g of groups) {
    const k = keyOf(g);
    let a = acc.get(k);
    if (!a) acc.set(k, (a = { n: 0, sx: 0, sy: 0, sz: 0, top: 0, name: null, nameN: 0 }));
    a.n += g.count;
    a.sx += g.x * g.count;
    a.sy += g.y * g.count;
    a.sz += g.z * g.count;
    if (g.top > a.top) a.top = g.top;
    if (g.name && g.count > a.nameN) [a.name, a.nameN] = [g.name, g.count];
  }
  return [...acc].map(([key, a]) => ({ key, x: a.sx / a.n, y: a.sy / a.n, z: a.sz / a.n, count: a.n, top: a.top, name: a.name }));
}

/**
 * Which groups get a ring, up to `max`, never touching another.
 *
 * Not simply the biggest on screen: ranked by size alone, a dense corner of the view took every ring
 * and the sparse region the commander had zoomed into showed none — only its neighbours (his report,
 * 2026-09-29, Norma Expanse). So the screen is split into a grid and each part first gets its own best
 * group, parts nearest the middle of the view first (that is where he is looking); only then do the
 * biggest (or, colouring by value, the richest) fill what room is left.
 */
export function chooseShown<T extends { sx: number; sy: number; count: number; top: number }>(
  groups: readonly T[],
  viewport: { width: number; height: number },
  max: number,
  byValue: boolean,
  radiusOf: (g: T) => number,
): T[] {
  const { width: w, height: h } = viewport;
  const on = groups.filter((g) => g.sx > 0 && g.sy > 0 && g.sx < w && g.sy < h);
  const better = (a: T, b: T) => (byValue ? b.top - a.top || b.count - a.count : b.count - a.count);
  on.sort(better);

  const cols = Math.max(1, Math.round(w / 260));
  const rows = Math.max(1, Math.round(h / 220));
  const bestInCell = new Map<number, T>();
  for (const g of on) {
    const k = Math.min(rows - 1, Math.floor((g.sy / h) * rows)) * cols + Math.min(cols - 1, Math.floor((g.sx / w) * cols));
    if (!bestInCell.has(k)) bestInCell.set(k, g); // `on` is sorted, so the first seen is the best
  }
  const fromCentre = (g: T) => Math.hypot(g.sx - w / 2, g.sy - h / 2);
  const firstRound = [...bestInCell.values()].sort((a, b) => fromCentre(a) - fromCentre(b));
  const firstSet = new Set(firstRound);

  const out: T[] = [];
  const tryAdd = (g: T) => {
    if (out.length >= max) return;
    const r = radiusOf(g);
    // Room for the ring and the count under it.
    if (out.some((o) => Math.hypot(o.sx - g.sx, o.sy - g.sy) < r + radiusOf(o) + 26)) return;
    out.push(g);
  };
  for (const g of firstRound) tryAdd(g);
  for (const g of on) if (!firstSet.has(g)) tryAdd(g);
  return out;
}
