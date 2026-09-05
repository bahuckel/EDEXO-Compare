import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlanetScan, SpeciesDatabase, SpeciesEntry } from "../src/shared/types.js";
import {
  MIN_GRAVITY_OBSERVATIONS,
  observedAtGravity,
  setGravityObservationsRootForTests,
} from "../src/server/speciesGravityObservations.js";
import { clearExomasteryProfileCache } from "../src/server/exomasteryProfile.js";
import { matchDatabaseToScan, shownSpeciesMatches } from "../src/server/matchSpecies.js";

let root: string;

/**
 * Osseus pumice, rounded: codex ceiling 0.27 g, 99 observed bodies spanning 0.045…0.2728 g, and 22
 * of them in the top bin — the one that contains the 0.2725 g reading the codex row rejects.
 */
const PUMICE = { min: 0.045, max: 0.2728, counts: [8, 8, 7, 3, 5, 4, 7, 2, 2, 3, 2, 4, 5, 6, 11, 22] };

function species(id: string, genus: string, hist: typeof PUMICE, codexMaxG: number): SpeciesEntry {
  const entry = {
    id,
    displayName: id,
    genus,
    genusDataDir: genus,
    criteria: { planetClassAnyOf: ["Rocky body"], surfaceGravity: { max: codexMaxG } },
  } as unknown as SpeciesEntry;

  const dir = path.join(root, "data", "species", genus, "exomastery");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${id}_exomastery.json`),
    JSON.stringify({
      formatVersion: 1,
      speciesLabel: id,
      genus,
      sampleCount: hist.counts.reduce((a, b) => a + b, 0),
      numerics: { "body.gravity": { min: hist.min, max: hist.max, mean: 0.18, count: 99 } },
      materials: {},
      atmosphereComposition: {},
      solidComposition: {},
      categorical: {},
      displayHistograms: { "body.gravity": hist },
    }),
    "utf8",
  );
  return entry;
}

/** The journal reports m/s², the codex bands are in g. 2.67 m/s² is the 0.2725 g body from the log. */
function scanAt(metresPerSecondSquared: number): PlanetScan {
  return {
    PlanetClass: "Rocky body",
    Landable: true,
    SurfaceGravity: metresPerSecondSquared,
  } as unknown as PlanetScan;
}

const OVER_THE_EDGE = 2.67;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "edexo-grav-"));
  setGravityObservationsRootForTests(root);
  clearExomasteryProfileCache();
});

afterEach(() => {
  setGravityObservationsRootForTests(null);
  clearExomasteryProfileCache();
  rmSync(root, { recursive: true, force: true });
});

describe("observedAtGravity", () => {
  it("reports a reading the corpus has clustered observations at", () => {
    const o = observedAtGravity(species("pumice", "osseus", PUMICE, 0.27), 0.2725)!;
    expect(o.observations).toBe(22);
    expect(o.total).toBe(99);
    expect(o.binLowG).toBeLessThanOrEqual(0.2725);
    expect(o.binHighG).toBeGreaterThanOrEqual(0.2725);
  });

  it("says nothing below the floor", () => {
    const thin = { ...PUMICE, counts: [...PUMICE.counts.slice(0, 15), MIN_GRAVITY_OBSERVATIONS - 1] };
    expect(observedAtGravity(species("thin", "osseus", thin, 0.27), 0.2725)).toBeNull();
  });

  /** Tubus rosarium: eight observed bodies topping out at 0.1362 g, found at 0.1502 g. */
  it("says nothing beyond the range the corpus has actually watched", () => {
    const e = species("rosarium", "tubus", PUMICE, 0.27);
    expect(observedAtGravity(e, 0.4)).toBeNull();
    expect(observedAtGravity(e, null)).toBeNull();
  });
});

describe("the gravity gate in the matcher", () => {
  it("keeps a species at a gravity the corpus has watched it grow at", () => {
    const db = { species: [species("pumice", "osseus", PUMICE, 0.27)] } as SpeciesDatabase;
    const { matches } = matchDatabaseToScan(db, scanAt(OVER_THE_EDGE), null, null, {
      includeBacterium: true,
    });
    expect(shownSpeciesMatches(matches)).toHaveLength(1);
    expect(matches[0]!.unlikely).toBeUndefined();
  });

  /**
   * The demotion is what this replaces, so it has to still be there when the corpus is silent —
   * this only ever promotes rows the observations vouch for.
   */
  it("still demotes a reading nothing has observed it at", () => {
    const quiet = { ...PUMICE, max: 0.2, counts: PUMICE.counts.map(() => 1) };
    const db = { species: [species("rosarium", "tubus", quiet, 0.27)] } as SpeciesDatabase;
    const { matches } = matchDatabaseToScan(db, scanAt(OVER_THE_EDGE), null, null, {
      includeBacterium: true,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.unlikely).toBe(true);
    expect(shownSpeciesMatches(matches)).toHaveLength(0);
  });

  it("leaves a reading inside the codex band alone", () => {
    const db = { species: [species("pumice", "osseus", PUMICE, 0.27)] } as SpeciesDatabase;
    const { matches } = matchDatabaseToScan(db, scanAt(1.0), null, null, { includeBacterium: true });
    expect(shownSpeciesMatches(matches)).toHaveLength(1);
  });
});
