/**
 * A trace of the right gas is not a habitat.
 *
 * Blu Thua EM-D d12-25 A 1 a is 99.01 % CO₂ with 0.99 % SO₂ in the mix. Recepta needs sulphur
 * dioxide, and both its species were offered on the shown list: `AtmosphereType` names only the
 * dominant gas, so the trace was invisible, and the observation floor then overruled the miss.
 *
 * Below 5 % the species is **demoted**, not deleted — a long shot belongs in the unlikely tier.
 */
import { describe, expect, it } from "vitest";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import { getProjectRoot } from "../src/server/paths.js";
import type { PlanetScan } from "../src/shared/types.js";

const db = loadSpeciesDatabaseFromTree(getProjectRoot());

function scan(over: Partial<PlanetScan>): PlanetScan {
  return {
    BodyName: "Test 1 a",
    BodyID: 1,
    StarSystem: "Test",
    SystemAddress: 1,
    PlanetClass: "Rocky body",
    SurfaceGravity: 2.28,
    SurfaceTemperature: 181,
    SurfacePressure: 9649,
    Landable: true,
    ...over,
  };
}

const receptaIds = (s: PlanetScan) => {
  const run = matchDatabaseToScan(db, s, null, null, { includeBacterium: true });
  const pick = (unlikely: boolean) =>
    run.matches
      .filter((m) => !!m.unlikely === unlikely && m.entry.genusDataDir === "recepta")
      .map((m) => m.entry.id)
      .sort();
  return { shown: pick(false), unlikely: pick(true) };
};

describe("a genus-required gas, measured against the composition", () => {
  it("demotes Recepta on the real body — 0.99 % sulphur dioxide in a CO₂ atmosphere", () => {
    const got = receptaIds(
      scan({
        AtmosphereType: "CarbonDioxide",
        Atmosphere: "thin carbon dioxide atmosphere",
        atmosphereComposition: [
          { Name: "CarbonDioxide", Percent: 99.009911 },
          { Name: "SulphurDioxide", Percent: 0.990099 },
        ],
      }),
    );
    expect(got.shown).toEqual([]);
    expect(got.unlikely.length).toBeGreaterThan(0);
  });

  it("keeps Recepta on the shown list when the gas is the atmosphere", () => {
    const got = receptaIds(
      scan({ AtmosphereType: "SulphurDioxide", Atmosphere: "thin sulphur dioxide atmosphere" }),
    );
    expect(got.shown.length).toBeGreaterThan(0);
  });

  it("accepts a mix that clears the five per cent floor", () => {
    const got = receptaIds(
      scan({
        AtmosphereType: "CarbonDioxide",
        atmosphereComposition: [
          { Name: "CarbonDioxide", Percent: 93 },
          { Name: "SulphurDioxide", Percent: 7 },
        ],
      }),
    );
    expect(got.shown.length).toBeGreaterThan(0);
  });

  it("does not invent a rejection when the scan carries no composition", () => {
    // Older scans and some caches drop AtmosphereComposition. Measuring a trace is then impossible,
    // and a rare body let through costs less than a real one hidden by missing data.
    const withComposition = receptaIds(
      scan({
        AtmosphereType: "SulphurDioxide",
        atmosphereComposition: [{ Name: "SulphurDioxide", Percent: 100 }],
      }),
    );
    const without = receptaIds(scan({ AtmosphereType: "SulphurDioxide" }));
    expect(without.shown).toEqual(withComposition.shown);
  });
});
