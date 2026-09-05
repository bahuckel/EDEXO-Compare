import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlanetScan, SpeciesDatabase, SpeciesEntry } from "../src/shared/types.js";
import { planetClassKey, planetClassMatches } from "../src/shared/planetClassKey.js";
import {
  MIN_CLASS_OBSERVATIONS,
  observedOnPlanetClass,
  setPlanetClassObservationsRootForTests,
} from "../src/server/speciesPlanetClassObservations.js";
import { clearExomasteryProfileCache } from "../src/server/exomasteryProfile.js";
import { matchDatabaseToScan, shownSpeciesMatches } from "../src/server/matchSpecies.js";

let root: string;

/**
 * Three vocabularies for five classes: the journal writes `High metal content body`, EDSM writes
 * `High metal content world`, and the codex rows write `High Metal Content`. §27 is what happens
 * when two of those are compared as free text.
 */
describe("planetClassKey", () => {
  it("collapses the three spellings of one class", () => {
    expect(planetClassKey("High metal content body")).toBe("high metal content");
    expect(planetClassKey("High metal content world")).toBe("high metal content");
    expect(planetClassKey("High Metal Content")).toBe("high metal content");
    expect(planetClassKey("Rocky Ice world")).toBe("rocky ice");
    expect(planetClassKey("Rocky ice body")).toBe("rocky ice");
  });

  it("keeps different classes apart", () => {
    expect(planetClassMatches("Rocky body", "Rocky ice body")).toBe(false);
    expect(planetClassMatches("Icy body", "High metal content world")).toBe(false);
    expect(planetClassMatches("", "Rocky body")).toBe(false);
    expect(planetClassMatches(null, null)).toBe(false);
  });
});

/** A species row plus the profile the feeder would have installed for it. */
function species(id: string, genus: string, classes: Record<string, number>, codex: string[]): SpeciesEntry {
  const entry = {
    id,
    displayName: id,
    genus,
    genusDataDir: genus,
    criteria: { planetClassAnyOf: codex, landable: true },
  } as unknown as SpeciesEntry;

  const dir = path.join(root, "data", "species", genus, "exomastery");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${id}_exomastery.json`),
    JSON.stringify({
      formatVersion: 1,
      speciesLabel: id,
      genus,
      sampleCount: Object.values(classes).reduce((a, b) => a + b, 0),
      numerics: { "body.gravity": { min: 0.1, max: 0.3, mean: 0.2, count: 40 } },
      materials: {},
      atmosphereComposition: {},
      solidComposition: {},
      categorical: { "body.subType": classes },
    }),
    "utf8",
  );
  return entry;
}

const HMC_SCAN = { PlanetClass: "High metal content body", Landable: true } as unknown as PlanetScan;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "edexo-planetclass-"));
  setPlanetClassObservationsRootForTests(root);
  clearExomasteryProfileCache();
});

afterEach(() => {
  setPlanetClassObservationsRootForTests(null);
  clearExomasteryProfileCache();
  rmSync(root, { recursive: true, force: true });
});

/**
 * The miss log's top finding: 15 species the commander found were demoted for a planet class the
 * corpus has watched them grow on hundreds of times. Observation overrules the codex row.
 */
describe("observedOnPlanetClass", () => {
  it("reports a class the corpus has seen the species on", () => {
    const e = species("wanderer", "tussock", { "Rocky body": 900, "High metal content world": 100 }, [
      "Rocky body",
    ]);
    const o = observedOnPlanetClass(e, "High metal content body")!;
    expect(o.observations).toBe(100);
    expect(o.share).toBeCloseTo(0.1, 6);
  });

  it("says nothing about a class seen too few times to overrule a codex row", () => {
    const e = species(
      "rare",
      "tussock",
      { "Rocky body": 900, "High metal content world": MIN_CLASS_OBSERVATIONS - 1 },
      ["Rocky body"],
    );
    expect(observedOnPlanetClass(e, "High metal content body")).toBeNull();
  });

  it("says nothing about a class never recorded, or a species with no profile", () => {
    const e = species("wanderer", "tussock", { "Rocky body": 900 }, ["Rocky body"]);
    expect(observedOnPlanetClass(e, "Icy body")).toBeNull();
    expect(observedOnPlanetClass(e, null)).toBeNull();
  });
});

describe("the planet class gate in the matcher", () => {
  it("keeps a species on a class the corpus has watched it grow on", () => {
    const db = {
      species: [
        species("wanderer", "tussock", { "Rocky body": 900, "High metal content world": 100 }, [
          "Rocky body",
        ]),
      ],
    } as SpeciesDatabase;
    const { matches } = matchDatabaseToScan(db, HMC_SCAN, null, null, { includeBacterium: true });
    expect(shownSpeciesMatches(matches)).toHaveLength(1);
    expect(matches[0]!.unlikely).toBeUndefined();
  });

  /** The codex row still decides where the corpus has nothing to say — it just no longer decides alone. */
  it("still demotes a species on a class nothing has observed it on", () => {
    const db = {
      species: [species("homebody", "tussock", { "Rocky body": 900 }, ["Rocky body"])],
    } as SpeciesDatabase;
    const { matches } = matchDatabaseToScan(db, HMC_SCAN, null, null, { includeBacterium: true });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.unlikely).toBe(true);
    expect(shownSpeciesMatches(matches)).toHaveLength(0);
  });

  it("leaves a species the codex already allows alone", () => {
    const db = {
      species: [
        species("native", "tussock", { "High metal content world": 900 }, ["High metal content body"]),
      ],
    } as SpeciesDatabase;
    const { matches } = matchDatabaseToScan(db, HMC_SCAN, null, null, { includeBacterium: true });
    expect(shownSpeciesMatches(matches)).toHaveLength(1);
  });
});
