/**
 * A codex temperature edge two siblings share belongs to the one that starts there.
 *
 * Bands are written inclusive at both ends and many corpus readings are whole kelvin, so 180.0 K sat
 * inside Aleoida arcus (175–180) and coronamus (180–190) alike. Every truth body at a shared edge is
 * the upper species — coronamus 72 of 72 at 180 K, gravis 95 of 95 at 190 K — while 195 K, which no
 * sibling starts at, keeps 27 gravis and stays inclusive.
 */
import { describe, expect, it } from "vitest";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import { resolvePlanetTemperatureBand, speciesMatchesCriteria } from "../src/server/matchSpecies.js";
import { estimatedTemperatureRangeForScan } from "../src/server/planetTemperature.js";
import type { PlanetScan, SpeciesEntry } from "../src/shared/types.js";

const db = loadSpeciesDatabase() as unknown as { species: SpeciesEntry[] };
const species = (id: string) => db.species.find((e) => e.id === id)!;
const co2 = (kelvin: number): PlanetScan => ({
  BodyName: "Test 1 a",
  BodyID: 1,
  StarSystem: "Test",
  SystemAddress: 1,
  PlanetClass: "Rocky body",
  Atmosphere: "thin carbon dioxide atmosphere",
  AtmosphereType: "CarbonDioxide",
  SurfaceGravity: 0.1 * 9.80665,
  SurfaceTemperature: kelvin,
  SurfacePressure: 1000,
  Landable: true,
});
const judge = (id: string, kelvin: number) => {
  const scan = co2(kelvin);
  const est = estimatedTemperatureRangeForScan(scan);
  return speciesMatchesCriteria(species(id), scan, resolvePlanetTemperatureBand(scan, est), est, null);
};

describe("a shared temperature edge", () => {
  it("is marked at load, only where a sibling starts", () => {
    expect(species("aleoida_aleoida_arcus").temperatureCeilingSharedWith).toBe("Aleoida coronamus");
    expect(species("aleoida_aleoida_coronamus").temperatureCeilingSharedWith).toBe("Aleoida gravis");
    expect(species("aleoida_aleoida_gravis").temperatureCeilingSharedWith).toBeUndefined();
    expect(species("tubus_tubus_sororibus").temperatureCeilingSharedWith).toBeUndefined();
  });

  it("goes to the species that starts there — softly", () => {
    const arcus = judge("aleoida_aleoida_arcus", 180);
    expect(arcus.ok).toBe(false);
    expect(arcus.softOnly).toBe(true);
    expect(arcus.reasons.some((x) => /Aleoida coronamus/.test(x.detail))).toBe(true);
    expect(judge("aleoida_aleoida_coronamus", 180).ok).toBe(true);
  });

  it("leaves the rest of the band alone, and a ceiling nobody shares", () => {
    expect(judge("aleoida_aleoida_arcus", 179.9).ok).toBe(true);
    expect(judge("aleoida_aleoida_gravis", 195).ok).toBe(true);
  });
});
