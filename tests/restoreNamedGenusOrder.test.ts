/**
 * When a genus the scanner named has nothing left in the shown tier, one of its demoted rows is put
 * back — and which one matters.
 *
 * On two of the commander's oxygen worlds (Bacterium volu at 213 K and 223 K) volu had one objection,
 * the observed-temperature envelope of 68 bodies ending at 209 K, and the ammonia-only alcyoneum had
 * one too: "Codex lists Ammonia; got Oxygen". Counted alike, list order restored alcyoneum. The
 * envelope is the weakest evidence the matcher holds, so it now counts after every other kind.
 */
import { describe, expect, it } from "vitest";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import type { PlanetScan, SpeciesDatabase } from "../src/shared/types.js";

describe("restoring a named genus", () => {
  const db = loadSpeciesDatabase() as unknown as SpeciesDatabase;
  const oxygenWorld: PlanetScan = {
    BodyName: "Test 9 b",
    BodyID: 9,
    StarSystem: "Test",
    SystemAddress: 1,
    PlanetClass: "Rocky body",
    Atmosphere: "thin oxygen atmosphere",
    AtmosphereType: "Oxygen",
    AtmosphereComposition: [{ Name: "Oxygen", Percent: 100 }],
    SurfaceGravity: 0.12 * 9.80665,
    SurfaceTemperature: 213,
    SurfacePressure: 800,
    Landable: true,
  } as PlanetScan;

  it("puts back the species the codex allows, not one whose atmosphere is wrong", () => {
    const { matches } = matchDatabaseToScan(db, oxygenWorld, [{ Genus: "$Codex_Ent_Bacterial_Genus_Name;", Genus_Localised: "Bacterium" }], null, {
      includeBacterium: true,
    });
    const shown = matches.filter((m) => m.entry.genusDataDir === "bacterium" && !m.unlikely).map((m) => m.entry.id);
    expect(shown).toEqual(["bacterium_bacterium_volu"]);
  });
});
