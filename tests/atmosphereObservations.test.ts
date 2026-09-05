import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlanetScan, SpeciesDatabase, SpeciesEntry } from "../src/shared/types.js";
import {
  MIN_ATMOSPHERE_OBSERVATIONS,
  NO_ATMOSPHERE,
  atmosphereObservationKey,
  observedUnderAtmosphere,
  setAtmosphereObservationsRootForTests,
} from "../src/server/speciesAtmosphereObservations.js";
import { clearExomasteryProfileCache } from "../src/server/exomasteryProfile.js";
import { matchDatabaseToScan, shownSpeciesMatches } from "../src/server/matchSpecies.js";

let root: string;

/**
 * The corpus prefixes pressure and heat onto the composition — `Thin Water`, `Hot thin Carbon
 * dioxide` — where the journal reports the composition alone. Both are other questions.
 */
describe("atmosphereObservationKey", () => {
  it("drops the pressure and heat adjectives", () => {
    expect(atmosphereObservationKey("Thin Water")).toBe(atmosphereObservationKey("Water"));
    expect(atmosphereObservationKey("Hot thin Carbon dioxide")).toBe(
      atmosphereObservationKey("CarbonDioxide"),
    );
    expect(atmosphereObservationKey("Thick Ammonia")).toBe(atmosphereObservationKey("Ammonia"));
  });

  it("gives airless bodies one key from either vocabulary", () => {
    expect(atmosphereObservationKey("")).toBe(NO_ATMOSPHERE);
    expect(atmosphereObservationKey(null)).toBe(NO_ATMOSPHERE);
    expect(atmosphereObservationKey("No atmosphere")).toBe(NO_ATMOSPHERE);
  });

  it("keeps different compositions apart", () => {
    expect(atmosphereObservationKey("Thin Methane")).not.toBe(atmosphereObservationKey("Thin Water"));
  });
});

/** Osseus discus: codex lists Water, 626 of its 645 observed bodies are it, 14 are Methane. */
const DISCUS = {
  "Thin Water": 626,
  "Thin Methane": 14,
  "Hot thin Carbon dioxide": 1,
  "Thin Carbon dioxide": 1,
  "Thin Ammonia": 3,
};

function species(id: string, genus: string, atmos: Record<string, number>, codex: string[]): SpeciesEntry {
  const entry = {
    id,
    displayName: id,
    genus,
    genusDataDir: genus,
    criteria: { planetClassAnyOf: ["Rocky body"], atmosphereTypeAnyOf: codex },
  } as unknown as SpeciesEntry;

  const dir = path.join(root, "data", "species", genus, "exomastery");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${id}_exomastery.json`),
    JSON.stringify({
      formatVersion: 1,
      speciesLabel: id,
      genus,
      sampleCount: Object.values(atmos).reduce((a, b) => a + b, 0),
      numerics: { "body.gravity": { min: 0.1, max: 0.3, mean: 0.2, count: 40 } },
      materials: {},
      atmosphereComposition: {},
      solidComposition: {},
      categorical: { "body.atmosphereType": atmos },
    }),
    "utf8",
  );
  return entry;
}

function scanWith(atmosphere: string): PlanetScan {
  return { PlanetClass: "Rocky body", Landable: true, AtmosphereType: atmosphere } as unknown as PlanetScan;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "edexo-atmo-"));
  setAtmosphereObservationsRootForTests(root);
  clearExomasteryProfileCache();
});

afterEach(() => {
  setAtmosphereObservationsRootForTests(null);
  clearExomasteryProfileCache();
  rmSync(root, { recursive: true, force: true });
});

describe("observedUnderAtmosphere", () => {
  it("counts the tail the codex row does not name", () => {
    const o = observedUnderAtmosphere(species("discus", "osseus", DISCUS, ["Water"]), "Methane")!;
    expect(o.observations).toBe(14);
    expect(o.total).toBe(645);
    expect(o.label).toBe("Thin Methane");
  });

  it("adds up the pressure and heat variants of one composition", () => {
    const o = observedUnderAtmosphere(species("discus", "osseus", DISCUS, ["Water"]), "CarbonDioxide");
    expect(o).toBeNull(); // two bodies, well under the floor
    const o2 = observedUnderAtmosphere(
      species("wide", "osseus", { "Hot thin Carbon dioxide": 6, "Thin Carbon dioxide": 6 }, ["Water"]),
      "CarbonDioxide",
    )!;
    expect(o2.observations).toBe(12);
  });

  it("says nothing below the floor", () => {
    const thin = species(
      "thin",
      "osseus",
      { "Thin Water": 600, "Thin Methane": MIN_ATMOSPHERE_OBSERVATIONS - 1 },
      ["Water"],
    );
    expect(observedUnderAtmosphere(thin, "Methane")).toBeNull();
  });
});

describe("the atmosphere gate in the matcher", () => {
  it("keeps a species under an atmosphere the corpus has watched it grow in", () => {
    const db = { species: [species("discus", "osseus", DISCUS, ["Water"])] } as SpeciesDatabase;
    const { matches } = matchDatabaseToScan(db, scanWith("Thin Methane"), null, null, {
      includeBacterium: true,
    });
    expect(shownSpeciesMatches(matches)).toHaveLength(1);
    expect(matches[0]!.unlikely).toBeUndefined();
  });

  /**
   * The allow-list rejects only 0.33 % of observed habitats (§6), so it stays in charge wherever the
   * corpus is silent — this is the most cautious of the six rescues, not a widening.
   */
  it("still demotes an atmosphere nothing has observed it under", () => {
    const db = {
      species: [species("picky", "osseus", { "Thin Water": 640 }, ["Water"])],
    } as SpeciesDatabase;
    const { matches } = matchDatabaseToScan(db, scanWith("Thin Methane"), null, null, {
      includeBacterium: true,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.unlikely).toBe(true);
    expect(shownSpeciesMatches(matches)).toHaveLength(0);
  });

  it("leaves an atmosphere the codex already allows alone", () => {
    const db = { species: [species("discus", "osseus", DISCUS, ["Water"])] } as SpeciesDatabase;
    const { matches } = matchDatabaseToScan(db, scanWith("Thin Water"), null, null, {
      includeBacterium: true,
    });
    expect(shownSpeciesMatches(matches)).toHaveLength(1);
  });
});
