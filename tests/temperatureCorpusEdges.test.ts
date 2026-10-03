/**
 * A codex ceiling of 195 K is 195.5 K in the game (src/server/matchSpecies.ts gameTemperatureCeilingK,
 * 2026-10-03). Tussock triticum at 195.1 K on Col 285 Sector DL-X d1-74 (EDDN ScanOrganic set) and
 * Fungoida gelata / Frutexa acus at 195 K on CO₂ were demoted; the corpus has 3,700 bodies of 24
 * species between 195 and 195.5 K, a handful beyond.
 */
import { describe, expect, it } from "vitest";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import {
  gameTemperatureCeilingK,
  resolvePlanetTemperatureBand,
  speciesMatchesCriteria,
} from "../src/server/matchSpecies.js";
import { estimatedTemperatureRangeForScan } from "../src/server/planetTemperature.js";
import type { PlanetScan, SpeciesEntry } from "../src/shared/types.js";

const db = loadSpeciesDatabase() as unknown as { species: SpeciesEntry[] };
const species = (id: string) => db.species.find((e) => e.id === id)!;

function body(kelvin: number, atmosphere: string): PlanetScan {
  return {
    BodyName: "Test 1 a",
    BodyID: 1,
    StarSystem: "Test",
    SystemAddress: 1,
    PlanetClass: "Rocky body",
    Atmosphere: `thin ${atmosphere} atmosphere`,
    AtmosphereType: atmosphere,
    SurfaceGravity: 0.23 * 9.80665,
    SurfaceTemperature: kelvin,
    SurfacePressure: 0.09 * 101325,
    Landable: true,
  };
}
const judge = (id: string, scan: PlanetScan) => {
  const est = estimatedTemperatureRangeForScan(scan);
  return speciesMatchesCriteria(species(id), scan, resolvePlanetTemperatureBand(scan, est), est, null);
};

describe("the 195 K ceiling", () => {
  it("is 195.5 K, and no other ceiling moves", () => {
    expect(gameTemperatureCeilingK(195)).toBe(195.5);
    expect(gameTemperatureCeilingK(190)).toBe(190);
    expect(gameTemperatureCeilingK(undefined)).toBeUndefined();
  });

  it("shows triticum at 195.1 K, as players found it, and not at 196 K", () => {
    expect(judge("tussock_tussock_triticum", body(195.1, "CarbonDioxide")).ok).toBe(true);
    expect(judge("tussock_tussock_triticum", body(196, "CarbonDioxide")).ok).toBe(false);
  });
});
