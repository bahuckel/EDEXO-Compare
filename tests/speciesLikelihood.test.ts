import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlanetScan, SpeciesEntry } from "../src/shared/types.js";
import { HISTOGRAM_BINS } from "../src/shared/likelihoodBins.js";
import { clearLikelihoodDataCacheForTests } from "../src/server/likelihoodData.js";
import { clearExomasteryProfileCache } from "../src/server/exomasteryProfile.js";
import { rankSpeciesOnBody, speciesLogScore, MIN_PROFILE_SAMPLES } from "../src/server/speciesLikelihood.js";

let root: string;

/** Sixteen bins over gravity, cut so bin i covers [i/10, (i+1)/10) g for the first ten. */
const GRAVITY_EDGES = Array.from({ length: HISTOGRAM_BINS - 1 }, (_, i) => (i + 1) / 10);

function writeEdges(): void {
  const dir = path.join(root, "data", "exomastery");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "histogram-edges.json"),
    JSON.stringify({
      formatVersion: 1,
      builtAt: "2026-09-05T00:00:00Z",
      bins: HISTOGRAM_BINS,
      samples: 10000,
      edges: { "body.gravity": GRAVITY_EDGES },
    }),
    "utf8",
  );
}

function writePrevalence(species: Record<string, number>, bodies = 1000): void {
  const dir = path.join(root, "data", "exomastery");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "species-prevalence.json"),
    JSON.stringify({ formatVersion: 1, builtAt: "2026-09-05T00:00:00Z", bodies, species }),
    "utf8",
  );
}

