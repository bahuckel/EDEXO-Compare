/**
 * Region outlines and label anchors from the vendored region map, for the 3D galaxy map (G1).
 *
 * The map is 2048 × 2048 run-length rows of ~49 ly pixels (`regionMap.ts`). A border is every pixel
 * edge where the region changes, including the edge of the galaxy (region 0 against a named one).
 * Edges are merged along their row or column, so a straight stretch is one segment, not forty.
 *
 * Output is in galactic light years on the plane: x and z, y = 0 left to the renderer.
 */
import { REGION_MAP_LY_PER_PIXEL, REGION_MAP_X0, REGION_MAP_Z0, type RegionMapData } from "./regionMap.js";

export interface RegionOutlines {
  /** x1, z1, x2, z2 per segment. */
  segments: Float32Array;
  /** One anchor per named region: a pixel of the region near its centroid, in ly. */
  anchors: { index: number; name: string; x: number; z: number; pixels: number }[];
}

/** Decode the rows into one byte per pixel, rows by pz. */
export function decodeRegionGrid(data: RegionMapData, size = 2048): Uint8Array {
  const grid = new Uint8Array(size * size);
  data.regionmap.forEach((row, pz) => {
    if (pz >= size) return;
    let px = 0;
    for (const [len, region] of row) {
      const end = Math.min(px + len, size);
      if (region) grid.fill(region, pz * size + px, pz * size + end);
      px = end;
      if (px >= size) break;
    }
  });
  return grid;
}

export function regionOutlines(data: RegionMapData, size = 2048): RegionOutlines {
  const g = decodeRegionGrid(data, size);
  const L = REGION_MAP_LY_PER_PIXEL;
  const X = (px: number) => REGION_MAP_X0 + px * L;
  const Z = (pz: number) => REGION_MAP_Z0 + pz * L;
  const out: number[] = [];
  const at = (px: number, pz: number) => (px < 0 || pz < 0 || px >= size || pz >= size ? 0 : g[pz * size + px]!);

  // Horizontal edges: between row pz-1 and pz, along x.
  for (let pz = 0; pz <= size; pz++) {
    let start = -1;
    for (let px = 0; px <= size; px++) {
      const edge = px < size && at(px, pz - 1) !== at(px, pz);
      if (edge && start < 0) start = px;
      if (!edge && start >= 0) {
        out.push(X(start), Z(pz), X(px), Z(pz));
        start = -1;
      }
    }
  }
  // Vertical edges: between column px-1 and px, along z.
  for (let px = 0; px <= size; px++) {
    let start = -1;
    for (let pz = 0; pz <= size; pz++) {
      const edge = pz < size && at(px - 1, pz) !== at(px, pz);
      if (edge && start < 0) start = pz;
      if (!edge && start >= 0) {
        out.push(X(px), Z(start), X(px), Z(pz));
        start = -1;
      }
    }
  }

  // Anchors: the centroid, moved to the region's own pixel nearest to it (a crescent's centroid can
  // sit outside it).
  const sums = new Map<number, { sx: number; sz: number; n: number }>();
  for (let pz = 0; pz < size; pz++) {
    for (let px = 0; px < size; px++) {
      const r = g[pz * size + px]!;
      if (!r) continue;
      const s = sums.get(r) ?? { sx: 0, sz: 0, n: 0 };
      s.sx += px;
      s.sz += pz;
      s.n++;
      sums.set(r, s);
    }
  }
  const anchors: RegionOutlines["anchors"] = [];
  for (const [index, s] of sums) {
    const cx = s.sx / s.n;
    const cz = s.sz / s.n;
    let best = { px: Math.round(cx), pz: Math.round(cz) };
    if (at(best.px, best.pz) !== index) {
      let bestD = Infinity;
      // Nearest own pixel within an expanding square; regions are big, this ends quickly.
      for (let r = 1; r < size && bestD === Infinity; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const px = best.px + dx;
            const pz = best.pz + dz;
            if (at(px, pz) !== index) continue;
            const d = dx * dx + dz * dz;
            if (d < bestD) {
              bestD = d;
              best = { px, pz };
            }
          }
        }
      }
    }
    const name = data.regions[index];
    if (name) anchors.push({ index, name, x: X(best.px + 0.5), z: Z(best.pz + 0.5), pixels: s.n });
  }
  anchors.sort((a, b) => b.pixels - a.pixels);
  return { segments: new Float32Array(out), anchors };
}
