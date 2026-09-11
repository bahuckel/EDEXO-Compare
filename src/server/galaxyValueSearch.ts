/**
 * "Where in the galaxy is there something worth at least N?"
 *
 * The question the whole project points at, answered over the biology index rather than over this
 * commander's history. A 19 M filter matches 289 044 systems, so the answer can never be "all of
 * them" — it is always the nearest handful, which is what a commander deciding where to fly actually
 * wants.
 *
 * ## Value here is the plant's own list price, not the payout
 *
 * A species' price is what one sample of it sells for at 1x. First footfall multiplies it by five,
 * and a body can hold several species, so what a *trip* pays is a larger and much less certain
 * number. The filter deliberately uses the plain per-species price, because that is the number the
 * commander already knows from the codex and can reason about — 19 M means Stratum Tectonicas, not
 * "a trip worth 19 M". The 5x figure rides along for display, never for filtering.
 *
 * ## Known, not predicted
 *
 * Every hit is a species edastro's codex has actually recorded in that system. This is not the
 * matcher's opinion about what might grow there; it is a sighting somebody logged. That makes it a
 * different claim from the backlog panel's predictions, and the two must not be blended in one list.
 */
import type { BioIndex, BioIndexSystem } from "./bioIndex.js";
import { loadBioIndex } from "./bioIndex.js";
import { getCachedPriceIndex, getCachedSpeciesDatabase } from "./snapshot.js";
import { lookupPrice } from "./priceList.js";
import { sectorCellFromCoords, sectorCellKey } from "../shared/sectorName.js";
import type {
  GalaxySpeciesCatalogueDTO,
  GalaxyValueHitDTO,
  GalaxyValueQueryDTO,
  GalaxyValueSearchDTO,
} from "../shared/types.js";

/** First-footfall multiplier, for display beside the base price. */
const FIRST_FOOTFALL = 5;

export interface GalaxyValueQuery extends GalaxyValueQueryDTO {
  /** Measure distance from here; without it, results are ordered by value. */
  from?: { x: number; y: number; z: number } | null;
  /** How many systems to return. */
  limit?: number;
}

/** Species id -> list price, for the species the index actually carries. */
function pricedSpecies(
  index: BioIndex,
): Map<string, { price: number; displayName: string; genusDir: string }> {
  const db = getCachedSpeciesDatabase();
  const prices = getCachedPriceIndex();
  const byId = new Map(db.species.map((e) => [e.id, e]));
  const out = new Map<string, { price: number; displayName: string; genusDir: string }>();
  for (const id of index.species) {
    const entry = byId.get(id);
    if (!entry) continue;
    const price = lookupPrice(prices, entry.displayName, entry.id);
    if (price != null && price > 0) {
      out.set(id, { price, displayName: entry.displayName, genusDir: entry.genusDataDir });
    }
  }
  return out;
}

/** Everything the codex knows in a system, at 1x. The number the slider tests. */
function systemValue(
  species: string[],
  priced: Map<string, { price: number; displayName: string; genusDir: string }>,
): number {
  let total = 0;
  for (const id of species) total += priced.get(id)?.price ?? 0;
  return total;
}

/**
 * Which species the commander is actually asking about.
 *
 * Named species win outright: someone who picked *Stratum tectonicas* has already decided, and
 * testing their price again can only take the answer away. A genus narrows the field and leaves price
 * meaningful, because Stratum spans 1 M to 19 M across eight species.
 */
function wantedSpecies(
  priced: Map<string, { price: number; displayName: string; genusDir: string }>,
  query: GalaxyValueQuery,
): Set<string> {
  const explicit = query.speciesIds?.filter((id) => priced.has(id)) ?? [];
  if (explicit.length > 0) return new Set(explicit);
  const genus = query.genusDirs?.length ? new Set(query.genusDirs) : null;
  const out = new Set<string>();
  for (const [id, v] of priced) {
    if (genus && !genus.has(v.genusDir)) continue;
    // No price test here any more. The threshold is a question about the *system* total, so it is
    // applied once the system's species are known — filtering species first would drop the cheap
    // ones that make a system worth the trip when added together.
    out.add(id);
  }
  return out;
}

