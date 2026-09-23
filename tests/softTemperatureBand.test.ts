/**
 * A measured temperature band that demotes and never hides.
 *
 * The codex band is a wall: outside it by more than 2 % a row is removed. That is right for a band
 * the codex states and wrong for one the record shows — Concha labiata's codex ceiling is 195 K,
 * 99 % of its 1,928 bodies sit at or below 190 K, and the 1 % above are real plants. Written as a
 * codex 190 the gate hid seven of them; written as `soft_temperature_K` it demotes them with the
 * reason shown, and still takes labiata off the 190–195 K bodies where renibus lives.
 */
import { describe, expect, it } from "vitest";
import { buildCriterionFromRecord } from "../src/server/speciesTreeLoader.js";
import { resolvePlanetTemperatureBand, speciesMatchesCriteria } from "../src/server/matchSpecies.js";
import { estimatedTemperatureRangeForScan } from "../src/server/planetTemperature.js";
import { unrecognisedConditionKeys } from "../src/server/conditionKeyAudit.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import type { PlanetScan, SpeciesEntry } from "../src/shared/types.js";

describe("soft_temperature_K", () => {
  it("is read by the loader and known to the audit", () => {
    const c = buildCriterionFromRecord({ soft_temperature_K: { max: 190 } });
    expect(c.softTemperatureK).toEqual({ min: undefined, max: 190 });
    expect(unrecognisedConditionKeys({ soft_temperature_K: { max: 190 } })).toEqual([]);
  });

  const db = loadSpeciesDatabase() as unknown as { species: SpeciesEntry[] };
  const labiata = db.species.find((e) => e.id === "concha_concha_labiata")!;
  const withBand: SpeciesEntry = { ...labiata, criteria: { ...labiata.criteria, softTemperatureK: { max: 190 } } };
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
  const judge = (kelvin: number) => {
    const scan = co2(kelvin);
    const est = estimatedTemperatureRangeForScan(scan);
    return speciesMatchesCriteria(withBand, scan, resolvePlanetTemperatureBand(scan, est), est, null);
  };

  it("passes inside the measured band", () => {
    expect(judge(185).ok).toBe(true);
  });

  it("demotes outside it, inside the codex band — never hides", () => {
    const r = judge(193);
    expect(r.ok).toBe(false);
    expect(r.softOnly).toBe(true);
    expect(r.reasons.some((x) => x.field === "SurfaceTemperature" && x.soft && /above 190/.test(x.detail))).toBe(true);
  });
});
