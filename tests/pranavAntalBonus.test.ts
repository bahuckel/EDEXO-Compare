/** Data value's "+30% Pranav Antal bonus" (owner, 2026-10-03): off by default, the exobiology total ×1.3. */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { loadSpeciesDatabase, organicLiveSummary } from "../src/server/snapshot.js";

describe("Pranav Antal bonus", () => {
  it("is off by default and multiplies the unsold exobiology value by 1.3 when on", () => {
    loadSpeciesDatabase();
    const store = new GameStateStore();
    store.pendingOrganicSales.push({
      fullKey: "a",
      bodyKey: "1:2",
      speciesKey: "x",
      label: "Bacterium Aurasus",
    });
    expect(store.pranavAntalBonus).toBe(false);
    const base = organicLiveSummary(store).organicDataValueCredits;
    expect(base).toBeGreaterThan(0);
    store.setPranavAntalBonus(true);
    expect(organicLiveSummary(store).organicDataValueCredits).toBe(Math.round(base * 1.3));
  });
});
