/**
 * A measured ceiling on the body's own orbit, which demotes and never hides.
 *
 * Concha labiata grows on close moons: 97 % of its 1,927 carbon-dioxide bodies are moons, 98.3 %
 * of those within 12.6 ls of their planet, and only 11 orbit a star directly. Concha renibus shares
 * its climate at 180–190 K and is a star-orbiting planet on 22 % of its bodies there. At 20 ls the
 * ceiling takes labiata off 196 renibus slots and moves 16 of labiata's own behind "show unlikely".
 */
import { describe, expect, it } from "vitest";
import { buildCriterionFromRecord } from "../src/server/speciesTreeLoader.js";
import { resolvePlanetTemperatureBand, speciesMatchesCriteria } from "../src/server/matchSpecies.js";
import { estimatedTemperatureRangeForScan } from "../src/server/planetTemperature.js";
import { unrecognisedConditionKeys } from "../src/server/conditionKeyAudit.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import { evaluateHostStarGate } from "../src/shared/hostStarGates.js";
import type { PlanetScan, SpeciesEntry } from "../src/shared/types.js";

const LS = 299_792_458;

describe("soft_max_semi_major_axis_ls", () => {
  it("is read by the loader and known to the audit", () => {
    expect(buildCriterionFromRecord({ soft_max_semi_major_axis_ls: 20 }).softMaxSemiMajorAxisLs).toBe(20);
    expect(unrecognisedConditionKeys({ soft_max_semi_major_axis_ls: 20 })).toEqual([]);
  });

  const db = loadSpeciesDatabase() as unknown as { species: SpeciesEntry[] };
  const labiata = db.species.find((e) => e.id === "concha_concha_labiata")!;
  const body = (smaLs: number | undefined): PlanetScan => ({
    BodyName: "Test 1 a",
    BodyID: 1,
    StarSystem: "Test",
    SystemAddress: 1,
    PlanetClass: "Rocky body",
    Atmosphere: "thin carbon dioxide atmosphere",
    AtmosphereType: "CarbonDioxide",
    SurfaceGravity: 0.1 * 9.80665,
    SurfaceTemperature: 170,
    SurfacePressure: 1000,
    Landable: true,
    ...(smaLs === undefined ? {} : { SemiMajorAxis: smaLs * LS }),
  });
  const judge = (smaLs: number | undefined) => {
    const scan = body(smaLs);
    const est = estimatedTemperatureRangeForScan(scan);
    return speciesMatchesCriteria(labiata, scan, resolvePlanetTemperatureBand(scan, est), est, null);
  };

  it("ships on labiata at 28 ls (2026-10-09: 99.9 % of 26,489 labiata moons in a year of EDDN)", () => {
    expect(labiata.criteria.softMaxSemiMajorAxisLs).toBe(28);
  });

  const withParents = (smaLs: number, parents: Record<string, number>[]) => {
    const scan = { ...body(smaLs), Parents: parents } as PlanetScan;
    const est = estimatedTemperatureRangeForScan(scan);
    return speciesMatchesCriteria(labiata, scan, resolvePlanetTemperatureBand(scan, est), est, null);
  };

  it("demotes a moon past the ceiling, and keeps one inside it", () => {
    expect(withParents(35, [{ Planet: 3 }, { Star: 0 }]).softOnly).toBe(true);
    expect(withParents(25, [{ Planet: 3 }, { Star: 0 }]).ok).toBe(true);
    // A twin moon's barycentre is read through to the planet.
    expect(withParents(35, [{ Null: 4 }, { Planet: 3 }, { Star: 0 }]).softOnly).toBe(true);
  });

  it("keeps a planet round a star at a lower chance instead of demoting it (926 of 27,415 labiata bodies)", () => {
    const r = withParents(1200, [{ Star: 0 }]);
    expect(r.ok).toBe(true);
    expect(r.presenceFactor).toBeCloseTo(0.15);
    expect(r.reasons.some((x) => x.field === "Orbit")).toBe(true);
    expect(withParents(1200, [{ Null: 1 }, { Star: 0 }]).ok).toBe(true);
  });

  it("passes a close moon", () => {
    expect(judge(4).ok).toBe(true);
  });

  it("demotes a wide orbit when its parents are unknown — never hides it", () => {
    const r = judge(1200);
    expect(r.ok).toBe(false);
    expect(r.softOnly).toBe(true);
    expect(r.reasons.some((x) => x.field === "Orbit" && x.soft && /1\D?200 ls/.test(x.detail))).toBe(true);
  });

  it("abstains when the orbit is unknown", () => {
    expect(judge(undefined).ok).toBe(true);
  });
});

describe("labiata's host-star gate", () => {
  it("fails an M host and passes every other class, an unknown one and a mixed M + K pair", () => {
    expect(evaluateHostStarGate("concha_concha_labiata", ["M"])?.passes).toBe(false);
    for (const c of ["F", "G", "K", "A", "N", "Y", "L"]) expect(evaluateHostStarGate("concha_concha_labiata", [c])?.passes, c).toBe(true);
    expect(evaluateHostStarGate("concha_concha_labiata", ["M", "K"])?.passes).toBe(true);
    expect(evaluateHostStarGate("concha_concha_labiata", [])).toBeNull();
    expect(evaluateHostStarGate("concha_concha_renibus", ["M"])).toBeNull();
  });
});
