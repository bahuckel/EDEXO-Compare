import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlanetScan, SpeciesDatabase, SpeciesEntry, SpeciesMatchContext } from "../src/shared/types.js";
import {
  hostStarVerdict,
  setHostStarObservationsRootForTests,
  HOST_STAR_MIN_DETERMINISM,
  HOST_STAR_MIN_SAMPLES,
} from "../src/server/speciesHostStarObservations.js";
import { matchDatabaseToScan, shownSpeciesMatches } from "../src/server/matchSpecies.js";

let root: string;

/** A species row as the tree loader produces one, with a profile the installer would have written. */
function species(
  id: string,
  genus: string,
  hosts: Record<string, number>,
  determinism: number,
): SpeciesEntry {
  const entry = {
    id,
    displayName: id,
    genus,
    genusDataDir: genus,
    criteria: { planetClassAnyOf: ["Rocky body"], landable: true },
  } as unknown as SpeciesEntry;

  const dir = path.join(root, "data", "species", genus, "exomastery");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${id}_exomastery.json`),
    JSON.stringify({
      formatVersion: 1,
      speciesLabel: id,
      genus,
      sampleCount: Object.values(hosts).reduce((s, n) => s + n, 0),
      numerics: {},
      materials: {},
      atmosphereComposition: {},
      solidComposition: {},
      categorical: { "exo.host_star_spectral_primary": hosts },
      parameterImportance: { "exo.host_star_spectral_primary": determinism },
    }),
    "utf8",
  );
  return entry;
}

const scan = { PlanetClass: "Rocky body", Landable: true } as unknown as PlanetScan;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "edexo-hoststar-"));
  setHostStarObservationsRootForTests(root);
});

afterEach(() => {
  setHostStarObservationsRootForTests(null);
  rmSync(root, { recursive: true, force: true });
});

/**
 * The corpus, not the codex, decides where a species has been seen. Both directions matter: it
 * rescues a species the genus table has no artwork for, and it demotes one on a star it has never
 * been recorded under.
 */
describe("hostStarVerdict", () => {
  it("reports a host class the species has been observed on", () => {
    const e = species("dwarfling", "electricae", { "White Dwarf (DA) Star": 20, Neutron: 5 }, 0.4);
    const v = hostStarVerdict(e, "DA");
    expect(v.kind).toBe("observed");
    if (v.kind === "observed") {
      expect(v.observations).toBe(20);
      expect(v.share).toBeCloseTo(20 / 25, 6);
    }
  });

  it("reports a host class it has never been observed on, when the star decides for this species", () => {
    const e = species("dwarfling", "electricae", { "White Dwarf (DA) Star": 25 }, 0.4);
    const v = hostStarVerdict(e, "F");
    expect(v.kind).toBe("never");
    if (v.kind === "never") expect(v.classes).toEqual(["D"]);
  });

  /** Most species are indifferent to their star; an unvisited class says nothing about them. */
  it("says nothing when the host star does not decide for this species", () => {
    const e = species("wanderer", "bacterium", { F6: 40, G2: 30, K1: 30 }, HOST_STAR_MIN_DETERMINISM - 0.05);
    expect(hostStarVerdict(e, "Y").kind).toBe("unknown");
  });

  /** Rarity is not unreliability (§15.2): a thin profile is not evidence of absence. */
  it("says nothing about a profile with too few observations", () => {
    const e = species("rarity", "fumerola", { "White Dwarf (DA) Star": HOST_STAR_MIN_SAMPLES - 1 }, 0.9);
    expect(hostStarVerdict(e, "F").kind).toBe("unknown");
  });

  it("says nothing when there is no host star to judge", () => {
    const e = species("dwarfling", "electricae", { "White Dwarf (DA) Star": 25 }, 0.4);
    expect(hostStarVerdict(e, null).kind).toBe("unknown");
    expect(hostStarVerdict(e, "  ").kind).toBe("unknown");
  });
});

describe("host-star demotion in the matcher", () => {
  const ctx = { parentStarType: "F" } as SpeciesMatchContext;

  it("demotes a candidate never observed under this kind of star, without removing it", () => {
    const db = {
      species: [species("dwarfling", "electricae", { "White Dwarf (DA) Star": 25 }, 0.4)],
    } as SpeciesDatabase;
    const { matches } = matchDatabaseToScan(db, scan, null, null, {
      includeBacterium: true,
      matchContext: ctx,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.unlikely).toBe(true);
    expect(shownSpeciesMatches(matches)).toHaveLength(0);
    expect(matches[0]!.unlikelyReasons?.[0]?.field).toBe("StarType");
  });

  it("leaves a species alone on a star it has been seen under", () => {
    const db = {
      species: [species("dwarfling", "electricae", { "White Dwarf (DA) Star": 20, F6: 5 }, 0.4)],
    } as SpeciesDatabase;
    const { matches } = matchDatabaseToScan(db, scan, null, null, {
      includeBacterium: true,
      matchContext: ctx,
    });
    expect(shownSpeciesMatches(matches)).toHaveLength(1);
  });

  /**
   * The game places one genus per biological signal, so a demotion that leaves fewer candidate
   * genera than the game reports has contradicted a fact about the body. The count wins.
   */
  it("hands a demotion back when it would leave fewer genera than the game reports", () => {
    const db = {
      species: [
        species("dwarfling", "electricae", { "White Dwarf (DA) Star": 25 }, 0.4),
        species("common", "bacterium", { F6: 60, G2: 40 }, 0.1),
      ],
    } as SpeciesDatabase;

    const without = matchDatabaseToScan(db, scan, null, null, { includeBacterium: true, matchContext: ctx });
    expect(shownSpeciesMatches(without.matches).map((m) => m.entry.id)).toEqual(["common"]);

    const withCount = matchDatabaseToScan(db, scan, null, null, {
      includeBacterium: true,
      matchContext: ctx,
      biologicalSignals: 2,
    });
    expect(
      shownSpeciesMatches(withCount.matches)
        .map((m) => m.entry.id)
        .sort(),
    ).toEqual(["common", "dwarfling"]);
  });

  it("does not hand anything back when the shown list already satisfies the count", () => {
    const db = {
      species: [
        species("dwarfling", "electricae", { "White Dwarf (DA) Star": 25 }, 0.4),
        species("common", "bacterium", { F6: 60, G2: 40 }, 0.1),
      ],
    } as SpeciesDatabase;
    const { matches } = matchDatabaseToScan(db, scan, null, null, {
      includeBacterium: true,
      matchContext: ctx,
      biologicalSignals: 1,
    });
    expect(shownSpeciesMatches(matches).map((m) => m.entry.id)).toEqual(["common"]);
  });
});
