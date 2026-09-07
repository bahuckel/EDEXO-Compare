/**
 * Which of the galaxy's 42 named regions a point falls in.
 *
 * The map itself is Ben Peddell's (klightspeed) EliteDangerousRegionMap, MIT licensed — see
 * `data/exomastery/region-map.LICENSE.txt`, which ships beside the data and must stay with it. This
 * file is our own implementation of his published lookup; the data is his.
 *
 * ## How it works
 *
 * The galaxy is projected onto a flat 2048 x 2048 grid — **y is discarded**, regions are columns,
 * not boxes. A point becomes a pixel by an offset and a scale:
 *
 * ```
 * px = floor((x - X0) * 83 / 4096)
 * pz = floor((z - Z0) * 83 / 4096)
 * ```
 *
 * so one pixel is 4096/83 ≈ 49.35 ly across. Rows are stored run-length encoded, because at that
 * resolution a row crosses at most 23 regions and is mostly long uniform stretches: the whole map is
 * 241 kB rather than the 4 MB a dense grid would take.
 *
 * ## Why it is trusted
 *
 * Checked against the `Region` column EDAstro computes independently, over the codex dump:
 *
 * | distinct systems compared | 1,873,609 |
 * |---|---|
 * | agree | 1,850,547 (98.77 %) |
 * | disagree | 23,062 (1.23 %) |
 *
 * Of those 23,062, **12,641 are the single spelling `Achilles' Altar` vs `Achilles's Altar`**. Every
 * remaining disagreement is a pair of *adjacent* regions — Inner/Outer Orion Spur, Empyrean Straits/
 * Galactic Centre, Norma Arm/Norma Expanse — which is boundary rounding at 49 ly, not error. There
 * are no disagreements between regions that do not touch. Excluding the naming variant the two agree
 * on 99.44 % of systems.
 *
 * Spot checks that must hold, and do: Sol → Inner Orion Spur, Sagittarius A* → Galactic Centre,
 * Colonia → Inner Scutum-Centaurus Arm, Beagle Point → The Abyss.
 *
 * ## Read the boundary as soft
 *
 * A system within ~50 ly of a border may be attributed either way, so a region is evidence about
 * where a body sits, not a fact to gate on. Anything built on this should demote on a region
 * mismatch, never exclude — the same rule the nebula and Guardian gates already follow.
 */

/** The offsets that put the galaxy's corner at pixel 0,0. `y` is unused: the map is 2-D. */
export const REGION_MAP_X0 = -49985;
export const REGION_MAP_Z0 = -24105;

/** Light years per pixel, ≈ 49.35. The accuracy limit of any answer from this map. */
export const REGION_MAP_LY_PER_PIXEL = 4096 / 83;

/** `[runLength, regionIndex]`. */
export type RegionRun = readonly [number, number];

export interface RegionMapData {
  /** Index → name. Index 0 is null: outside any named region. */
  regions: readonly (string | null)[];
  /** 2048 rows, indexed by `pz`, each run-length encoded across `px`. */
  regionmap: readonly (readonly RegionRun[])[];
}

/**
 * Region index at a point, or 0 for "outside the map".
 *
 * Kept separate from the name lookup so a caller holding millions of coordinates can compare small
 * integers and never allocate a string — the corpus-wide passes do exactly that.
 */
export function regionIndexForCoords(data: RegionMapData, x: number, z: number): number {
  const px = Math.floor((x - REGION_MAP_X0) * 83 / 4096);
  const pz = Math.floor((z - REGION_MAP_Z0) * 83 / 4096);
  // Beyond the grid is honestly nowhere, not region 0 by accident — but both read as "unnamed",
  // and a caller that needs to tell them apart should be checking the coordinates, not the map.
  if (pz < 0 || pz >= data.regionmap.length) return 0;
  const row = data.regionmap[pz];
  if (px < 0) return 0;
  let rx = 0;
  for (const [runLength, regionIndex] of row) {
    if (px < rx + runLength) return regionIndex;
    rx += runLength;
  }
  return 0;
}

/**
 * Region name at a point, or null outside any named region.
 *
 * `y` is accepted and ignored so callers can pass a system's coordinates straight through without
 * having to know the map is flat; dropping it at the call site would only move that knowledge
 * somewhere less obvious.
 */
export function regionForCoords(
  data: RegionMapData,
  x: number,
  _y: number,
  z: number,
): string | null {
  return data.regions[regionIndexForCoords(data, x, z)] ?? null;
}

/**
 * A region name reduced to a form two datasets can be joined on.
 *
 * EDAstro writes `Achilles' Altar`, this map writes `Achilles's Altar`, and that single difference
 * is 55 % of all disagreement between the two sources — 12,641 systems. Any join across datasets has
 * to absorb it, so the rule lives here rather than being re-derived at each call site.
 *
 * The possessive has to go **before** punctuation is stripped, which is the whole subtlety. Strip
 * first and the two spellings collapse to `achillesaltar` and `achilless altar` — still different,
 * and a trailing-`s` trim cannot help because neither string ends in one. So `'s` is removed as a
 * unit first, then any bare apostrophe, and only then everything else:
 *
 * | input | after `'s` | after `'` | final |
 * |---|---|---|---|
 * | `Achilles's Altar` | `Achilles Altar` | — | `achillesaltar` |
 * | `Achilles' Altar` | — | `Achilles Altar` | `achillesaltar` |
 *
 * The nine other possessive regions — Ryker's Hope, Odin's Hold, Hawking's Gap and the rest — are
 * spelled the same way in both sources, and this treats them consistently either way.
 */
export function normaliseRegionName(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/'s\b/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** True when two names mean the same region, ignoring punctuation and possessive spelling. */
export function sameRegion(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normaliseRegionName(a);
  return na.length > 0 && na === normaliseRegionName(b);
}
