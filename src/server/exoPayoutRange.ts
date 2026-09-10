import type { BodyExoState, ExoPayoutRangeDTO, SpeciesMatch } from "../shared/types.js";
import {
  UNOBSERVED,
  observationAgeLabel,
  predatesExobiology,
  rungEvidence,
  targetRung,
  type ObservedFlag,
} from "../shared/observedFlag.js";
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

type PricedSpecies = { id: string; displayName: string; genus: string | undefined; base: number };

/**
 * The cheapest and the priciest species of each genus, since a body carries at most one of each.
 *
 * A planet never grows two species of the same genus — the game places one per genus per body, and
 * the biological signal count *is* the genus count. Summing the two priciest candidates when both
 * are Bacterium therefore prices a body that cannot exist. Reported from Blu Thua ML-P b47-2 B 7:
 * one signal, three Bacterium candidates, and the map lit it up as though all three were down there.
 *
 * So each genus contributes one entry to each end of the range — its own cheapest to the floor, its
 * own priciest to the ceiling — and the slot count then picks between *genera*.
 */
function pricedByGenus(items: PricedSpecies[]): { cheapest: PricedSpecies[]; priciest: PricedSpecies[] } {
  const lo = new Map<string, PricedSpecies>();
  const hi = new Map<string, PricedSpecies>();
  for (const it of items) {
    // A row with no genus is its own genus: degrade to per-species, never merge two unrelated ones.
    const g = (it.genus ?? "").trim().toLowerCase() || it.id;
    const l = lo.get(g);
    if (!l || it.base < l.base || (it.base === l.base && it.id.localeCompare(l.id) < 0)) lo.set(g, it);
    const h = hi.get(g);
    if (!h || it.base > h.base || (it.base === h.base && it.id.localeCompare(h.id) < 0)) hi.set(g, it);
  }
  const byPrice = (a: PricedSpecies, b: PricedSpecies) => a.base - b.base || a.id.localeCompare(b.id);
  return { cheapest: [...lo.values()].sort(byPrice), priciest: [...hi.values()].sort(byPrice) };
}

/**
 * Total CR if you eventually sell `slotCount` species from this candidate list: sum of the `slotCount` cheapest
 * (min) and `slotCount` priciest (max) list prices, each × `mult`, **one species per genus**. Uses strict
 * price-list lookup.
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
  /**
   * Phase 3 provenance. Defaulted so the many callers that do not have it yet — tests, the fixture
   * generator — keep compiling and simply report `unknown`, which is the honest state for them.
   */
  footfallFlag: ObservedFlag = UNOBSERVED,
  mappedFlag: ObservedFlag = UNOBSERVED,
): ExoPayoutRangeDTO | null {
  if (slotCount <= 0) return null;
  const byId = new Map<string, PricedSpecies>();
  for (const m of matches) {
    const p = lookupPriceStrict(prices, m.entry.displayName, m.entry.id);
    if (p == null || !Number.isFinite(p) || p < 0) continue;
    if (!byId.has(m.entry.id)) {
      byId.set(m.entry.id, {
        id: m.entry.id,
        displayName: m.entry.displayName,
        genus: m.entry.genus,
        base: p,
      });
    }
  }
  const items = [...byId.values()].sort((a, b) => a.base - b.base || a.id.localeCompare(b.id));
  if (items.length === 0) return null;

  // Slots are genera, not species: one Bacterium fills the Bacterium slot however many we listed.
  const { cheapest, priciest } = pricedByGenus(items);
  const genusCount = cheapest.length;
  const k = Math.min(slotCount, genusCount);
  const minPick = cheapest.slice(0, k);
  const maxPick = priciest.slice(genusCount - k).sort((a, b) => b.base - a.base);

  const toLine = (x: PricedSpecies) => {
    const listCredits = Math.round(x.base);
    const payoutCredits = Math.round(x.base * mult);
    return { id: x.id, displayName: x.displayName, listCredits, payoutCredits };
  };

  const minTotalSpecies = minPick.map(toLine);
  const maxTotalSpecies = maxPick.map(toLine);

  const rung = targetRung(footfallFlag, mappedFlag);
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
    footfallSeenLabel: observationAgeLabel(footfallFlag),
    wasMapped: mappedFlag.value,
    mappedSeenLabel: observationAgeLabel(mappedFlag),
    targetRung: rung,
    rungSeenLabel: observationAgeLabel(rungEvidence(rung, footfallFlag, mappedFlag)),
    mappedPredatesExobiology: predatesExobiology(mappedFlag),
    // Short of genera, not short of species: three Bacterium do not cover two signals.
    incomplete: slotCount > genusCount,
    minTotalSpecies,
    maxTotalSpecies,
  };
}
