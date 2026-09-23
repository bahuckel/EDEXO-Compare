/**
 * A species' pressure range, read in the unit the row writes and never used to hide a plant.
 *
 * Osseus discus and spiralis are the pair that asked for it: discus above ~0.01 atm on 99 % of
 * 1,263 bodies, spiralis below it on 99 % of 1,767. Two things had to be true before a row could
 * say so:
 *
 *  - **atmospheres, whatever the scan speaks.** A journal `Scan` writes pascals; a body hydrated
 *    from EDSM or Spansh arrives in atmospheres. Compared raw, a 0.005 atm journal body reads "506"
 *    and clears any minimum, so the gate could only fire on hydrated data;
 *  - **soft on every miss.** The 1 % on the wrong side are real plants. A hard gate hid them.
 */
import { describe, expect, it } from "vitest";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import { resolvePlanetTemperatureBand, speciesMatchesCriteria } from "../src/server/matchSpecies.js";
import { estimatedTemperatureRangeForScan } from "../src/server/planetTemperature.js";
import type { PlanetScan, SpeciesEntry } from "../src/shared/types.js";

const db = loadSpeciesDatabase() as unknown as { species: SpeciesEntry[] };
const discus = db.species.find((e) => e.id === "osseus_osseus_discus")!;
/** Discus as a row with a pressure floor, whatever the shipped row says today. */
const withFloor: SpeciesEntry = { ...discus, criteria: { ...discus.criteria, surfacePressure: { min: 0.009 } } };

function waterWorld(surfacePressure: number): PlanetScan {
  return {
    BodyName: "Test 1 a",
    BodyID: 1,
    StarSystem: "Test",
    SystemAddress: 1,
    PlanetClass: "Rocky body",
    Atmosphere: "thin water atmosphere",
    AtmosphereType: "Water",
    SurfaceGravity: 0.1 * 9.80665,
    SurfaceTemperature: 420,
    SurfacePressure: surfacePressure,
    Landable: true,
  };
}
const judge = (scan: PlanetScan) => {
  const est = estimatedTemperatureRangeForScan(scan);
  return speciesMatchesCriteria(withFloor, scan, resolvePlanetTemperatureBand(scan, est), est, null);
};
const pressureFailures = (scan: PlanetScan) => judge(scan).reasons.filter((r) => r.field === "SurfacePressure" && !judge(scan).ok);

describe("the pressure range", () => {
  it("reads a journal scan's pascals as atmospheres", () => {
    // 1,520 Pa is 0.015 atm: above the floor. Compared raw it passed for the wrong reason; now for the right one.
    expect(judge(waterWorld(1520)).ok).toBe(true);
    // 506 Pa is 0.005 atm: below it. Compared raw, "506 ≥ 0.009" let it through.
    expect(judge(waterWorld(506)).ok).toBe(false);
  });

  it("reads a hydrated body's atmospheres as they are", () => {
    expect(judge(waterWorld(0.015)).ok).toBe(true);
    expect(judge(waterWorld(0.005)).ok).toBe(false);
  });

  it("demotes a body on the wrong side, however far — it never hides it", () => {
    for (const p of [0.008, 0.001, 101]) {
      const f = pressureFailures(waterWorld(p));
      expect(f.length, `${p}`).toBe(1);
      expect(f[0]!.soft, `${p}`).toBe(true);
      expect(judge(waterWorld(p)).softOnly, `${p}`).toBe(true);
    }
  });
});
