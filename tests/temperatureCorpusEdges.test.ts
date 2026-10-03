/**
 * Codex temperature edges the game's bodies run past (src/server/speciesTemperatureEdges.ts,
 * 2026-10-03). Tussock triticum, codex 190–195 K, at 195.1 K on Col 285 Sector DL-X d1-74 (EDDN
 * ScanOrganic set) was demoted because its feeder profile had no body above 195 K; the corpus has 397,
 * up to 195.4 K.
 */
import { describe, expect, it } from "vitest";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import { resolvePlanetTemperatureBand, speciesMatchesCriteria } from "../src/server/matchSpecies.js";
import { estimatedTemperatureRangeForScan } from "../src/server/planetTemperature.js";
import { observedTemperatureEdge } from "../src/server/speciesTemperatureEdges.js";
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

describe("a rounded codex edge", () => {
  it("reaches as far as the game's bodies do, and no further", () => {
    expect(observedTemperatureEdge("tussock_tussock_triticum", 195.1)).toMatchObject({
      codexK: 195,
      observedK: 195.4,
    });
    expect(observedTemperatureEdge("tussock_tussock_triticum", 193)).toBeNull();
    expect(observedTemperatureEdge("tussock_tussock_triticum", 195.6)).toBeNull();
  });

  it("shows triticum at 195.1 K, as players found it", () => {
    const r = judge("tussock_tussock_triticum", body(195.1, "CarbonDioxide"));
    expect(r.ok).toBe(true);
    expect(r.reasons.find((x) => x.field === "SurfaceTemperature")?.detail).toMatch(
      /outside the codex 190–195 K, but its bodies run to 195.4 K: 397 confirmed past 195 K/,
    );
  });

  it("is not a real edge with a few strays past it (Tussock albata, codex 175–180 K)", () => {
    expect(observedTemperatureEdge("tussock_tussock_albata", 181.5)).toBeNull();
    expect(observedTemperatureEdge("tussock_tussock_albata", 174.5)).toBeNull();
  });
});