/** A species row plus the profile the feeder would have installed for it. */
function species(id: string, genus: string, histogram: number[], samples?: number): SpeciesEntry {
  const entry = {
    id,
    displayName: id,
    genus,
    genusDataDir: genus,
    criteria: {},
  } as unknown as SpeciesEntry;

  const dir = path.join(root, "data", "species", genus, "exomastery");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${id}_exomastery.json`),
    JSON.stringify({
      formatVersion: 1,
      speciesLabel: id,
      genus,
      sampleCount: samples ?? histogram.reduce((a, b) => a + b, 0),
      // Real profiles always carry rollups; the loader treats a profile with none as unusable.
      numerics: { "body.gravity": { min: 0, max: 1.6, mean: 0.3, count: samples ?? 200 } },
      materials: {},
      atmosphereComposition: {},
      solidComposition: {},
      categorical: {},
      histograms: { "body.gravity": histogram },
    }),
    "utf8",
  );
  return entry;
}

/** Journal gravity is m/s²; 0.98 m/s² is 0.1 g, which lands in bin 1. */
function scanAtGravityG(g: number): PlanetScan {
  return { PlanetClass: "Rocky body", Landable: true, SurfaceGravity: g * 9.80665 } as unknown as PlanetScan;
}

const NARROW = Array.from({ length: HISTOGRAM_BINS }, (_, i) => (i === 1 ? 200 : 0));
const BROAD = Array.from({ length: HISTOGRAM_BINS }, () => 20);

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "edexo-likelihood-"));
  writeEdges();
  writePrevalence({ narrow: 100, broad: 100 });
  clearLikelihoodDataCacheForTests();
  clearExomasteryProfileCache();
});

afterEach(() => {
  clearLikelihoodDataCacheForTests();
  clearExomasteryProfileCache();
  rmSync(root, { recursive: true, force: true });
});

/**
 * The point of the model: two species measured on one ruler, so their scores can be compared. The
 * habitat scorer could not do this — it measured each species against its own average, which says
 * nothing about which of them is more likely to be the one down there (§25.3).
 */
describe("speciesLogScore", () => {
  it("prefers the species whose observations sit where this body sits", () => {
    const narrow = species("narrow", "a", NARROW);
    const broad = species("broad", "b", BROAD);
    const scan = scanAtGravityG(0.15);

    const a = speciesLogScore(narrow, scan, null, null, { root })!;
    const b = speciesLogScore(broad, scan, null, null, { root })!;
    expect(a.logScore).toBeGreaterThan(b.logScore);
    expect(a.terms).toBe(1);
  });

  it("prefers the broad species on a body the narrow one has never been seen near", () => {
    const narrow = species("narrow", "a", NARROW);
    const broad = species("broad", "b", BROAD);
    const scan = scanAtGravityG(0.85);

    expect(speciesLogScore(broad, scan, null, null, { root })!.logScore).toBeGreaterThan(
      speciesLogScore(narrow, scan, null, null, { root })!.logScore,
    );
  });

  /** §6, one more time: an unusual body ranks a species low, it never removes it. */
  it("never scores an unobserved bin at zero probability", () => {
    const narrow = species("narrow", "a", NARROW);
    const s = speciesLogScore(narrow, scanAtGravityG(0.85), null, null, { root })!;
    expect(Number.isFinite(s.logScore)).toBe(true);
  });

  it("declines on a profile with too few observations rather than guessing", () => {
    const thin = species("thin", "c", NARROW, MIN_PROFILE_SAMPLES - 1);
    expect(speciesLogScore(thin, scanAtGravityG(0.15), null, null, { root })).toBeNull();
  });

  /** Rarity has to cost something, or a rare species outranks a common one on every body it fits. */
  it("uses the corpus prior to separate species the body cannot", () => {
    const common = species("common", "a", BROAD);
    const rare = species("rare", "b", BROAD);
    writePrevalence({ common: 500, rare: 2 });
    clearLikelihoodDataCacheForTests();

    const scan = scanAtGravityG(0.35);
    expect(speciesLogScore(common, scan, null, null, { root })!.logScore).toBeGreaterThan(
      speciesLogScore(rare, scan, null, null, { root })!.logScore,
    );
  });

  it("has no opinion when there is no edges file to read", () => {
    rmSync(path.join(root, "data", "exomastery", "histogram-edges.json"));
    clearLikelihoodDataCacheForTests();
    const narrow = species("narrow", "a", NARROW);
    expect(speciesLogScore(narrow, scanAtGravityG(0.15), null, null, { root })).toBeNull();
  });
});

describe("rankSpeciesOnBody", () => {
  it("normalises across the candidates so the shares sum to one", () => {
    const matches = [{ entry: species("narrow", "a", NARROW) }, { entry: species("broad", "b", BROAD) }];
    const { ranked, unscored } = rankSpeciesOnBody(matches, scanAtGravityG(0.15), null, null, { root });
    expect(unscored).toHaveLength(0);
    expect(ranked.map((r) => r.match.entry.id)).toEqual(["narrow", "broad"]);
    expect(ranked.reduce((s, r) => s + r.probability, 0)).toBeCloseTo(1, 6);
  });

  /**
   * A species with no profile is unmeasured, not unlikely. Ranking it last would be a claim the
   * model has not earned, so it comes back separately and the caller decides.
   */
  it("returns candidates it cannot score separately instead of ranking them last", () => {
    const scored = { entry: species("narrow", "a", NARROW) };
    const noProfile = {
      entry: {
        id: "ghost",
        displayName: "ghost",
        genus: "z",
        genusDataDir: "z",
        criteria: {},
      } as unknown as SpeciesEntry,
    };
    const { ranked, unscored } = rankSpeciesOnBody([scored, noProfile], scanAtGravityG(0.15), null, null, {
      root,
    });
    expect(ranked.map((r) => r.match.entry.id)).toEqual(["narrow"]);
    expect(unscored.map((u) => u.entry.id)).toEqual(["ghost"]);
    expect(ranked[0]!.probability).toBeCloseTo(1, 6);
  });

  it("gives an empty answer when nothing can be scored", () => {
    const ghost = {
      entry: {
        id: "ghost",
        displayName: "g",
        genus: "z",
        genusDataDir: "z",
        criteria: {},
      } as unknown as SpeciesEntry,
    };
    const { ranked, unscored } = rankSpeciesOnBody([ghost], scanAtGravityG(0.15), null, null, { root });
    expect(ranked).toHaveLength(0);
    expect(unscored).toHaveLength(1);
  });
});
