/**
 * The galaxy itself, drawn behind the sector map.
 *
 * The map used to be markers on an empty rectangle, which told a reader where the *data* was and
 * nothing about where the galaxy was. This paints Ben Peddell's region map underneath, so a bright
 * cluster of sectors can be seen sitting in Inner Orion Spur rather than floating in a void.
 *
 * It is a canvas, not SVG. The map is a 2048x2048 grid of region indices — as paths that is millions
 * of nodes, and as an image it is one element the browser scales for free. The canvas is painted once
 * and handed over as a data URL.
 *
 * ## Orientation
 *
 * Rows of `regionmap` run in the direction of increasing z, and the map draws increasing z *upward*
 * because the galactic core belongs above Sol. So the rows are painted bottom-up: row `pz` goes to
 * canvas y `SIZE - 1 - pz`. Getting this wrong is not subtle in the end — the galaxy renders upside
 * down, which is how it was caught the first time the region map was integrated at all — but it is
 * invisible in the data, so it is stated here rather than left to a reader to infer.
 *
 * ## Colour
 *
 * Deliberately dim and desaturated. This is a backdrop: the moment a region is bright enough to
 * compete with a sector marker, the map is showing the reader the wrong thing. Region 0 is "outside
 * the map" and is painted as nothing at all rather than as a colour, so the galaxy keeps its shape.
 */

/** Grid edge, in pixels. The vendored map is square. */
export const REGION_MAP_SIZE = 2048;

/**
 * Light years per grid pixel: the game's own 4096/83 sector constant, not a rounding of 49.35.
 *
 * Used to turn a pixel back into galactic coordinates so the image can be placed against the same
 * projection the markers use.
 */
export const LY_PER_REGION_PX = 4096 / 83;

/** Offsets the vendored map was built with — see `src/shared/regionMap.ts`, which reverses these. */
const X_OFFSET = 49985;
const Z_OFFSET = 24105;

/** Galactic x at the left edge of grid column `px`. */
export function xForRegionPx(px: number): number {
  return px * LY_PER_REGION_PX - X_OFFSET;
}

/** Galactic z at grid row `pz`. */
export function zForRegionPz(pz: number): number {
  return pz * LY_PER_REGION_PX - Z_OFFSET;
}

/**
 * How many sector cells the region grid spans.
 *
 * The two grids were built from the same corner — `SECTOR_ORIGIN` is (-49985, …, -24105) and the
 * region map's offsets are the same numbers — so a region pixel converts to a cell index by scale
 * alone, with no translation. That coincidence is why the backdrop can be placed against the sector
 * projection without knowing anything about light years, and it is worth stating because the day the
 * two origins diverge this silently shifts the whole galaxy.
 */
export function regionSpanInCells(sectorSizeLy: number): number {
  return (REGION_MAP_SIZE * LY_PER_REGION_PX) / sectorSizeLy;
}

export interface RegionMapPayload {
  regions: string[];
  /** Per row, runs of `[runLength, regionIndex]`. */
  regionmap: [number, number][][];
}

/**
 * A muted colour per region index.
 *
 * Generated from the index rather than hand-picked: there are 43 regions, no reader is going to
 * learn a 43-colour key, and the point is only that neighbouring regions differ enough to show the
 * galaxy's structure. The golden-angle step keeps adjacent indices far apart in hue, and the fixed
 * low saturation and lightness keep every one of them behind the markers.
 */
function regionColour(index: number): [number, number, number] {
  const hue = (index * 137.508) % 360;
  return hslToRgb(hue / 360, 0.32, 0.17);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))));
  };
  return [f(0), f(8), f(4)];
}

/**
 * Paint the region map and return it as a PNG data URL, or null where there is no canvas.
 *
 * Null rather than a throw: a missing backdrop is a map that still works, and the caller draws its
 * plain background instead. Server-side rendering and the odd locked-down browser both land here.
 */
export function renderRegionBackdrop(data: RegionMapPayload): string | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = REGION_MAP_SIZE;
  canvas.height = REGION_MAP_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const img = ctx.createImageData(REGION_MAP_SIZE, REGION_MAP_SIZE);
  const px = img.data;
  const palette = new Map<number, [number, number, number]>();

  const rows = data.regionmap;
  for (let pz = 0; pz < rows.length && pz < REGION_MAP_SIZE; pz++) {
    // Bottom-up: increasing z is up on screen, and the rows run the other way.
    const y = REGION_MAP_SIZE - 1 - pz;
    let x = 0;
    for (const run of rows[pz] ?? []) {
      const runLength = run[0];
      const regionIndex = run[1];
      if (regionIndex === 0) {
        // Outside the map. Left fully transparent so the galaxy has an edge rather than a border.
        x += runLength;
        continue;
      }
      let rgb = palette.get(regionIndex);
      if (!rgb) {
        rgb = regionColour(regionIndex);
        palette.set(regionIndex, rgb);
      }
      const end = Math.min(x + runLength, REGION_MAP_SIZE);
      for (; x < end; x++) {
        const o = (y * REGION_MAP_SIZE + x) * 4;
        px[o] = rgb[0];
        px[o + 1] = rgb[1];
        px[o + 2] = rgb[2];
        px[o + 3] = 255;
      }
      x = end;
      if (x >= REGION_MAP_SIZE) break;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}
