/**
 * Finding things on the 3D galaxy map by name (G4: the Classic map's "Find a sector" and region list,
 * grown to systems): sectors by the names the tile index gives its cells, the commander's own systems
 * from their journals, and any system in the galaxy index.
 *
 * The index holds 5.3 million names and no name index, so a system search is bounded: a procgen name
 * ("Eol Prou AA-A g2") names its sector, and only that sector's cells are read; anything else is a
 * scan that stops at the time budget and says so (`partial`).
 */
import type { TileIndex } from "./galaxyTiles.js";
import { sectorNames } from "./galaxyTiles.js";
import { systemSector } from "../shared/sectorName.js";
import type { GalaxyFindDTO, GalaxySectorDTO } from "../shared/dto/galaxy.js";
import type { GameStateStore } from "./gameState.js";

const MAX_SECTORS = 8;
const MAX_SYSTEMS = 12;
const BUDGET_MS = 350;

const packCell = (cx: number, cy: number, cz: number) => ((cx + 512) * 1024 + (cy + 512)) * 1024 + (cz + 512);

/** Sector columns by name: every height of a sector merged, as the map's groups are. */
function sectorColumns(t: TileIndex): Map<string, { name: string; cells: number[]; n: number; sx: number; sy: number; sz: number }> {
  const names = sectorNames(t);
  const out = new Map<string, { name: string; cells: number[]; n: number; sx: number; sy: number; sz: number }>();
  t.cells.forEach((c, i) => {
    const name = names[i];
    if (!name) return;
    const k = name.toLowerCase();
    let e = out.get(k);
    if (!e) out.set(k, (e = { name, cells: [], n: 0, sx: 0, sy: 0, sz: 0 }));
    const r = t.ranges.get(packCell(c.cx, c.cy, c.cz))!;
    const count = r[1] - r[0];
    e.cells.push(i);
    e.n += count;
    e.sx += t.centroids[i * 3]! * count;
    e.sy += t.centroids[i * 3 + 1]! * count;
    e.sz += t.centroids[i * 3 + 2]! * count;
  });
  return out;
}

/** Every index ordinal in one named sector (all its heights), for a boxel listing. */
export function sectorOrdinals(t: TileIndex, sectorName: string): number[] {
  const col = sectorColumns(t).get(sectorName.trim().toLowerCase());
  if (!col) return [];
  const out: number[] = [];
  for (const ci of col.cells) {
    const c = t.cells[ci]!;
    const r = t.ranges.get(packCell(c.cx, c.cy, c.cz))!;
    for (let j = r[0]; j < r[1]; j++) out.push(t.order[j]!);
  }
  return out;
}

export function galaxyFind(t: TileIndex, store: GameStateStore | null, query: string): GalaxyFindDTO {
  const q = query.trim().toLowerCase();
  const empty: GalaxyFindDTO = { query, sectors: [], systems: [], partial: false };
  if (q.length < 2) return empty;
  const cols = sectorColumns(t);

  // Sectors: starts-with before contains.
  const sectors = [...cols.values()]
    .filter((s) => s.name.toLowerCase().includes(q))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || b.n - a.n)
    .slice(0, MAX_SECTORS)
    .map((s) => ({ name: s.name, x: s.sx / s.n, y: s.sy / s.n, z: s.sz / s.n, systems: s.n }));

  const systems: GalaxyFindDTO["systems"] = [];
  const seen = new Set<string>();
  const push = (s: GalaxyFindDTO["systems"][number]) => {
    const k = s.name.toLowerCase();
    if (seen.has(k) || systems.length >= MAX_SYSTEMS) return;
    seen.add(k);
    systems.push(s);
  };

  // The commander's own systems first: those are the ones they are most likely looking for.
  if (store) {
    for (const [addr, name] of store.visitedSystems) {
      if (!name.toLowerCase().includes(q)) continue;
      const p = store.systemPositions.get(addr);
      if (p) push({ name, x: p.x, y: p.y, z: p.z, ordinal: null, addr: String(addr), mine: true });
    }
  }

  // The index: inside the named sector when the query names one, else a bounded scan.
  const index = t.index;
  const scanRange = (from: number, to: number, deadline: number): boolean => {
    for (let j = from; j < to; j++) {
      if (systems.length >= MAX_SYSTEMS) return true;
      if ((j & 1023) === 0 && performance.now() > deadline) return false;
      const i = t.order[j]!;
      const name = index.nameOf(i);
      if (!name.toLowerCase().includes(q)) continue;
      const [x, y, z] = index.pointAt(i);
      push({ name, x, y, z, ordinal: i, addr: null, mine: false });
    }
    return true;
  };
  const deadline = performance.now() + BUDGET_MS;
  const named = systemSector(query.trim())?.toLowerCase() ?? (cols.has(q) ? q : [...cols.keys()].find((k) => q.startsWith(`${k} `)));
  let complete = true;
  if (named && cols.has(named)) {
    for (const ci of cols.get(named)!.cells) {
      const c = t.cells[ci]!;
      const r = t.ranges.get(packCell(c.cx, c.cy, c.cz))!;
      if (!scanRange(r[0], r[1], deadline)) {
        complete = false;
        break;
      }
    }
  } else if (systems.length < MAX_SYSTEMS) {
    complete = scanRange(0, t.order.length, deadline);
  }
  return { query, sectors, systems, partial: !complete };
}

/** One sector column: its size and most valuable systems (the ring's panel). */
export function galaxySector(t: TileIndex, cx: number, cz: number, limit = 15): GalaxySectorDTO | null {
  const names = sectorNames(t);
  const members = t.cells.map((c, i) => ({ c, i })).filter(({ c }) => c.cx === cx && c.cz === cz);
  if (!members.length) return null;
  let total = 0;
  const best: { i: number; v: number; sp: number }[] = [];
  for (const { c } of members) {
    const r = t.ranges.get(packCell(c.cx, c.cy, c.cz))!;
    total += r[1] - r[0];
    for (let j = r[0]; j < r[1]; j++) {
      const i = t.order[j]!;
      const v = t.values[i]!;
      if (best.length < limit || v > best[best.length - 1]!.v) {
        best.push({ i, v, sp: t.index.pointAt(i)[4] });
        best.sort((a, b) => b.v - a.v || b.sp - a.sp);
        if (best.length > limit) best.pop();
      }
    }
  }
  // The column's name: its most populous member's.
  const sizeOf = (c: { cx: number; cy: number; cz: number }) => {
    const r = t.ranges.get(packCell(c.cx, c.cy, c.cz))!;
    return r[1] - r[0];
  };
  const named = members
    .map(({ c, i }) => ({ name: names[i] ?? "", n: sizeOf(c) }))
    .filter((m) => m.name)
    .sort((a, b) => b.n - a.n)[0];
  return {
    name: named?.name ?? null,
    systems: total,
    top: best.map((b) => {
      const [x, y, z] = t.index.pointAt(b.i);
      return { ordinal: b.i, name: t.index.nameOf(b.i), valueCr: b.v * 100_000, species: b.sp, x, y, z };
    }),
  };
}
