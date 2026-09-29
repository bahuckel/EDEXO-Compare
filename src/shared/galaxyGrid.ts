/**
 * The galaxy map's tile grid (G1, docs/galaxy-plan-28092026.md): the game's own 1,280 ly sector
 * cubes (`SECTOR_ORIGIN` / `SECTOR_SIZE_LY`), shared by the server that cuts tiles and the client
 * that asks for them and hides overview points where a tile has landed.
 *
 * A tile stores positions as Int16 offsets inside its cube: 1,280 / 65,535 ≈ 0.02 ly per step, where
 * the whole-galaxy overview manages about 1.5. That difference is the reason tiles exist.
 */
import { SECTOR_ORIGIN, SECTOR_SIZE_LY } from "./sectorName.js";

export const TILE_SIZE_LY = SECTOR_SIZE_LY;
export const TILE_ORIGIN = SECTOR_ORIGIN;
/** Light years per Int16 step inside a tile. */
export const TILE_STEP_LY = TILE_SIZE_LY / 65535;

export interface CellCoord {
  cx: number;
  cy: number;
  cz: number;
}

export function cellOf(x: number, y: number, z: number): CellCoord {
  return {
    cx: Math.floor((x - TILE_ORIGIN.x) / TILE_SIZE_LY),
    cy: Math.floor((y - TILE_ORIGIN.y) / TILE_SIZE_LY),
    cz: Math.floor((z - TILE_ORIGIN.z) / TILE_SIZE_LY),
  };
}

/** The cube's lowest corner, in light years. */
export function cellMin(c: CellCoord): { x: number; y: number; z: number } {
  return {
    x: TILE_ORIGIN.x + c.cx * TILE_SIZE_LY,
    y: TILE_ORIGIN.y + c.cy * TILE_SIZE_LY,
    z: TILE_ORIGIN.z + c.cz * TILE_SIZE_LY,
  };
}

export function cellKey(c: CellCoord): string {
  return `${c.cx}:${c.cy}:${c.cz}`;
}

/** Int16 offset of a coordinate inside its cell (value = min + (q + 32768) × step). */
export function quantiseInCell(v: number, min: number): number {
  return Math.min(65535, Math.max(0, Math.round((v - min) / TILE_STEP_LY))) - 32768;
}

/**
 * The span of non-empty cells, for the client's "which cells are loaded" mask texture: one texel per
 * cell, laid out x across and (z, y) down — `width = dims.x`, `height = dims.z × dims.y`.
 */
export interface CellBounds {
  min: CellCoord;
  dims: { x: number; y: number; z: number };
}

export function maskTexel(b: CellBounds, c: CellCoord): { u: number; v: number } | null {
  const x = c.cx - b.min.cx;
  const y = c.cy - b.min.cy;
  const z = c.cz - b.min.cz;
  if (x < 0 || y < 0 || z < 0 || x >= b.dims.x || y >= b.dims.y || z >= b.dims.z) return null;
  return { u: x, v: y * b.dims.z + z };
}
