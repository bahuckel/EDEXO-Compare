/**
 * The shipped region map, loaded once.
 *
 * `data/exomastery/region-map.json` is 182 kB and read at most once per process, the same
 * arrangement as `spatial-catalogue.json` and `species-prevalence.json`. The lookup itself lives in
 * {@link ../shared/regionMap.js} so the client can use it against the same data.
 *
 * A missing file is not an error. Every region answer then comes back null, which reads as "we
 * cannot tell" rather than "this system is nowhere" — the same failure mode the spatial catalogue
 * chose, and the only safe one for a file a build might not have produced.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { regionForCoords, regionIndexForCoords, type RegionMapData } from "../shared/regionMap.js";

let cached: RegionMapData | null | undefined;

export function regionMapPath(projectRoot: string): string {
  return path.join(projectRoot, "data", "exomastery", "region-map.json");
}

export function loadRegionMap(projectRoot: string): RegionMapData | null {
  if (cached !== undefined) return cached;
  const file = regionMapPath(projectRoot);
  if (!existsSync(file)) {
    cached = null;
    return cached;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as RegionMapData;
    // A truncated or half-written file must read as absent, not as a map of mostly-nowhere: the
    // row count is fixed at 2048, so anything else is a broken file rather than a smaller map.
    cached =
      Array.isArray(parsed?.regions) && Array.isArray(parsed?.regionmap) && parsed.regionmap.length === 2048
        ? parsed
        : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Region name for a system's coordinates, or null when the map is missing or the point is outside it. */
export function regionForSystem(
  projectRoot: string,
  x: number,
  y: number,
  z: number,
): string | null {
  const data = loadRegionMap(projectRoot);
  return data ? regionForCoords(data, x, y, z) : null;
}

/** Region index for a system, or null when the map is missing. Cheaper than the name for bulk passes. */
export function regionIndexForSystem(projectRoot: string, x: number, z: number): number | null {
  const data = loadRegionMap(projectRoot);
  return data ? regionIndexForCoords(data, x, z) : null;
}

/** Test seam — the map is process-wide, so a test that swaps it must be able to put it back. */
export function setRegionMapForTests(m: RegionMapData | null | undefined): void {
  cached = m;
}
