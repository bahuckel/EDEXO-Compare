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

  it("ships on labiata at 20 ls", () => {
    expect(labiata.criteria.softMaxSemiMajorAxisLs).toBe(20);
  });

  it("passes a close moon", () => {
    expect(judge(4).ok).toBe(true);
  });

  it("demotes a planet round a star — never hides it", () => {
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
