/**
 * Two measured volcanism facts about Osseus, readable only since "No volcanism" stopped being dropped
 * by the EDSM/Spansh mapper:
 *
 *  - Discus leaves its codex water list only on volcanic ground: methane 44, ammonia 15, argon 3 —
 *    62 of 62 volcanic — while on water 938 bodies have no volcanism.
 *  - Spiralis is recorded on 1,552 bodies without volcanism and 2 with.
 *
 * Both demote and never hide, and both abstain when the scan carries no volcanism field at all.
 */
import { describe, expect, it } from "vitest";
import { buildCriterionFromRecord } from "../src/server/speciesTreeLoader.js";
import { resolvePlanetTemperatureBand, speciesMatchesCriteria } from "../src/server/matchSpecies.js";
import { estimatedTemperatureRangeForScan } from "../src/server/planetTemperature.js";
import { unrecognisedConditionKeys } from "../src/server/conditionKeyAudit.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import type { PlanetScan, SpeciesEntry } from "../src/shared/types.js";

const db = loadSpeciesDatabase() as unknown as { species: SpeciesEntry[] };
const species = (id: string) => db.species.find((e) => e.id === id)!;
const body = (atmosphere: string, volcanism: string | undefined): PlanetScan => ({
  BodyName: "Test 1 a",
  BodyID: 1,
  StarSystem: "Test",
  SystemAddress: 1,
  PlanetClass: "Rocky body",
  Atmosphere: `thin ${atmosphere.toLowerCase()} atmosphere`,
  AtmosphereType: atmosphere,
  SurfaceGravity: 0.05 * 9.80665,
  SurfaceTemperature: 150,
  SurfacePressure: 5000,
  Landable: true,
  ...(volcanism === undefined ? {} : { Volcanism: volcanism }),
});
const judge = (id: string, scan: PlanetScan) => {
  const est = estimatedTemperatureRangeForScan(scan);
  return speciesMatchesCriteria(species(id), scan, resolvePlanetTemperatureBand(scan, est), est, null);
};

describe("the loader and the audit", () => {
  it("read both keys", () => {
    const raw = { off_list_atmosphere_needs_volcanism: true, soft_no_volcanism: true };
    const c = buildCriterionFromRecord(raw);
    expect(c.offListAtmosphereNeedsVolcanism).toBe(true);
    expect(c.softNoVolcanism).toBe(true);
    expect(unrecognisedConditionKeys(raw)).toEqual([]);
  });
});

describe("Osseus discus off its water list", () => {
  it("keeps the methane rescue on a volcanic body", () => {
    expect(judge("osseus_osseus_discus", body("Methane", "minor rocky magma volcanism")).ok).toBe(true);
  });

  it("demotes it on a methane body with no volcanism — softly", () => {
    const r = judge("osseus_osseus_discus", body("Methane", ""));
    expect(r.ok).toBe(false);
    expect(r.softOnly).toBe(true);
    expect(r.reasons.some((x) => x.field === "AtmosphereType" && /volcanic/.test(x.detail))).toBe(true);
  });

  it("abstains when volcanism is unknown", () => {
    expect(judge("osseus_osseus_discus", body("Methane", undefined)).ok).toBe(true);
  });
});

describe("Osseus spiralis", () => {
  it("is shown without volcanism and demoted, never hidden, with it", () => {
    // 165 K: inside spiralis' observed 160-224 K, so only the volcanism can speak.
    const at165 = (v: string) => ({ ...body("Ammonia", v), SurfaceTemperature: 165 });
    expect(judge("osseus_osseus_spiralis", at165("")).ok).toBe(true);
    const r = judge("osseus_osseus_spiralis", at165("minor rocky magma volcanism"));
    expect(r.ok).toBe(false);
    expect(r.softOnly).toBe(true);
  });
});
