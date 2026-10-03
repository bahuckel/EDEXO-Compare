/**
 * Ingensradices unicus, known from HIP 87621 only. Its third body, HIP 87621 2 b a (rocky, thin
 * carbon dioxide, 468 K, no volcanism), came from the EDDN ScanOrganic set (2026-10-03) and was
 * missed under the 600–750 K band the first two bodies gave.
 */
import { describe, expect, it } from "vitest";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import { resolvePlanetTemperatureBand, speciesMatchesCriteria } from "../src/server/matchSpecies.js";
import { estimatedTemperatureRangeForScan } from "../src/server/planetTemperature.js";
import type { PlanetScan, SpeciesEntry, SpeciesMatchContext } from "../src/shared/types.js";

const db = loadSpeciesDatabase() as unknown as { species: SpeciesEntry[] };
const unicus = db.species.find((e) => e.id === "ingensradices_ingensradices_unicus")!;
const HIP_87621 = 147882789259;
const twoBA: PlanetScan = {
  BodyName: "HIP 87621 2 b a",
  BodyID: 6,
  StarSystem: "HIP 87621",
  SystemAddress: HIP_87621,
  PlanetClass: "Rocky body",
  Atmosphere: "thin carbon dioxide atmosphere",
  AtmosphereType: "CarbonDioxide",
  Volcanism: "",
  SurfaceGravity: 0.21 * 9.80665,
  SurfaceTemperature: 468,
  SurfacePressure: 0.048 * 101325,
  Landable: true,
};
const judge = (systemAddress: number) => {
  const est = estimatedTemperatureRangeForScan(twoBA);
  return speciesMatchesCriteria(unicus, twoBA, resolvePlanetTemperatureBand(twoBA, est), est, {
    systemAddress,
  } as SpeciesMatchContext);
};

describe("Ingensradices unicus", () => {
  it("matches HIP 87621 2 b a at 468 K, where it was logged", () => {
    expect(judge(HIP_87621).ok).toBe(true);
  });
  it("still matches nowhere outside HIP 87621", () => {
    const r = judge(1);
    expect(r.ok).toBe(false);
    expect(r.softOnly).toBeFalsy();
  });
});
