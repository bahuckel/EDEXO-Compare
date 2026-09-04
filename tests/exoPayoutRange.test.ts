import { describe, expect, it } from "vitest";
import { computeExoPayoutRangeFromMatches, resolveOrganicSlotCount } from "../src/server/exoPayoutRange.js";
import type { PriceIndex } from "../src/server/priceList.js";
import type { BodyExoState, SpeciesEntry, SpeciesMatch } from "../src/shared/types.js";

function body(over: Partial<BodyExoState>): BodyExoState {
  return {
    key: "1:2",
    bodyName: "Test 1 a",
    bodyId: 2,
    systemAddress: 1,
    starSystem: "Test",
    biologicalSignals: null,
    genusHints: null,
    dssComplete: false,
    scan: null,
    organicGenusLocks: [],
    confirmedVariants: [],
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function match(id: string, displayName: string): Pick<SpeciesMatch, "entry"> {
  return { entry: { id, displayName } as SpeciesEntry };
}

/** Prices are keyed by lowercased display name; see priceList.normKey. */
const prices: PriceIndex = new Map([
  ["cheap one", 1_000_000],
  ["middle one", 2_000_000],
  ["dear one", 5_000_000],
]);

const all = [match("a", "Cheap one"), match("b", "Middle one"), match("c", "Dear one")];

describe("resolveOrganicSlotCount", () => {
  it("prefers the FSS/DSS biological signal count", () => {
    expect(resolveOrganicSlotCount(body({ biologicalSignals: 3, genusHints: [] }))).toEqual({
      count: 3,
      source: "bio_signals",
    });
  });

  it("falls back to the DSS genus list when there is no signal count", () => {
    const hints = [
      { Genus: "$Codex_Ent_Bacterial_Genus_Name;", Genus_Localised: "Bacterium" },
      { Genus: "$Codex_Ent_Stratum_Genus_Name;", Genus_Localised: "Stratum" },
    ];
    expect(resolveOrganicSlotCount(body({ genusHints: hints }))).toEqual({
      count: 2,
      source: "genus_hints",
    });
  });

  it("reports none when the journal knows of no organics", () => {
    expect(resolveOrganicSlotCount(body({}))).toEqual({ count: 0, source: "none" });
    expect(resolveOrganicSlotCount(body({ biologicalSignals: 0 }))).toEqual({ count: 0, source: "none" });
  });
});

describe("computeExoPayoutRangeFromMatches", () => {
  it("takes the k cheapest for min and the k priciest for max", () => {
    const r = computeExoPayoutRangeFromMatches(all, prices, 2, "bio_signals", 1, false, false);
    expect(r).not.toBeNull();
    expect(r!.minCr).toBe(3_000_000); // 1M + 2M
    expect(r!.maxCr).toBe(7_000_000); // 5M + 2M
    expect(r!.minTotalSpecies.map((s) => s.displayName)).toEqual(["Cheap one", "Middle one"]);
    expect(r!.maxTotalSpecies.map((s) => s.displayName)).toEqual(["Dear one", "Middle one"]);
    expect(r!.pricedCandidateCount).toBe(3);
    expect(r!.incomplete).toBe(false);
  });

  it("applies the first-footfall 5× multiplier to every line and the totals", () => {
    const r = computeExoPayoutRangeFromMatches(all, prices, 1, "bio_signals", 5, false, true)!;
    expect(r.minCr).toBe(5_000_000);
    expect(r.maxCr).toBe(25_000_000);
    expect(r.minTotalSpecies[0]!.listCredits).toBe(1_000_000);
    expect(r.minTotalSpecies[0]!.payoutCredits).toBe(5_000_000);
    expect(r.mult).toBe(5);
    expect(r.commanderFirstFootfall).toBe(true);
  });

  it("flags the range incomplete when there are fewer priced candidates than slots", () => {
    const r = computeExoPayoutRangeFromMatches(all, prices, 5, "bio_signals", 1, null, false)!;
    expect(r.incomplete).toBe(true);
    expect(r.slotCount).toBe(5);
    expect(r.minTotalSpecies).toHaveLength(3);
    expect(r.minCr).toBe(8_000_000);
    expect(r.maxCr).toBe(8_000_000);
  });

  it("ignores species with no price and de-duplicates by species id", () => {
    const withNoise = [...all, match("d", "Not in the price list"), match("a", "Cheap one")];
    const r = computeExoPayoutRangeFromMatches(withNoise, prices, 3, "genus_hints", 1, false, false)!;
    expect(r.pricedCandidateCount).toBe(3);
    expect(r.slotSource).toBe("genus_hints");
  });

  it("returns null when there is nothing to sell", () => {
    expect(computeExoPayoutRangeFromMatches(all, prices, 0, "bio_signals", 1, false, false)).toBeNull();
    expect(
      computeExoPayoutRangeFromMatches([match("z", "Unknown")], prices, 2, "bio_signals", 1, false, false),
    ).toBeNull();
  });

  it("passes the journal's footfall flag through untouched, including unknown", () => {
    const unknown = computeExoPayoutRangeFromMatches(all, prices, 1, "bio_signals", 1, null, false)!;
    expect(unknown.journalWasFootfalled).toBeNull();
    const footfalled = computeExoPayoutRangeFromMatches(all, prices, 1, "bio_signals", 1, true, false)!;
    expect(footfalled.journalWasFootfalled).toBe(true);
  });
});
