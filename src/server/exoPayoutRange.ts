import type { BodyExoState, ExoPayoutRangeDTO, SpeciesMatch } from "../shared/types.js";
import { lookupPriceStrict, type PriceIndex } from "./priceList.js";

export type ExoPayoutSlotSource = "bio_signals" | "genus_hints" | "none";

/** Slot count for range math: FSS/DSS biological signal count, or DSS genus-list length fallback. */
export function resolveOrganicSlotCount(b: BodyExoState): { count: number; source: ExoPayoutSlotSource } {
  const sig = b.biologicalSignals;
  if (sig != null && sig > 0) return { count: sig, source: "bio_signals" };
  const gh = b.genusHints?.length ?? 0;
  if (gh > 0) return { count: gh, source: "genus_hints" };
  return { count: 0, source: "none" };
}

type PricedSpecies = { id: string; displayName: string; base: number };

/**
 * Total CR if you eventually sell `slotCount` species from this candidate list: sum of the `slotCount` cheapest
 * (min) and `slotCount` priciest (max) unique species list prices, each × `mult`. Uses strict price-list lookup.
 */
export function computeExoPayoutRangeFromMatches(
  // Only `entry` is read, and prices are looked up here — so callers can pass matcher output that
  // has not been decorated with photo/price fields yet.
  matches: Pick<SpeciesMatch, "entry">[],
  prices: PriceIndex,
  slotCount: number,
  slotSource: "bio_signals" | "genus_hints",
  mult: 1 | 5,
  journalWasFootfalled: boolean | null,
  commanderFirstFootfall: boolean,
): ExoPayoutRangeDTO | null {
  if (slotCount <= 0) return null;
  const byId = new Map<string, PricedSpecies>();
  for (const m of matches) {
    const p = lookupPriceStrict(prices, m.entry.displayName, m.entry.id);
    if (p == null || !Number.isFinite(p) || p < 0) continue;
    if (!byId.has(m.entry.id)) {
      byId.set(m.entry.id, { id: m.entry.id, displayName: m.entry.displayName, base: p });
    }
  }
  const items = [...byId.values()].sort((a, b) => a.base - b.base || a.id.localeCompare(b.id));
  if (items.length === 0) return null;

  const k = Math.min(slotCount, items.length);
  const minPick = items.slice(0, k);
  const maxPick = items.slice(items.length - k).sort((a, b) => b.base - a.base);

  const toLine = (x: PricedSpecies) => {
    const listCredits = Math.round(x.base);
    const payoutCredits = Math.round(x.base * mult);
    return { id: x.id, displayName: x.displayName, listCredits, payoutCredits };
  };

  const minTotalSpecies = minPick.map(toLine);
  const maxTotalSpecies = maxPick.map(toLine);

  const minCr = minTotalSpecies.reduce((s, r) => s + r.payoutCredits, 0);
  const maxCr = maxTotalSpecies.reduce((s, r) => s + r.payoutCredits, 0);

  return {
    minCr,
    maxCr,
    slotCount,
    slotSource,
    pricedCandidateCount: items.length,
    mult,
    commanderFirstFootfall,
    journalWasFootfalled,
    incomplete: slotCount > items.length,
    minTotalSpecies,
    maxTotalSpecies,
  };
}
