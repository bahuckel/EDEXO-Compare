/**
 * Bark Mounds had no species row, so an airless volcanic moon near a nebula could only be offered
 * something else. Tegnae HT-Z d13-1 1 a (2026-09-25) was offered Fumerola extremus, then Anemone;
 * the surface scan said Bark Mounds. The row now loads from the shipped tree and fits that body.
 */
import { describe, expect, it } from "vitest";
import { speciesMatchesExcludingTempPressure } from "../src/server/matchSpecies.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import { gateForSpeciesId } from "../src/shared/spatialGates.js";
import type { PlanetScan } from "../src/shared/types.js";

const tegnae1a = {
  BodyName: "Tegnae HT-Z d13-1 1 a",
  BodyID: 2,
  StarSystem: "Tegnae HT-Z d13-1",
  SystemAddress: 48611743739,
  PlanetClass: "Rocky body",
  Atmosphere: "",
  AtmosphereType: "None",
  Volcanism: "minor silicate vapour geysers volcanism",
  SurfaceTemperature: 344.829102,
  SurfaceGravity: 1.413033,
  SurfacePressure: 0,
  Landable: true,
} as unknown as PlanetScan;

describe("Bark Mounds", () => {
  const db = loadSpeciesDatabase();
  const row = db.species.find((s) => s.displayName === "Bark Mounds");

  it("is in the species tree, with the nebula gate on its id", () => {
    expect(row?.genus).toBe("Bark Mounds");
    expect(gateForSpeciesId(row!.id)?.kind).toBe("nebula");
    expect(row?.predictionUnsupported).toBeUndefined();
  });

  it("fits the airless volcanic moon it was found on", () => {
    expect(speciesMatchesExcludingTempPressure(row!, tegnae1a, { surfacePressureAtm: 0 }).ok).toBe(true);
  });

  it("does not fit the same body without volcanism", () => {
    const quiet = { ...tegnae1a, Volcanism: "" } as PlanetScan;
    expect(speciesMatchesExcludingTempPressure(row!, quiet, { surfacePressureAtm: 0 }).ok).toBe(false);
  });
});
