import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SpeciesDatabase } from "../src/shared/types.js";
import { setFeederDataDirForTests } from "../src/feeder/paths.js";
import { writeFeederStatusSnapshot } from "../src/feeder/statusSnapshot.js";
import { buildFeederStatus } from "../src/server/feederStatus.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let corpus: string;
let appRoot: string;
let db: SpeciesDatabase;

/** A profile as the installer writes it: stamped with the app's own name for the species. */
function writeProfile(genus: string, file: string, speciesLabel: string, samples: number): void {
  const dir = path.join(appRoot, "data", "species", genus, "exomastery");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, file),
    JSON.stringify({
      formatVersion: 1,
      speciesLabel,
      genus,
      sampleCount: samples,
      numerics: { "body.gravity": { min: 0.1, max: 0.3, mean: 0.2, count: samples } },
      categorical: {},
      materials: {},
      atmosphereComposition: {},
      solidComposition: {},
    }),
    "utf8",
  );
}

beforeEach(() => {
  corpus = mkdtempSync(path.join(tmpdir(), "edexo-corpus-"));
  appRoot = mkdtempSync(path.join(tmpdir(), "edexo-app-"));
  setFeederDataDirForTests(corpus);
  for (const genus of ["stratum", "bacterium"]) {
    const dst = path.join(appRoot, "data", "species", genus);
    mkdirSync(dst, { recursive: true });
    writeFileSync(
      path.join(dst, `${genus}_new.json`),
      readFileSync(path.join(repoRoot, "data", "species", genus, `${genus}_new.json`)),
    );
  }
  if (!db) db = loadSpeciesDatabaseFromTree(repoRoot);
});

afterEach(() => {
  setFeederDataDirForTests(null);
  rmSync(corpus, { recursive: true, force: true });
  rmSync(appRoot, { recursive: true, force: true });
});

describe("buildFeederStatus", () => {
  it("reports itself unavailable when there is no corpus, so the panel hides", () => {
    setFeederDataDirForTests(path.join(corpus, "does-not-exist"));
    const s = buildFeederStatus(appRoot, db);
    expect(s.available).toBe(false);
    expect(s.behind).toEqual([]);
  });

  it("counts installed profiles from the app's own tree, without opening the store", () => {
    writeProfile("stratum", "stratum_tectonicas_exomastery.json", "Stratum tectonicas", 1280);
    writeProfile("bacterium", "bacterium_aurasus_exomastery.json", "Bacterium aurasus", 2797);

    const s = buildFeederStatus(appRoot, db);
    expect(s.available).toBe(true);
    expect(s.speciesRowsWithProfile).toBe(2);
    expect(s.speciesRows).toBe(db.species.length);
    expect(s.profileBytes).toBeGreaterThan(0);
    // No snapshot yet: corpus figures are simply absent rather than invented.
    expect(s.snapshot).toBeNull();
    expect(s.behind).toEqual([]);
  });

  it("names the profiles built from fewer bodies than the corpus holds", () => {
    writeProfile("stratum", "stratum_tectonicas_exomastery.json", "Stratum tectonicas", 1280);
    writeProfile("bacterium", "bacterium_aurasus_exomastery.json", "Bacterium aurasus", 2797);
    writeFeederStatusSnapshot({
      lastCommand: "status",
      uniqueSystems: 2993,
      uniquePlanets: 10371,
      uniqueSightings: 39088,
      corpusSpecies: 2,
      cumulativeCsvRows: 106819,
      // The corpus knows about more Bacterium bodies than the profile was built from; Stratum is
      // level. This is the state 72 of 79 shipped profiles were in before the merge.
      occurrencesBySpecies: { "Bacterium Aurasus": 4370, "Stratum Tectonicas": 1280 },
    });

    const s = buildFeederStatus(appRoot, db);
    expect(s.snapshot?.uniqueSightings).toBe(39088);
    expect(s.behindCount).toBe(1);
    expect(s.behind[0]).toEqual({
      species: "Bacterium aurasus",
      profileSamples: 2797,
      corpusOccurrences: 4370,
    });
    expect(s.behindOccurrences).toBe(4370 - 2797);
  });

  it("finds the corpus entry by species row, whatever the profile calls itself", () => {
    // The installer rewrites `speciesLabel` to the app's spelling, and the corpus keeps the Spansh
    // one. Matching those strings to each other is what a first version does, and it fails in the
    // one direction that matters: a profile whose name drifts looks up-to-date. Both sides resolve
    // through the same matcher instead.
    const dir = path.join(appRoot, "data", "species", "stratum", "exomastery");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "stratum_tectonicas_exomastery.json"),
      JSON.stringify({
        formatVersion: 1,
        speciesLabel: "Stratum tectonicas",
        sourceSpeciesLabel: "Stratum Tectonicas",
        genus: "Stratum",
        sampleCount: 100,
        numerics: { "body.gravity": { min: 0.1, max: 0.3, mean: 0.2, count: 100 } },
        categorical: {},
        materials: {},
        atmosphereComposition: {},
        solidComposition: {},
      }),
      "utf8",
    );
    writeFeederStatusSnapshot({
      lastCommand: "status",
      uniqueSystems: 1,
      uniquePlanets: 1,
      uniqueSightings: 1,
      corpusSpecies: 1,
      cumulativeCsvRows: 1,
      occurrencesBySpecies: { "Stratum Tectonicas": 1280 },
    });

    const s = buildFeederStatus(appRoot, db);
    expect(s.behindCount).toBe(1);
    expect(s.behind[0]?.corpusOccurrences).toBe(1280);
  });

  it("lists corpus species the app has no row for rather than attaching them to a near match", () => {
    writeFeederStatusSnapshot({
      lastCommand: "status",
      uniqueSystems: 1,
      uniquePlanets: 1,
      uniqueSightings: 1,
      corpusSpecies: 3,
      cumulativeCsvRows: 1,
      occurrencesBySpecies: {
        "Stratum Tectonicas": 10,
        "Croceum Anemone": 4,
        "Bark Mounds": 18,
      },
    });
    const s = buildFeederStatus(appRoot, db);
    expect(s.unmatchedCorpusLabels).toEqual(["Bark Mounds", "Croceum Anemone"]);
  });
});
