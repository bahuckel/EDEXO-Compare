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
 *
 * ## The photograph underneath
 *
 * When `data/galaxy/` holds a picture of the galaxy, it is drawn first and the region colours go
 * over it at {@link REGION_LAYER_ALPHA}, so the regions read as a transparent overlay on the real
 * thing instead of as a coloured mosaic standing in for it. Registration is by the one landmark both
 * images share — the core at Sagittarius A*, which the region grid places by coordinate and the
 * photograph shows as its brightest point. Everything about the fit therefore lives in two measured
 * constants below, and a reader who thinks the galaxy sits a little too far left changes one number.
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

/**
 * Sagittarius A*, the registration landmark.
 *
 * The region grid knows where it is by coordinate and the photograph shows it as the brightest thing
 * in frame, which makes it the only point the two images can be pinned together on without trusting
 * either one's framing.
 */
const SAG_A_X_LY = 25.21;
const SAG_A_Z_LY = 25899.97;

/**
 * Where the core sits inside the photograph, in its own pixels.
 *
 * Measured as the luminance-weighted centroid of the brightest half-percent of
 * `milkyway-game-normalized.jpg` (1212x864), which lands within a few pixels of both the single
 * brightest pixel and the centre of the luminous disc. Replace the image and this moves.
 */
const GALAXY_IMAGE_CORE_PX = { x: 587.7, y: 433.7 };

/**
 * Region-grid pixels per photograph pixel.
 *
 * From the two discs: the region map's non-zero footprint spans 1985 x 1938 grid pixels and the
 * photograph's luminous extent spans 760 x 724 of its own, giving 2.612 across and 2.676 up. One
 * uniform figure is used rather than two, because the difference is under two percent and a galaxy
 * stretched to hide it would look wrong in a way a slightly small one does not.
 */
const GALAXY_IMAGE_SCALE = 2.6443;

/**
 * How much of the region colouring survives over the photograph.
 *
 * Applied as the opacity of the region layer in the map's SVG, only when there is a photograph under
 * it. Without one the regions are the backdrop and are drawn at full strength, exactly as before.
 *
 * A quarter, because the two layers answer different questions and only one of them is the map: the
 * photograph says where the galaxy is and the regions say where the boundaries fall, and a region
 * tint strong enough to read on its own turns the arms into a muddy mosaic. At 0.45 the spiral is
 * barely legible; at 0.20 the outer regions stop registering against black. This sits between them.
 */
export const REGION_LAYER_ALPHA = 0.25;

/** Grid column for a galactic x — the inverse of {@link xForRegionPx}. */
function regionPxForX(x: number): number {
  return (x + X_OFFSET) / LY_PER_REGION_PX;
}

/** Canvas row for a galactic z. Increasing z is up, so this is the flip the rows get. */
function canvasYForZ(z: number): number {
  return REGION_MAP_SIZE - 1 - (z + Z_OFFSET) / LY_PER_REGION_PX;
}

/**
 * Where the photograph goes, in region-grid pixels.
 *
 * Not painted into the region canvas, and that is the point. Resampling a 1212x864 photograph up to
 * 3205x2285 to fit a 2048 grid and then letting the browser scale the result back down to the plot
 * throws away detail twice over for nothing; the map draws the image itself, at whatever size it is
 * on screen, and the browser samples the original once. This says where to put it, in the same
 * coordinates the region layer already uses.
 *
 * Wider and taller than the grid itself, because the image carries a lot of black around the disc.
 */
export function galaxyImageRect(imageWidth: number, imageHeight: number): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: regionPxForX(SAG_A_X_LY) - GALAXY_IMAGE_CORE_PX.x * GALAXY_IMAGE_SCALE,
    y: canvasYForZ(SAG_A_Z_LY) - GALAXY_IMAGE_CORE_PX.y * GALAXY_IMAGE_SCALE,
    width: imageWidth * GALAXY_IMAGE_SCALE,
    height: imageHeight * GALAXY_IMAGE_SCALE,
  };
}

/** A photograph this machine actually has, with the size {@link galaxyImageRect} needs. */
export interface GalaxyImage {
  url: string;
  width: number;
  height: number;
}

/**
 * Ask for the photograph, and report its size rather than the element.
 *
 * The image is drawn by the browser from its own element in the map's SVG, not resampled into the
 * region canvas — see {@link galaxyImageRect}. All this has to settle is whether there is a
 * photograph at all and how big it is, so the rect can be worked out before the browser draws it.
 */
export async function loadGalaxyImage(url: string): Promise<GalaxyImage | null> {
  if (typeof Image === "undefined") return null;
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img.naturalWidth > 0
      ? { url, width: img.naturalWidth, height: img.naturalHeight }
      : null;
  } catch {
    return null;
  }
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
