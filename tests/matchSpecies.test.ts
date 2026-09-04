import { beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import type { GenusHint, PlanetScan, SpeciesDatabase } from "../src/shared/types.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Real journal `Scan` lines, trimmed to the fields the matcher reads. Both are bodies the
 * commander has actually visited, so the expected species are the ones the game showed.
 */
const HMC_THIN_CO2: PlanetScan = {
  ScanType: "Detailed",
  BodyName: "Col 359 Sector FH-L d8-1 2",
  BodyID: 2,
  StarSystem: "Col 359 Sector FH-L d8-1",
  SystemAddress: 44753242555,
  DistanceFromArrivalLS: 1268.204971,
  TidalLock: false,
  TerraformState: "",
  PlanetClass: "High metal content body",
  Atmosphere: "thin carbon dioxide atmosphere",
  AtmosphereType: "CarbonDioxide",
  AtmosphereComposition: [
    { Name: "CarbonDioxide", Percent: 66.017136 },
    { Name: "SulphurDioxide", Percent: 33.98288 },
  ],
  Volcanism: "",
  MassEM: 0.048198,
  Radius: 2355967.25,
  SurfaceGravity: 3.460993,
  SurfaceTemperature: 163.069,
  SurfacePressure: 505.189514,
  Landable: true,
  SemiMajorAxis: 380207663774.49036,
} as unknown as PlanetScan;

const ROCKY_AIRLESS_VOLCANIC: PlanetScan = {
  ScanType: "AutoScan",
  BodyName: "Swoilz BY-D c1-13 3 a",
  BodyID: 22,
  StarSystem: "Swoilz BY-D c1-13",
  SystemAddress: 3657533690634,
  DistanceFromArrivalLS: 709.30131,
  TidalLock: false,
  TerraformState: "",
  PlanetClass: "Rocky body",
  Atmosphere: "",
  AtmosphereType: "None",
  Volcanism: "minor rocky magma volcanism",
  MassEM: 0.002577,
  Radius: 961115.4375,
  SurfaceGravity: 1.111762,
  SurfaceTemperature: 198.68132,
  SurfacePressure: 0,
  Landable: true,
  SemiMajorAxis: 614183205.366135,
} as unknown as PlanetScan;

const hint = (localised: string, codex: string): GenusHint => ({
  Genus: codex,
  Genus_Localised: localised,
});

let db: SpeciesDatabase;

beforeAll(() => {
  db = loadSpeciesDatabaseFromTree(projectRoot);
});

describe("species database on disk", () => {
  it("loads every genus folder with usable rows", () => {
    expect(db.species.length).toBeGreaterThan(50);
    for (const e of db.species) {
      expect(e.id).toBeTruthy();
      expect(e.displayName).toBeTruthy();
      expect(e.genusDataDir).toBeTruthy();
      expect(e.criteria).toBeTruthy();
    }
    expect(new Set(db.species.map((e) => e.id)).size).toBe(db.species.length);
  });
});

describe("matchDatabaseToScan", () => {
  it("predicts the right species on a thin-CO₂ high metal content body", () => {
    const r = matchDatabaseToScan(db, HMC_THIN_CO2, null, null, { includeBacterium: true });
    const ids = r.matches.map((m) => m.entry.id).sort();
    expect(ids).toEqual(["bacterium_bacterium_aurasus", "stratum_stratum_tectonicas"]);
    expect(r.approximateMatchingUsed).toBe(false);
    expect(r.genusFilterActive).toBe(false);
  });

  it("drops bacterium rows unless the setting asks for them", () => {
    const without = matchDatabaseToScan(db, HMC_THIN_CO2, null, null, { includeBacterium: false });
    expect(without.matches.map((m) => m.entry.id)).toEqual(["stratum_stratum_tectonicas"]);
  });

  it("only offers volcanism-gated genera on a volcanic airless body", () => {
    const r = matchDatabaseToScan(db, ROCKY_AIRLESS_VOLCANIC, null, null, { includeBacterium: true });
    expect(r.matches.length).toBeGreaterThan(0);
    const genera = new Set(r.matches.map((m) => m.entry.genusDataDir));
    expect([...genera].sort()).toEqual(["brain-tree", "fumerola"]);
  });

  it("gives every match at least one stated reason", () => {
    const r = matchDatabaseToScan(db, HMC_THIN_CO2, null, null, { includeBacterium: true });
    for (const m of r.matches) {
      expect(m.reasons.length).toBeGreaterThan(0);
      for (const reason of m.reasons) expect(reason.field).toBeTruthy();
    }
  });

  it("narrows to the genera the DSS reported", () => {
    const r = matchDatabaseToScan(
      db,
      HMC_THIN_CO2,
      [hint("Stratum", "$Codex_Ent_Stratum_Genus_Name;")],
      null,
      { includeBacterium: true },
    );
    expect(r.genusFilterActive).toBe(true);
    expect(r.dssGenusNarrowing).toBe(true);
    expect(r.matches.every((m) => m.entry.genusDataDir === "stratum")).toBe(true);
    expect(r.matches.length).toBeGreaterThan(0);
  });

  it("returns an estimated temperature band that brackets the journal reading", () => {
    const r = matchDatabaseToScan(db, HMC_THIN_CO2, null, null, {});
    expect(r.estimatedSurfaceTempK).not.toBeNull();
    const band = r.estimatedSurfaceTempK!;
    expect(band.minK).toBeLessThanOrEqual(band.midK);
    expect(band.midK).toBeLessThanOrEqual(band.maxK);
    expect(band.minK).toBeLessThan(HMC_THIN_CO2.SurfaceTemperature!);
    expect(band.maxK).toBeGreaterThan(HMC_THIN_CO2.SurfaceTemperature!);
  });

  it("is deterministic — the same scan matched twice gives the same rows", () => {
    const a = matchDatabaseToScan(db, HMC_THIN_CO2, null, null, { includeBacterium: true });
    const b = matchDatabaseToScan(db, HMC_THIN_CO2, null, null, { includeBacterium: true });
    expect(a.matches.map((m) => m.entry.id)).toEqual(b.matches.map((m) => m.entry.id));
  });

  it("finds nothing on a body that is too hot for anything in the database", () => {
    const scorched = {
      ...ROCKY_AIRLESS_VOLCANIC,
      Volcanism: "",
      SurfaceTemperature: 900,
      SurfaceGravity: 2,
    } as unknown as PlanetScan;
    const r = matchDatabaseToScan(db, scorched, null, null, { includeBacterium: true });
    expect(r.matches).toHaveLength(0);
  });

  /**
   * Characterisation, not endorsement: the Amphora Plant codex row gates on planet class and
   * atmosphere but not on temperature, so the matcher lists it on a 4,594 K metal-rich body. That
   * is the data speaking, and this test exists so that adding a temperature gate to the row is a
   * deliberate, visible change rather than a silent one.
   */
  it("still lists Amphora Plant on a scorching metal-rich body, because its row has no temperature gate", () => {
    const inferno = {
      ...ROCKY_AIRLESS_VOLCANIC,
      PlanetClass: "Metal rich body",
      Volcanism: "",
      SurfaceTemperature: 4593.768555,
      SurfaceGravity: 40.762663,
      Landable: false,
    } as unknown as PlanetScan;
    const r = matchDatabaseToScan(db, inferno, null, null, { includeBacterium: true });
    expect(r.matches.map((m) => m.entry.id)).toEqual(["amphora_amphora_plant"]);
    expect(
      db.species.find((e) => e.id === "amphora_amphora_plant")!.criteria.surfaceTemperatureK,
    ).toBeUndefined();
  });

  it("relaxes physical gates only when the DSS named a genus that would otherwise miss", () => {
    const hints = [hint("Stratum", "$Codex_Ent_Stratum_Genus_Name;")];
    const chilly = { ...HMC_THIN_CO2, SurfaceTemperature: 152 } as unknown as PlanetScan;

    const strict = matchDatabaseToScan(db, chilly, hints, null, {
      includeBacterium: true,
      dssPhysicalSlack: { temperature: 0, pressure: 0, gravity: 0 },
    });
    const slack = matchDatabaseToScan(db, chilly, hints, null, {
      includeBacterium: true,
      dssPhysicalSlack: { temperature: 0.25, pressure: 0.25, gravity: 0.25 },
    });
    expect(slack.matches.length).toBeGreaterThanOrEqual(strict.matches.length);
    // Slack never invents a genus the DSS did not report.
    expect(slack.matches.every((m) => m.entry.genusDataDir === "stratum")).toBe(true);
  });
});
