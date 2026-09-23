/**
 * An observation bin that straddles a codex temperature edge says nothing about which side is home.
 *
 * Stratum cucumisis's codex floor is 190 K. Its display bin 180–198 K held 175 sightings, but its own
 * bodies sit at 191 K and above on 99.7 % of 312 — and the bin was admitting it on every 180–189 K
 * body, where excutitus and limaxus live. The fine histogram, cut on global edges that are dense
 * exactly here, decides a straddling bin instead: sightings within a few kelvin of the body, on the
 * body's side of the edge.
 *
 * The same rule must not cost a real find. Stratum paleas at 162.1 K — the commander's own, below a
 * codex floor of 165 K — sits beside 33 bodies recorded at 162.6–165 K and stays shown.
 */
import { describe, expect, it } from "vitest";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import { resolvePlanetTemperatureBand, speciesMatchesCriteria } from "../src/server/matchSpecies.js";
import { estimatedTemperatureRangeForScan } from "../src/server/planetTemperature.js";
import { MIN_TEMPERATURE_OBSERVATIONS, observedNearTemperature } from "../src/server/speciesTemperatureObservations.js";
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
    SurfaceGravity: 0.1 * 9.80665,
    SurfaceTemperature: kelvin,
    SurfacePressure: 1000,
    Landable: true,
  };
}
const judge = (id: string, scan: PlanetScan) => {
  const est = estimatedTemperatureRangeForScan(scan);
  return speciesMatchesCriteria(species(id), scan, resolvePlanetTemperatureBand(scan, est), est, null);
};

describe("sightings near a codex edge", () => {
  it("finds none of cucumisis below its floor, where excutitus lives", () => {
    const near = observedNearTemperature(species("stratum_stratum_cucumisis"), 184, { below: 190 });
    expect(near).not.toBeNull();
    expect(near!).toBeLessThan(MIN_TEMPERATURE_OBSERVATIONS);
  });

  it("finds paleas recorded just under its floor, beside the commander's own find", () => {
    const near = observedNearTemperature(species("stratum_stratum_paleas"), 162.1, { below: 165 });
    expect(near!).toBeGreaterThanOrEqual(MIN_TEMPERATURE_OBSERVATIONS);
  });
});

describe("the matcher, on a straddling bin", () => {
  it("demotes cucumisis at 184 K — softly, never hidden", () => {
    const r = judge("stratum_stratum_cucumisis", body(184, "SulphurDioxide"));
    expect(r.ok).toBe(false);
    expect(r.softOnly).toBe(true);
    expect(r.reasons.some((x) => x.field === "SurfaceTemperature" && x.soft)).toBe(true);
  });

  it("keeps paleas at 162.1 K shown", () => {
    expect(judge("stratum_stratum_paleas", body(162.1, "CarbonDioxide")).ok).toBe(true);
  });

  it("still rescues a bin wholly beyond the band — Fungoida stabitis on water above 424 K", () => {
    expect(judge("fungoida_fungoida_stabitis", body(430, "Water")).ok).toBe(true);
  });
});
