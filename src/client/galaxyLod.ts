/**
 * Level of detail for the galaxy map: how much to draw, and how much to draw it as.
 *
 * The map drew every sector it had, at every zoom, plus a backlog dot per system and a search hit
 * per result. At galaxy scale that is hundreds of marks inside a few hundred pixels — most of them
 * on top of each other, and all of them re-rendered on every pan. The owner asked for the fix in
 * the terms a commander sees it in:
 *
 *   *"to lower lag, make the circle bigger if too many sectors in the region are reporting the same.
 *   Clicking it opens that specific region's sectors below, and clicking that sector shows all the
 *   systems in it. Zooming in unloads points that are no longer visible, and splits the
 *   region/sector into smaller points."*
 *
 * So two independent mechanisms, both pure and both here rather than tangled into the plot:
 *
 * 1. **Grouping.** Zoomed out, sectors collapse into one circle per region. A region is a real
 *    thing — the klightspeed map the backdrop is already drawn from — so this is not clustering by
 *    proximity, which would invent groups that are an artefact of the zoom level and jump about as
 *    it changes.
 * 2. **Culling.** Anything projected outside the viewport is not drawn at all.
 *
 * ## Why a region may not always claim a colour
 *
 * The owner's phrasing is conditional: bigger circle when the sectors are *reporting the same*. A
 * region whose sectors disagree cannot honestly be painted as any one of them — the map's colours
 * mean "what is still worth going for here", and averaging that across half a dozen sectors would
 * produce a claim no sector makes. So {@link RegionGroup.uniform} says whether they agree, and the
 * plot paints a disagreeing region neutrally: a place to zoom into, not an answer.
 *
 * The *tier* is still carried for a mixed region, because the most actionable thing in it is a true
 * statement about the region even when it is not true of every sector — it is what the group is
 * sorted and summarised by, not what it is coloured by.
 */
import { mostActionable, type GalaxyTier } from "@shared/galaxyTier";

/**
 * Below this zoom, sectors are grouped into regions.
 *
 * Chosen from what the view actually holds rather than from a feel: at 1x the whole galaxy is in
 * frame and 241 sectors sit inside roughly 500 px, so a sector is worth about two pixels and
 * grouping loses nothing a reader could have seen. By 3x a sector has room to be its own mark. It
 * is a display threshold, not a claim about the data, which is why it is a constant rather than
 * something measured.
 */
export const REGION_VIEW_BELOW_SCALE = 3;

/** What the plot draws at this zoom. */
export function lodLevel(scale: number): "region" | "sector" {
  return scale < REGION_VIEW_BELOW_SCALE ? "region" : "sector";
}

/** One sector, reduced to what grouping needs. */
export interface LodRow<C> {
  cell: C;
  /** Cell-space position the mark is drawn at — the centre of the box, not its corner. */
  x: number;
  y: number;
  z: number;
  bodies: number;
  tier: GalaxyTier;
}

export interface RegionGroup<C> {
  regionId: number;
  name: string;
  /** Centroid of this region's sectors in cell space, weighted by nothing — position, not mass. */
  x: number;
  y: number;
  z: number;
  rows: LodRow<C>[];
  /** Every recorded body across the region's sectors, which is what sizes the circle. */
  bodies: number;
  /** The most actionable tier any of its sectors reports. */
  tier: GalaxyTier;
  /** True when every sector in the group reports that same tier. See the header. */
  uniform: boolean;
}

/**
 * Collapse sectors into one group per region.
 *
 * Sectors the region map cannot place — region 0, "outside any named region" — are **not** thrown
 * together into a single blob. They are each returned as their own group, because "unnamed" is not
 * a place and a circle spanning everything outside the named galaxy would be a mark with no
 * meaning and a centroid in the middle of nowhere.
 */
export function groupByRegion<C>(
  rows: readonly LodRow<C>[],
  regionOf: (row: LodRow<C>) => { id: number; name: string },
): RegionGroup<C>[] {
  const byId = new Map<string, RegionGroup<C>>();
  for (const row of rows) {
    const region = regionOf(row);
    // Unnamed sectors get a key of their own, so they stay individual marks.
    const key = region.id === 0 ? `unnamed:${row.x},${row.y},${row.z}` : `r:${region.id}`;
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, {
        regionId: region.id,
        name: region.name,
        x: row.x,
        y: row.y,
        z: row.z,
        rows: [row],
        bodies: row.bodies,
        tier: row.tier,
        uniform: true,
      });
      continue;
    }
    existing.rows.push(row);
    existing.bodies += row.bodies;
    if (row.tier !== existing.rows[0]!.tier) existing.uniform = false;
    existing.tier = mostActionable(existing.tier, row.tier);
  }

  // Centroids, once the members are known. Averaging as we went would need a running count anyway
  // and reads worse than saying plainly that a group's position is the middle of its members.
  for (const g of byId.values()) {
    if (g.rows.length === 1) continue;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const r of g.rows) {
      x += r.x;
      y += r.y;
      z += r.z;
    }
    g.x = x / g.rows.length;
    g.y = y / g.rows.length;
    g.z = z / g.rows.length;
  }

  return [...byId.values()];
}

export interface PlotView {
  scale: number;
  tx: number;
  ty: number;
}

/**
 * Is this point, in pre-transform plot units, anywhere the viewport can see?
 *
 * The plot applies one `translate/scale` to the group holding the scene, so a point's screen
 * position is `p * scale + t`. Testing here rather than letting the browser clip means the elements
 * are never created — which is the part that costs, since each one is a React node with a `<title>`
 * child and its own handlers.
 *
 * The margin is generous on purpose: a mark whose centre is just off screen may still have a
 * visible edge, and popping in at the boundary looks like a bug even when nothing is missing.
 */
export function isOnScreen(
  cx: number,
  cy: number,
  view: PlotView,
  width: number,
  height: number,
  margin = 48,
): boolean {
  const x = cx * view.scale + view.tx;
  const y = cy * view.scale + view.ty;
  return x >= -margin && x <= width + margin && y >= -margin && y <= height + margin;
}
