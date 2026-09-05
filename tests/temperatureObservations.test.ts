import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlanetScan, SpeciesDatabase, SpeciesEntry } from "../src/shared/types.js";
import {
  MIN_TEMPERATURE_OBSERVATIONS,
  observedAtTemperature,
  setTemperatureObservationsRootForTests,
} from "../src/server/speciesTemperatureObservations.js";
import { clearExomasteryProfileCache } from "../src/server/exomasteryProfile.js";
import { matchDatabaseToScan, shownSpeciesMatches } from "../src/server/matchSpecies.js";

let root: string;

/**
 * 100…500 K in sixteen bins of 25 K. `hot` fills the top bins, `cold` the bottom ones, and the
 * middle is left empty on purpose — a species seen at 110 K and at 480 K has not thereby been seen
 * at 300 K, which is the whole reason this asks the histogram rather than the min and max.
 */
function counts(fill: (binLowK: number) => number): number[] {
  return Array.from({ length: 16 }, (_, i) => fill(100 + i * 25));
}

const HOT = counts((k) => (k >= 425 ? 40 : k <= 125 ? 30 : 0));

function species(id: string, genus: string, histogram: number[], codexMaxK: number): SpeciesEntry {
  const entry = {
    id,
    displayName: id,
    genus,
    genusDataDir: genus,
    criteria: { planetClassAnyOf: ["Rocky body"], surfaceTemperatureK: { min: 100, max: codexMaxK } },
  } as unknown as SpeciesEntry;

  const dir = path.join(root, "data", "species", genus, "exomastery");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${id}_exomastery.json`),
    JSON.stringify({
      formatVersion: 1,
      speciesLabel: id,
      genus,
      sampleCount: histogram.reduce((a, b) => a + b, 0),
      numerics: { "body.surfaceTemperature": { min: 100, max: 500, mean: 300, count: 200 } },
      materials: {},
      atmosphereComposition: {},
      solidComposition: {},
      categorical: {},
      displayHistograms: { "body.surfaceTemperature": { min: 100, max: 500, counts: histogram } },
    }),
    "utf8",
  );
  return entry;
}

function scanAt(kelvin: number): PlanetScan {
  return {
    PlanetClass: "Rocky body",
    Landable: true,
    SurfaceTemperature: kelvin,
  } as unknown as PlanetScan;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "edexo-temp-"));
  setTemperatureObservationsRootForTests(root);
  clearExomasteryProfileCache();
});

afterEach(() => {
  setTemperatureObservationsRootForTests(null);
  clearExomasteryProfileCache();
  rmSync(root, { recursive: true, force: true });
});

/**
 * The miss log's remaining absences: Fungoida stabitis, codex band 180–195 K, found nine times above
 * 424 K, with 945 observed bodies spanning 79–467 K.
 */
describe("observedAtTemperature", () => {
  it("reports a temperature the corpus has clustered observations at", () => {
    const e = species("hot", "fungoida", HOT, 195);
    const o = observedAtTemperature(e, 440)!;
    expect(o.observations).toBe(40);
    expect(o.binLowK).toBeLessThanOrEqual(440);
    expect(o.binHighK).toBeGreaterThan(440);
  });

  /** Between two extremes is not the same as at every temperature between them (§24.3). */
  it("says nothing about a gap between two clusters", () => {
    const e = species("hot", "fungoida", HOT, 195);
    expect(observedAtTemperature(e, 300)).toBeNull();
  });

  it("says nothing below the floor, or outside the observed range entirely", () => {
    const thin = species(
      "thin",
      "fungoida",
      counts((k) => (k >= 425 ? MIN_TEMPERATURE_OBSERVATIONS - 1 : 0)),
      195,
    );
    expect(observedAtTemperature(thin, 440)).toBeNull();

    const e = species("hot", "fungoida", HOT, 195);
    expect(observedAtTemperature(e, 900)).toBeNull();
    expect(observedAtTemperature(e, null)).toBeNull();
  });
});

describe("the temperature gate in the matcher", () => {
  it("keeps a species at a temperature the corpus has watched it grow at", () => {
    const db = { species: [species("hot", "fungoida", HOT, 195)] } as SpeciesDatabase;
    const { matches } = matchDatabaseToScan(db, scanAt(440), null, null, { includeBacterium: true });
    expect(shownSpeciesMatches(matches)).toHaveLength(1);
  });

  /**
   * Temperature is the last hard wall of the five main factors, and it stays one where the corpus
   * has nothing to say — this only ever hands back rows the observations vouch for.
   */
  it("still excludes a temperature nothing has observed it at", () => {
    const db = { species: [species("hot", "fungoida", HOT, 195)] } as SpeciesDatabase;
    const { matches } = matchDatabaseToScan(db, scanAt(300), null, null, { includeBacterium: true });
    expect(matches).toHaveLength(0);
  });

  it("leaves a body inside the codex band alone", () => {
    const db = { species: [species("hot", "fungoida", HOT, 195)] } as SpeciesDatabase;
    const { matches } = matchDatabaseToScan(db, scanAt(120), null, null, { includeBacterium: true });
    expect(shownSpeciesMatches(matches)).toHaveLength(1);
  });
});
