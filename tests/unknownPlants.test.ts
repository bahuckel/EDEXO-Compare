/**
 * "Unknown plant" rows (owner, 2026-10-03): every signal the candidate list cannot fill gets one.
 */
import { describe, expect, it } from "vitest";
import { unknownPlantSlots } from "../src/shared/unknownPlants.js";
import type { SpeciesMatch } from "../src/shared/types.js";

const row = (genusDataDir: string, unlikely = false) =>
  ({ entry: { id: `${genusDataDir}_x`, genusDataDir }, reasons: [], unlikely }) as unknown as SpeciesMatch;
const base = { genusHints: null, orphanHints: null, includeBacterium: true };

describe("unknown plant slots", () => {
  it("gives a one-signal body with no candidate its row", () => {
    expect(unknownPlantSlots({ ...base, signals: 1, matches: [] })).toEqual([{ genus: null }]);
  });
  it("fills only the signals the shown genera leave over; demoted rows do not count", () => {
    expect(
      unknownPlantSlots({ ...base, signals: 3, matches: [row("stratum"), row("tussock", true)] }),
    ).toHaveLength(2);
    expect(unknownPlantSlots({ ...base, signals: 1, matches: [row("stratum")] })).toEqual([]);
  });
  it("takes one signal for Bacterium when it is switched off, but never leaves a body empty", () => {
    const off = { ...base, includeBacterium: false };
    expect(unknownPlantSlots({ ...off, signals: 2, matches: [row("stratum")] })).toEqual([]);
    expect(unknownPlantSlots({ ...off, signals: 1, matches: [] })).toEqual([
      { genus: null, maybeBacterium: true },
    ]);
  });
  it("after a DSS, names the genera the scanner found and nothing in the list fills", () => {
    const hints = [{ Genus: "$Codex_Ent_Tussocks_Genus_Name;", Genus_Localised: "Tussock" }];
    expect(
      unknownPlantSlots({
        ...base,
        signals: 2,
        matches: [row("stratum")],
        genusHints: hints,
        orphanHints: hints,
      }),
    ).toEqual([{ genus: "Tussock" }]);
    expect(
      unknownPlantSlots({
        ...base,
        signals: 2,
        matches: [row("stratum")],
        genusHints: hints,
        orphanHints: [],
      }),
    ).toEqual([]);
  });
});

describe("unknown plant slots with Bacterium switched off", () => {
  it("does not call a DSS-named Bacterium unknown (its rows are left out on purpose)", () => {
    const hints = [
      { Genus: "$Codex_Ent_Bacterial_Genus_Name;", Genus_Localised: "Bacterium" },
      { Genus: "$Codex_Ent_Tussocks_Genus_Name;", Genus_Localised: "Tussock" },
    ];
    const r = unknownPlantSlots({
      signals: 3,
      matches: [row("stratum")],
      genusHints: hints,
      orphanHints: hints,
      includeBacterium: false,
    });
    expect(r).toEqual([{ genus: "Tussock" }]);
  });
});
