/**
 * [CODEX] — a candidate whose colour is not yet in the commander's codex for this region (owner,
 * 2026-09-26: "per colour, as that's how it is in the game").
 */
import { describe, expect, it } from "vitest";
import { codexNewColoursInRegion, codexRegionKeysFromLine } from "../src/shared/codexLog.js";
import { GameStateStore } from "../src/server/gameState.js";
import type { JournalLine } from "../src/shared/types.js";

const line = (name: string, region: string) => ({
  event: "CodexEntry",
  Category: "$Codex_Category_Biology;",
  Category_Localised: "Biological and Geological",
  SubCategory: "$Codex_SubCategory_Organic_Structures;",
  Name_Localised: name,
  Region_Localised: region,
});

describe("codex per region and colour", () => {
  it("keys an entry by region, species and colour — and 'any colour' for the species", () => {
    expect(codexRegionKeysFromLine(line("Stratum Tectonicas - Green", "The Veils"))).toEqual([
      "the veils|stratum tectonicas|green",
      "the veils|stratum tectonicas|*",
    ]);
    // A single-variant species names no colour.
    expect(codexRegionKeysFromLine(line("Bark Mounds", "The Veils"))).toEqual([
      "the veils|bark mounds|",
      "the veils|bark mounds|*",
    ]);
    // Geology and stars are not organics.
    expect(
      codexRegionKeysFromLine({
        ...line("K Type Star", "The Veils"),
        Category: "$Codex_Category_StellarBodies;",
        Category_Localised: "Astronomical Bodies",
      }),
    ).toEqual([]);
  });

  it("marks a colour new until it is logged in that region", () => {
    const logged = new Set(codexRegionKeysFromLine(line("Tussock Propagito - Green", "The Veils")));
    expect(codexNewColoursInRegion(logged, "The Veils", "Tussock propagito", "Green")).toBeNull();
    // His XJ-A d5: Yellow predicted, only Green logged in the Veils.
    expect(codexNewColoursInRegion(logged, "The Veils", "Tussock propagito", "Yellow")).toEqual(["Yellow"]);
    // Another region has its own page.
    expect(codexNewColoursInRegion(logged, "Inner Orion Spur", "Tussock propagito", "Green")).toEqual([
      "Green",
    ]);
    // Two possible colours: only the unlogged one is new.
    expect(codexNewColoursInRegion(logged, "The Veils", "Tussock propagito", "Green or Yellow")).toEqual([
      "Yellow",
    ]);
  });

  it("falls back to 'any colour here' when the colour cannot be told", () => {
    const logged = new Set(codexRegionKeysFromLine(line("Bark Mounds", "The Veils")));
    expect(codexNewColoursInRegion(logged, "The Veils", "Bark Mounds", "(unknown)")).toBeNull();
    expect(codexNewColoursInRegion(logged, "Hawking's Gap", "Bark Mounds", null)).toEqual([]);
  });

  it("is collected from the journal and kept across a cache round trip", () => {
    const s = new GameStateStore();
    s.apply({
      timestamp: "2026-09-25T22:35:00Z",
      ...line("Stratum Tectonicas - Green", "The Veils"),
    } as unknown as JournalLine);
    expect(s.codexRegionLogged.has("the veils|stratum tectonicas|green")).toBe(true);
    const copy = new GameStateStore();
    copy.hydrateJournalMergePayload(s.serializeJournalMergePayload());
    expect(copy.codexRegionLogged.has("the veils|stratum tectonicas|*")).toBe(true);
  });
});
