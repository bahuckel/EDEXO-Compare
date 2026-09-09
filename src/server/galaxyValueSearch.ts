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
import type { GalaxyValueHitDTO, GalaxyValueSearchDTO } from "../shared/types.js";

/** First-footfall multiplier, for display beside the base price. */
const FIRST_FOOTFALL = 5;

export interface GalaxyValueQuery {
  /** Minimum list price of a single species, in credits. */
  minCr: number;
  /** Measure distance from here; without it, results are ordered by value. */
  from?: { x: number; y: number; z: number } | null;
  /** How many systems to return. */
  limit?: number;
}

/** Species id -> list price, for the species the index actually carries. */
function pricedSpecies(index: BioIndex): Map<string, { price: number; displayName: string }> {
  const db = getCachedSpeciesDatabase();
  const prices = getCachedPriceIndex();
  const byId = new Map(db.species.map((e) => [e.id, e]));
  const out = new Map<string, { price: number; displayName: string }>();
  for (const id of index.species) {
    const entry = byId.get(id);
    if (!entry) continue;
    const price = lookupPrice(prices, entry.displayName, entry.id);
    if (price != null && price > 0) out.set(id, { price, displayName: entry.displayName });
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

export function galaxyValueSearch(query: GalaxyValueQuery): GalaxyValueSearchDTO {
  const index = loadBioIndex();
  if (!index) {
    return { available: false, minCr: query.minCr, matchedSystems: 0, speciesConsidered: 0, hits: [] };
  }

  const priced = pricedSpecies(index);
  const wanted = new Set<string>();
  for (const [id, { price }] of priced) if (price >= query.minCr) wanted.add(id);

  if (wanted.size === 0) {
    return {
      available: true,
      minCr: query.minCr,
      matchedSystems: 0,
      speciesConsidered: priced.size,
      hits: [],
    };
  }

  const systems = index.systemsWithAny(wanted);
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

  const hits: GalaxyValueHitDTO[] = [];
  for (const { s, d } of scored) {
    if (hits.length >= limit) break;
    const matched = s.species
      .map((id) => {
        const p = priced.get(id);
        return p && p.price >= query.minCr
          ? { speciesId: id, displayName: p.displayName, baseCr: p.price, firstFootfallCr: p.price * FIRST_FOOTFALL }
          : null;
      })
      .filter((v): v is NonNullable<typeof v> => v !== null)
      .sort((a, b) => b.baseCr - a.baseCr);
    if (matched.length === 0) continue;
    hits.push({
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
    });
  }

  if (!query.from) hits.sort((a, b) => b.bestCr - a.bestCr);

  return {
    available: true,
    minCr: query.minCr,
    matchedSystems: systems.length,
    speciesConsidered: wanted.size,
    hits,
  };
}
