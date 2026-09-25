/**
 * "Thin atmosphere" is a pressure ceiling, and 0 atm sits under every ceiling — so a species whose
 * only atmosphere rule was "thin" passed on an airless body. Fumerola extremus was offered as the one
 * certain genus on Tegnae HT-Z d13-1 1 a (Rocky body, AtmosphereType None, 0 atm), which grew Bark
 * Mounds. Its 231 recorded sightings are all on thin atmospheres.
 */
import { describe, expect, it } from "vitest";
import { speciesMatchesExcludingTempPressure } from "../src/server/matchSpecies.js";
import type { PlanetScan, SpeciesEntry } from "../src/shared/types.js";

function entry(criteria: Record<string, unknown>): SpeciesEntry {
  return {
    id: "probe_species",
    displayName: "Probe species",
    genus: "Probe",
    genusDataDir: "probe",
    criteria: { planetClassAnyOf: ["Rocky body"], ...criteria },
  } as unknown as SpeciesEntry;
}

/** The body from the report, trimmed to what the gates read. */
const tegnae: PlanetScan = {
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

const thinMethane: PlanetScan = {
  ...tegnae,
  Atmosphere: "thin methane atmosphere",
  AtmosphereType: "Methane",
  SurfacePressure: 3500,
} as unknown as PlanetScan;

const failsOn = (e: SpeciesEntry, scan: PlanetScan, atm: number) => {
  const r = speciesMatchesExcludingTempPressure(e, scan, { surfacePressureAtm: atm });
  return r.ok ? [] : r.reasons.filter((x) => !x.soft).map((x) => x.field);
};

describe("thin atmosphere on an airless body", () => {
  it("fails a species whose only atmosphere rule is thin (Fumerola extremus)", () => {
    expect(failsOn(entry({ atmospherePressureCategory: "thin" }), tegnae, 0)).toContain("SurfacePressure");
  });

  it("still passes that species on a thin atmosphere", () => {
    expect(failsOn(entry({ atmospherePressureCategory: "thin" }), thinMethane, 0.035)).toEqual([]);
  });

  it("leaves a species whose atmosphere list allows vacuum alone (Sinuous Tubers, Amphora)", () => {
    const tubers = entry({ atmospherePressureCategory: "thin", atmosphereTypeAnyOf: ["", "SulphurDioxide"] });
    expect(failsOn(tubers, tegnae, 0)).toEqual([]);
  });

  it("does not judge a body whose pressure is not known yet", () => {
    const r = speciesMatchesExcludingTempPressure(entry({ atmospherePressureCategory: "thin" }), tegnae, {});
    expect(r.ok).toBe(true);
  });
});
