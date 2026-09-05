import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlanetScan, SpeciesDatabase, SpeciesEntry } from "../src/shared/types.js";
import {
  MIN_VOLCANISM_OBSERVATIONS,
  NO_VOLCANISM,
  observedWithVolcanism,
  setVolcanismObservationsRootForTests,
  volcanismKey,
} from "../src/server/speciesVolcanismObservations.js";
import { clearExomasteryProfileCache } from "../src/server/exomasteryProfile.js";
import { matchDatabaseToScan, shownSpeciesMatches } from "../src/server/matchSpecies.js";

let root: string;

/**
 * The game supplies the adjectives: EDSM writes `Minor Metallic Magma`, the journal writes
 * `metallic magma volcanism`, and they are one mechanism. Intensity is not part of the question.
 */
describe("volcanismKey", () => {
  it("drops the intensity and the noun", () => {
    expect(volcanismKey("Minor Metallic Magma")).toBe("metallic magma");
    expect(volcanismKey("Major Metallic Magma")).toBe("metallic magma");
    expect(volcanismKey("metallic magma volcanism")).toBe("metallic magma");
    expect(volcanismKey("major water geysers volcanism")).toBe("water geysers");
  });

  it("gives quiet ground one key from either vocabulary", () => {
    expect(volcanismKey("")).toBe(NO_VOLCANISM);
    expect(volcanismKey(null)).toBe(NO_VOLCANISM);
    expect(volcanismKey("No volcanism")).toBe(NO_VOLCANISM);
  });

  it("keeps different mechanisms apart", () => {
    expect(volcanismKey("Minor Water Magma")).not.toBe(volcanismKey("Minor Water Geysers"));
  });
});

function species(id: string, genus: string, volc: Record<string, number>, fragments: string[]): SpeciesEntry {
  const entry = {
    id,
    displayName: id,
    genus,
    genusDataDir: genus,
    criteria: { planetClassAnyOf: ["Rocky body"], volcanismIncludes: fragments },
  } as unknown as SpeciesEntry;

  const dir = path.join(root, "data", "species", genus, "exomastery");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${id}_exomastery.json`),
    JSON.stringify({
      formatVersion: 1,
      speciesLabel: id,
      genus,
      sampleCount: Object.values(volc).reduce((a, b) => a + b, 0),
      numerics: { "body.gravity": { min: 0.1, max: 0.3, mean: 0.2, count: 40 } },
      materials: {},
      atmosphereComposition: {},
      solidComposition: {},
      categorical: { "body.volcanismType": volc },
    }),
    "utf8",
  );
  return entry;
}

function scanWith(volcanism: string): PlanetScan {
  return { PlanetClass: "Rocky body", Landable: true, Volcanism: volcanism } as unknown as PlanetScan;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "edexo-volc-"));
  setVolcanismObservationsRootForTests(root);
  clearExomasteryProfileCache();
});

afterEach(() => {
  setVolcanismObservationsRootForTests(null);
  clearExomasteryProfileCache();
  rmSync(root, { recursive: true, force: true });
});

/** Fumerola extremus: codex wants silicate / iron / rock, 10 of its 43 bodies are metallic magma. */
describe("observedWithVolcanism", () => {
  const FUMEROLA = {
    "Major Silicate Vapour Geysers": 28,
    "Minor Metallic Magma": 6,
    "Metallic Magma": 3,
    "Major Metallic Magma": 1,
    "Minor Rocky Magma": 3,
  };

  it("counts every intensity of one mechanism together", () => {
    const e = species("extremus", "fumerola", FUMEROLA, ["silicate", "rock"]);
    const o = observedWithVolcanism(e, "metallic magma volcanism")!;
    expect(o.observations).toBe(10);
    expect(o.total).toBe(41);
  });

  it("says nothing below the floor", () => {
    const e = species("rare", "fumerola", { "Minor Metallic Magma": MIN_VOLCANISM_OBSERVATIONS - 1 }, [
      "silicate",
    ]);
    expect(observedWithVolcanism(e, "metallic magma volcanism")).toBeNull();
  });
});

describe("the volcanism gate in the matcher", () => {
  it("keeps a species on a volcanism the corpus has watched it grow with", () => {
    const db = {
      species: [
        species("extremus", "fumerola", { "Silicate Vapour Geysers": 28, "Minor Metallic Magma": 10 }, [
          "silicate",
        ]),
      ],
    } as SpeciesDatabase;
    const { matches } = matchDatabaseToScan(db, scanWith("metallic magma volcanism"), null, null, {
      includeBacterium: true,
    });
    expect(shownSpeciesMatches(matches)).toHaveLength(1);
  });

  it("still excludes a volcanism nothing has observed it with", () => {
    const db = {
      species: [species("picky", "fumerola", { "Silicate Vapour Geysers": 40 }, ["silicate"])],
    } as SpeciesDatabase;
    const { matches } = matchDatabaseToScan(db, scanWith("metallic magma volcanism"), null, null, {
      includeBacterium: true,
    });
    expect(matches).toHaveLength(0);
  });

  /**
   * The other half of the codex's claim — *that* there is volcanism — is deliberately left standing.
   * Overruling it found one more species and cost 0.96 candidates of ambiguity everywhere (§42).
   */
  it("does not hand back a species on quiet ground, however often it grows there", () => {
    const db = {
      species: [
        species("tela", "bacterium", { "No volcanism": 177, "Major Water Geysers": 7 }, ["silicate"]),
      ],
    } as SpeciesDatabase;
    const { matches } = matchDatabaseToScan(db, scanWith(""), null, null, { includeBacterium: true });
    expect(matches).toHaveLength(0);
  });
});
