import { describe, expect, it } from "vitest";
import type { BodyComputed, SpeciesMatch } from "../src/shared/types.js";
import { groupedSortedMatches } from "../src/client/speciesMatchHelpers.js";

function match(genusDir: string, genus: string, name: string, price: number | null = 1): SpeciesMatch {
  return {
    entry: { id: `${genusDir}_${name}`, displayName: name, genus, genusDataDir: genusDir, criteria: {} },
    reasons: [],
    priceCredits: price,
  } as unknown as SpeciesMatch;
}

const matches = [
  match("tussock", "Tussock", "Tussock ignis"),
  match("bacterium", "Bacterium", "Bacterium aurasus"),
  match("stratum", "Stratum", "Stratum tectonicas"),
] as unknown as BodyComputed["matches"];

/**
 * Genus groups used to come out alphabetical, which is to say in no order at all. The co-occurrence
 * solver ranks them; this is the only thing that ranking does to the UI, because the probabilities
 * behind it are not calibrated enough to show.
 */
describe("groupedSortedMatches", () => {
  it("keeps the alphabetical order when nothing ranks the genera", () => {
    expect(groupedSortedMatches(matches).map((g) => g.title)).toEqual(["Bacterium", "Stratum", "Tussock"]);
    expect(groupedSortedMatches(matches, null).map((g) => g.title)).toEqual([
      "Bacterium",
      "Stratum",
      "Tussock",
    ]);
  });

  it("puts the genera the solver ranked first, in its order", () => {
    const order = ["stratum", "tussock", "bacterium"];
    expect(groupedSortedMatches(matches, order).map((g) => g.title)).toEqual([
      "Stratum",
      "Tussock",
      "Bacterium",
    ]);
  });

  it("leaves an unranked genus after the ranked ones rather than dropping it", () => {
    const order = ["tussock"];
    expect(groupedSortedMatches(matches, order).map((g) => g.title)).toEqual([
      "Tussock",
      "Bacterium",
      "Stratum",
    ]);
  });
});
