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
  /**
   * Cucumisis is recorded at 191 K and above on 99.7 % of its bodies. Before the 2026-09-24 rebuild
   * its display histogram reached down to 184 K — padded by duplicate samples — and the straddle
   * check demoted it there. Rebuilt from every body once, nothing of it is recorded near 184 K, so
   * no observation speaks for it and the codex band (≥ 190 K, 2 % tolerance) decides: not shown. No
   * cucumisis truth in the replay is affected.
   */
  it("does not show cucumisis at 184 K, where nothing of it is recorded", () => {
    const r = judge("stratum_stratum_cucumisis", body(184, "SulphurDioxide"));
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.field === "SurfaceTemperature")).toBe(true);
  });

  it("keeps paleas at 162.1 K shown", () => {
    expect(judge("stratum_stratum_paleas", body(162.1, "CarbonDioxide")).ok).toBe(true);
  });

  it("still rescues a bin wholly beyond the band — Fungoida stabitis on water above 424 K", () => {
    expect(judge("fungoida_fungoida_stabitis", body(430, "Water")).ok).toBe(true);
  });
});

/**
 * A fine bin can straddle the codex edge too: the global edges land on one only at 165 K. Tussock
 * ignis (160–170 K) has 55 bodies in 169–171.7 K and none past 170 K; spread evenly they rescued it
 * beside serrati on 472 serrati bodies at 171–173 K. A straddling bin now counts only when the next
 * bin wholly beyond the edge holds a sighting — which Concha renibus has below 180 K on carbon
 * dioxide (4 at 174–177.5 K), and the commander's own renibus sits at 178 K.
 */
describe("a fine bin that straddles the edge", () => {
  it("credits ignis nothing above 170 K", () => {
    expect(observedNearTemperature(species("tussock_tussock_ignis"), 171.7, { above: 170 })).toBe(0);
  });

  it("demotes ignis at 171.7 K, where serrati grows", () => {
    const r = judge("tussock_tussock_ignis", body(171.7, "CarbonDioxide"));
    expect(r.ok).toBe(false);
    expect(r.softOnly).toBe(true);
  });

  it("still credits renibus just under its carbon-dioxide floor", () => {
    const near = observedNearTemperature(species("concha_concha_renibus"), 178, { below: 180 });
    expect(near!).toBeGreaterThanOrEqual(MIN_TEMPERATURE_OBSERVATIONS);
  });
});