function distance(
  a: { x: number; y: number; z: number } | null | undefined,
  b: BioIndexSystem,
): number | null {
  if (!a) return null;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * How many sector cells the map sample may carry.
 *
 * One mark per 1 280 ly cell, so this is a resolution rather than a count of systems: 500 cells is
 * already a finer grid than the galaxy map can show at any zoom a reader uses, and the client culls
 * and groups what is left. Higher would cost bytes nobody sees.
 */
const SPREAD_CELLS = 500;

/**
 * Where the thing *lives*, as opposed to which of it is nearest.
 *
 * The list answers "where should I go", and nearest-first is exactly right for it. The map asks a
 * different question — the owner's reason for having one at all was *"to explore sectors with less
 * visitors"* — and nearest-first is close to the worst possible answer to that. Measured on his own
 * machine: a search for Stratum returned 508,820 matching systems, and the 200 nearest spanned
 * **12 x 6 pixels** on a 1,441-pixel-wide galaxy. He saw them and asked what the line of diamonds
 * was, which is the correct reaction to a distribution collapsed onto one point.
 *
 * So the map gets a second, spatial sample: the dearest system in each sector cell that matched,
 * over the whole galaxy. One per cell rather than the top N overall, because the top N overall
 * would cluster in whichever corner happens to be richest and tell the same kind of lie in a
 * different place.
 *
 * **This is a sample and the UI has to say so.** `spreadCells` carries how many cells actually
 * matched, so a reader can see when they are being shown 500 of 3,000 rather than all of them.
 */
function spreadSample(
  systems: readonly BioIndexSystem[],
  query: GalaxyValueQuery,
  toHit: (s: BioIndexSystem, d: number | null) => GalaxyValueHitDTO | null,
): { spread: GalaxyValueHitDTO[]; spreadCells: number } {
  const best = new Map<string, { s: BioIndexSystem; value: number }>();
  for (const s of systems) {
    const key = sectorCellKey(sectorCellFromCoords(s.x, s.y, s.z));
    const value = s.species.length;
    const held = best.get(key);
    // Ties keep the first seen: the order the index yields is stable, so the sample is too.
    if (!held || value > held.value) best.set(key, { s, value });
  }

  const chosen = [...best.values()].sort((a, b) => b.value - a.value).slice(0, SPREAD_CELLS);
  const spread: GalaxyValueHitDTO[] = [];
  for (const { s } of chosen) {
    const hit = toHit(s, distance(query.from, s));
    if (hit) spread.push(hit);
  }
  return { spread, spreadCells: best.size };
}

export function galaxyValueSearch(query: GalaxyValueQuery): GalaxyValueSearchDTO {
  const index = loadBioIndex();
  if (!index) {
    return { available: false, minCr: query.minCr, matchedSystems: 0, speciesConsidered: 0, hits: [] };
  }

  const priced = pricedSpecies(index);
  const wanted = wantedSpecies(priced, query);
  const explicitSpecies = (query.speciesIds?.length ?? 0) > 0;
  const need = query.requireTiers ?? 0;

  if (wanted.size === 0) {
    return {
      available: true,
      minCr: query.minCr,
      matchedSystems: 0,
      speciesConsidered: priced.size,
      hits: [],
    };
  }

  const all = index.systemsWithAny(wanted);
  // All requested flags must be present, not any of them: "mapped AND has a species" is a narrower
  // and more useful question than "mapped OR has a species".
  const byTier = need === 0 ? all : all.filter((s) => (s.tiers & need) === need);
  /*
   * The slider, applied to the whole system: four 5 M plants beat one 15 M plant for a single trip.
   *
   * Skipped entirely when a species was named. Someone hunting Bacterium Aurasus specifically does
   * not want the systems holding it filtered by how rich they are — they asked for the plant, and a
   * leftover threshold would silently answer a narrower question than the one on screen.
   */
  const systems =
    query.minCr > 0 && !explicitSpecies
      ? byTier.filter((s) => systemValue(s.species, priced) >= query.minCr)
      : byTier;
  const limit = Math.max(1, Math.min(query.limit ?? 200, 2000));

  /*
   * Rank before trimming, and rank by distance when we know where the commander is.
   *
   * Sorting 289 044 rows costs far less than the scan that produced them, so this stays simple
   * rather than keeping a heap. Systems the index cannot place sort last: an unknown position is not
   * a near one, and putting it first in a list whose purpose is "what is closest" is the most
   * confidently wrong thing this could do.
   */
  const scored = systems.map((s) => ({ s, d: distance(query.from, s) }));
  if (query.from) {
    scored.sort((a, b) => {
      if (a.d == null) return b.d == null ? 0 : 1;
      if (b.d == null) return -1;
      return a.d - b.d;
    });
  }

  const toHit = (s: BioIndexSystem, d: number | null): GalaxyValueHitDTO | null => {
    const matched = s.species
      .map((id) => {
        const p = priced.get(id);
        // With a species named, only that one is "matched". Otherwise everything known here counts —
        // the system cleared the threshold as a whole, so listing only its dearest plant would
        // misrepresent why.
        return p && (explicitSpecies ? wanted.has(id) : true)
          ? { speciesId: id, displayName: p.displayName, baseCr: p.price, firstFootfallCr: p.price * FIRST_FOOTFALL }
          : null;
      })
      .filter((v): v is NonNullable<typeof v> => v !== null)
      .sort((a, b) => b.baseCr - a.baseCr);
    if (matched.length === 0) return null;
    const total = systemValue(s.species, priced);
    return {
      systemAddress: Number(s.id64),
      starSystem: s.name,
      x: s.x,
      y: s.y,
      z: s.z,
      regionId: s.regionId,
      distanceLy: d,
      species: matched,
      bestCr: matched[0]!.baseCr,
      totalKnownSpecies: s.species.length,
      systemCr: total,
      systemFirstFootfallCr: total * FIRST_FOOTFALL,
      tiers: s.tiers,
      bodyCount: s.bodyCount,
    };
  };

  const hits: GalaxyValueHitDTO[] = [];
  for (const { s, d } of scored) {
    if (hits.length >= limit) break;
    const hit = toHit(s, d);
    if (hit) hits.push(hit);
  }

  const { spread, spreadCells } = spreadSample(systems, query, toHit);

  if (!query.from) hits.sort((a, b) => b.bestCr - a.bestCr);

  return {
    available: true,
    minCr: query.minCr,
    query: {
      minCr: query.minCr,
      speciesIds: query.speciesIds,
      genusDirs: query.genusDirs,
      requireTiers: need,
    },
    matchedSystems: systems.length,
    speciesConsidered: wanted.size,
    hits,
    spread,
    spreadCells,
  };
}

/**
 * What the picker can offer, with how many systems each species actually appears in.
 *
 * The counts matter more than they look. A species the codex has recorded in eleven systems is a
 * search that will nearly always come back empty, and a picker that offers it identically to one with
 * four hundred thousand is quietly wasting the commander's time. Showing the count lets them choose
 * a question that has an answer.
 *
 * Computed once and held: it is a scan of 5.3 M systems, and nothing about it changes until the index
 * is rebuilt.
 */
let catalogue: GalaxySpeciesCatalogueDTO | null = null;

export function galaxySpeciesCatalogue(): GalaxySpeciesCatalogueDTO {
  if (catalogue) return catalogue;
  const index = loadBioIndex();
  if (!index) return (catalogue = { available: false, species: [], systemCount: 0 });

  const priced = pricedSpecies(index);
  const db = getCachedSpeciesDatabase();
  const genusName = new Map(db.species.map((e) => [e.genusDataDir, e.genus]));
  const counts = new Map<string, number>();
  for (const id of priced.keys()) counts.set(id, 0);
  for (const id of priced.keys()) {
    counts.set(id, index.systemsWithAny([id]).length);
  }

  catalogue = {
    available: true,
    systemCount: index.systemCount,
    species: [...priced.entries()]
      .map(([speciesId, v]) => ({
        speciesId,
        displayName: v.displayName,
        genusDir: v.genusDir,
        genusName: genusName.get(v.genusDir) ?? v.genusDir,
        baseCr: v.price,
        systemCount: counts.get(speciesId) ?? 0,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  };
  return catalogue;
}

/** Test seam. */
export function clearGalaxyCatalogueCache(): void {
  catalogue = null;
}
