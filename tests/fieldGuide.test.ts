/**
 * The Encyclopedia's field guide (owner, 2026-09-29): the website's species-guide builder, run on
 * this install's files, and the body readings placed on its charts.
 */
import { describe, expect, it } from "vitest";
import { buildGuideGenus, guideBodyName, guideMeasured, guideStarClass } from "../src/shared/fieldGuide.js";
import { guideBodyFrom } from "../src/client/FieldGuide.js";
import { buildFieldGuide } from "../src/server/fieldGuide.js";
import { buildEncyclopediaPayload, getCachedSpeciesDatabase } from "../src/server/snapshot.js";
import { getProjectRoot } from "../src/server/paths.js";
import type { PlanetScan } from "../src/shared/types.js";

describe("field guide", () => {
  it("covers every species the app knows, with charts for the measured ones", () => {
    buildEncyclopediaPayload();
    const db = getCachedSpeciesDatabase();
    const guide = buildFieldGuide(getProjectRoot(), db);
    const ids = new Set(guide.genera.flatMap((g) => g.species.map((s) => s.id)));
    for (const e of db.species) expect(ids.has(e.id)).toBe(true);
    const arcus = guide.genera.find((g) => g.id === "aleoida")!.species.find((s) => s.name === "Aleoida arcus")!;
    const t = arcus.measured!.hist["body.surfaceTemperature"]!;
    expect(t.min).toBeGreaterThanOrEqual(170);
    expect(t.max).toBeLessThan(190);
    expect(t.counts).toHaveLength(16);
    expect(arcus.requires.some((r) => r.label === "Temperature")).toBe(true);
    // Built once per species database.
    expect(buildFieldGuide(getProjectRoot(), db)).toBe(guide);
  });

  it("reads the published conditions and profile shares the way the website does", () => {
    const g = buildGuideGenus(
      "x",
      {
        genus: "Xenus",
        meta: { minSampleDistanceM: 150, genusWideRequirements: { max_gravity: 0.27 } },
        species: [
          {
            id: "x_1",
            displayName: "Xenus one",
            conditions: { temperature_K: [175, 999], planet_types: ["Rocky body"], minPressure: 0.02 },
          },
        ],
      },
      () => ({
        provenance: { bodies: 10 },
        numerics: { "body.axialTilt": { min: -1, max: 1, mode: 0.5, count: 10 } },
        displayHistograms: { "body.axialTilt": { min: -1, max: 1, counts: [1, 2, 3] } },
        categorical: { "body.subType": { "Rocky body": 7, "Icy body": 3 }, "exo.host_star_spectral_primary": { K2: 4, K5: 2, DA: 1 } },
      }),
    );
    expect(g.requires).toEqual([{ label: "Gravity", text: "up to 0.27 g" }]);
    const s = g.species[0]!;
    expect(s.requires).toEqual([
      { label: "Body", text: "Rocky body" },
      { label: "Temperature", text: "at least 175 K" },
      { label: "Pressure", text: "at least 0.02 atm" },
    ]);
    // Radians to degrees; star classes and body names folded as on the site.
    expect(s.measured!.hist["body.axialTilt"]!.mode).toBeCloseTo(28.65, 1);
    expect(s.measured!.planet).toEqual([
      { label: "Rocky", n: 7 },
      { label: "Icy", n: 3 },
    ]);
    expect(s.measured!.star).toEqual([
      { label: "K", n: 6 },
      { label: "White dwarf", n: 1 },
    ]);
    expect(guideMeasured({ provenance: { bodies: 0 } })).toBeNull();
    expect(guideBodyName("High metal content body")).toBe("High metal content");
    expect(guideStarClass("F3")).toBe("F");
  });

  it("puts the journal's body on the guide's scales and units", () => {
    const scan = {
      BodyName: "B 6 a",
      BodyID: 1,
      StarSystem: "B",
      SystemAddress: 1,
      PlanetClass: "Rocky body",
      Atmosphere: "thin water atmosphere",
      Volcanism: "",
      SurfaceGravity: 0.4707,
      SurfaceTemperature: 434.3,
      SurfacePressure: 8106,
      radius: 416_000,
      SemiMajorAxis: 2.7e8,
      OrbitalPeriod: 558_000,
      AxialTilt: Math.PI / 4,
      composition: { Rock: 0.9, Metal: 0.1 },
      atmosphereComposition: [{ Name: "Water", Percent: 100 }],
      materials: [{ Name: "iron", Percent: 19.5 }],
      distanceFromArrivalLs: 2404,
    } as PlanetScan;
    const b = guideBodyFrom(scan, null, { parentStarType: "K3" }, "6 a")!;
    expect(b.values["body.gravity"]).toBeCloseTo(0.048, 3);
    expect(b.values["body.surfacePressure"]).toBeCloseTo(0.08, 2);
    expect(b.values["body.radius"]).toBe(416);
    expect(b.values["body.orbitalPeriod"]).toBeCloseTo(6.46, 2);
    expect(b.values["body.axialTilt"]).toBeCloseTo(45, 5);
    expect(b.values["body.solidComposition.Rock"]).toBeCloseTo(90, 5);
    expect(b.values["body.atmosphereComposition.Water"]).toBe(100);
    expect(b.materials.Iron).toBe(19.5);
    expect(b.planet).toBe("Rocky");
    expect(b.volcanism).toBe("No volcanism");
    expect(b.star).toBe("K");
  });
});
