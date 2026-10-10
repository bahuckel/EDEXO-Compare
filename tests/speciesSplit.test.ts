/**
 * The fitted which-of-the-genus tables (owner, 2026-10-10: "build point 2"; speciesSplit.ts): only the
 * seven covered genera are re-split, a genus keeps its total chance, and a genus with a shown species
 * the table does not know is left as the model had it.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import type { PlanetScan, SpeciesMatch } from "../src/shared/types.js";
import { applySpeciesSplit, genusSplit, speciesSplitGenera, splitFacts } from "../src/server/speciesSplit.js";

const root = path.resolve(__dirname, "..");
const row = (id: string, genus: string, pct: number): SpeciesMatch =>
  ({ entry: { id, genus, genusDataDir: genus.toLowerCase() }, reasons: [], presenceProbabilityPercent: pct, genusSharePercent: null }) as unknown as SpeciesMatch;

// A thin CO2 rocky body, 170 K: Stratum's rocky group and Bacterium aurasus.
const scan = {
  PlanetClass: "Rocky body",
  Atmosphere: "thin carbon dioxide atmosphere",
  AtmosphereType: "CarbonDioxide",
  AtmosphereComposition: [{ Name: "CarbonDioxide", Percent: 100 }],
  Volcanism: "",
  SurfaceTemperature: 170,
  SurfaceGravity: 1.2,
  SurfacePressure: 2000,
  MassEM: 0.03,
  Radius: 2_000_000,
  DistanceFromArrivalLS: 800,
  Parents: [{ Star: 0 }],
} as unknown as PlanetScan;
const inputs = {
  scan,
  stars: [{ bodyId: 0, starType: "K", luminosity: "Va", subclass: 4, distanceFromArrivalLs: 0 }],
  coords: { x: 500, y: 20, z: 1500 },
  signals: 2,
  catalogue: null,
  root,
};

describe("species split", () => {
  it("covers the seven genera that ordered better on both hold-outs", () => {
    expect(speciesSplitGenera(root).sort()).toEqual(["Cactoida", "Clypeus", "Concha", "Electricae", "Fungoida", "Recepta", "Stratum"]);
  });

  it("shares a genus between its species, summing to one", () => {
    const s = genusSplit(root, "Stratum", splitFacts(inputs))!;
    const sum = [...s.values()].reduce((a, x) => a + x, 0);
    expect(sum).toBeCloseTo(1, 6);
    // HMC-only tectonicas is ruled out on a rocky body.
    expect(s.get("stratum_stratum_tectonicas")!).toBeLessThan(0.01);
  });

  it("reads the parents, the arrival distance and the radius off the record when the body's scan lacks them", () => {
    // The body state's scan keeps the matcher's fields; the app's first run read every host as unknown.
    const trimmed: Record<string, unknown> = { ...(scan as unknown as Record<string, unknown>) };
    for (const k of ["Parents", "DistanceFromArrivalLS", "Radius"]) delete trimmed[k];
    const rec = { bodyId: 3, parents: [{ Star: 0 }], distanceFromArrivalLs: 800, radius: 2_000_000 } as never;
    const withRec = splitFacts({ ...inputs, scan: trimmed as unknown as PlanetScan, rec });
    const full = splitFacts(inputs);
    expect(withRec.cat.host).toBe("K");
    expect(withRec.cat.parent).toBe("Star");
    expect(withRec.num.dist_ls).toBe(full.num.dist_ls);
    expect(withRec.num.radius_km).toBe(full.num.radius_km);
  });

  it("keeps each genus's total, re-splits only covered genera, and leaves a genus with an unknown species alone", () => {
    const m = [
      row("stratum_stratum_paleas", "Stratum", 30),
      row("stratum_stratum_excutitus", "Stratum", 10),
      row("bacterium_bacterium_aurasus", "Bacterium", 60),
      row("recepta_recepta_umbrux", "Recepta", 5),
      row("recepta_not_a_species", "Recepta", 5),
    ];
    const done = applySpeciesSplit(m, inputs);
    expect([...done]).toEqual(["Stratum"]);
    const stratum = m.filter((x) => x.entry.genus === "Stratum");
    expect(stratum.reduce((a, x) => a + x.presenceProbabilityPercent!, 0)).toBeCloseTo(40, 0);
    expect(stratum.reduce((a, x) => a + x.genusSharePercent!, 0)).toBeCloseTo(100, 0);
    expect(m[2]!.presenceProbabilityPercent).toBe(60);
    expect(m[3]!.presenceProbabilityPercent).toBe(5);
    expect(m[3]!.genusSharePercent).toBeNull();
  });
});
