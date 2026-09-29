/**
 * Readers for the three binary payloads the 3D map loads (layouts documented on the server side:
 * galaxyPoints.ts, galaxyTiles.ts). They return typed-array views over the fetched buffer, no copies.
 */
import type { CellBounds, CellCoord } from "../../shared/galaxyGrid";

const magic = (ab: ArrayBuffer, want: string) => {
  const got = String.fromCharCode(...new Uint8Array(ab, 0, 8));
  if (got !== want) throw new Error(`expected ${want}, got ${JSON.stringify(got)}`);
};
const align4 = (n: number) => (n + 3) & ~3;

export interface OverviewPoints {
  count: number;
  min: [number, number, number];
  step: [number, number, number];
  stride: number;
  positions: Int16Array;
  tiers: Uint8Array;
  species: Uint8Array;
  /** 1× recorded value, 100,000 CR units. */
  values: Uint16Array;
}

export function readOverview(ab: ArrayBuffer): OverviewPoints {
  magic(ab, "EDXPTS01");
  const v = new DataView(ab);
  const n = v.getUint32(8, true);
  return {
    count: n,
    min: [v.getFloat32(12, true), v.getFloat32(16, true), v.getFloat32(20, true)],
    step: [v.getFloat32(24, true), v.getFloat32(28, true), v.getFloat32(32, true)],
    stride: v.getUint32(36, true) || 1,
    positions: new Int16Array(ab, 40, n * 3),
    tiers: new Uint8Array(ab, 40 + n * 6, n),
    species: new Uint8Array(ab, 40 + n * 7, n),
    values: new Uint16Array(ab, 40 + n * 8, n),
  };
}

export interface CellList {
  bounds: CellBounds;
  cells: (CellCoord & { systems: number; x: number; y: number; z: number; topValue: number })[];
}

export function readCells(ab: ArrayBuffer): CellList {
  magic(ab, "EDXCEL01");
  const v = new DataView(ab);
  const n = v.getUint32(8, true);
  const cells: CellList["cells"] = [];
  for (let i = 0; i < n; i++) {
    const o = 24 + i * 28;
    cells.push({
      cx: v.getInt16(o, true),
      cy: v.getInt16(o + 2, true),
      cz: v.getInt16(o + 4, true),
      systems: v.getUint32(o + 8, true),
      x: v.getFloat32(o + 12, true),
      y: v.getFloat32(o + 16, true),
      z: v.getFloat32(o + 20, true),
      topValue: v.getUint16(o + 24, true),
    });
  }
  return {
    bounds: {
      min: { cx: v.getInt16(12, true), cy: v.getInt16(14, true), cz: v.getInt16(16, true) },
      dims: { x: v.getUint16(18, true), y: v.getUint16(20, true), z: v.getUint16(22, true) },
    },
    cells,
  };
}

export interface Tile {
  cell: CellCoord;
  count: number;
  positions: Int16Array;
  tiers: Uint8Array;
  species: Uint8Array;
  values: Uint16Array;
  ordinals: Uint32Array;
}

export function readTile(ab: ArrayBuffer): Tile {
  magic(ab, "EDXTIL01");
  const v = new DataView(ab);
  const count = v.getUint32(16, true);
  const tiersAt = align4(24 + count * 6);
  const speciesAt = tiersAt + count;
  const valuesAt = align4(speciesAt + count);
  const ordAt = align4(valuesAt + count * 2);
  return {
    cell: { cx: v.getInt16(8, true), cy: v.getInt16(10, true), cz: v.getInt16(12, true) },
    count,
    positions: new Int16Array(ab, 24, count * 3),
    tiers: new Uint8Array(ab, tiersAt, count),
    species: new Uint8Array(ab, speciesAt, count),
    values: new Uint16Array(ab, valuesAt, count),
    ordinals: new Uint32Array(ab, ordAt, count),
  };
}
