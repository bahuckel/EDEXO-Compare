/**
 * INCLUDE-BODY-IDS §7.12 — the host-star class gate, and the barycentre resolution behind it.
 *
 * Reported by the owner 2026-09-07: Electricae pluma stood on Swoilz KI-E b4-9 10 b, whose only star
 * is an M3 Va red dwarf. Three things were wrong, and the third is the interesting one:
 *
 * 1. `conditions.parent_star` on the pluma row is **never read** — `speciesTreeLoader` looks for
 *    `parentStarTypeIncludesAnyOf` and friends, so the codex star list was dropped in silence.
 * 2. The observation term could not demote it either, because the corpus profile records one `M3`
 *    host among pluma's 31 bodies, and one observation is enough to accept a class (measured:
 *    requiring a 5 % share costs recall 90.1 % → 88.7 %).
 * 3. **That M3 observation is an artefact of a barycentre.** It comes from Eok Blao ED-Q d6-351
 *    BC 3 c, a body orbiting the B+C barycentre of an M dwarf and an L brown dwarf, in a system
 *    whose primary is a neutron star. Choosing one star out of a pair invented a host class, and
 *    that invention licensed pluma on every M-class body in the game.
 *
 * The measurement that replaces it, from `ABSTRACT-COND.md` §3.7: 10,194 pluma sightings, hosts
 * neutron 46 %, white dwarf 30 %, A 14 %, black hole 8 %, O and B **0 %**. Checked against our own
 * corpus before shipping: all 31 confirmed pluma bodies pass, and the gate withdraws pluma from 591
 * of the 627 corpus bodies that match the Electricae genus shape.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hostStarBodyIdsForExobiology } from "../src/server/orbitUtils.js";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import { loadSpatialCatalogue } from "../src/server/spatialCatalogue.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import {
  HOST_STAR_GATES,
  describeHostStarVerdict,
  evaluateHostStarGate,
  hostStarClassKeys,
  hostStarGateForSpeciesId,
} from "../src/shared/hostStarGates.js";
import type { ExplorationScanRecord, PlanetScan } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = loadSpeciesDatabaseFromTree(root);

const PLUMA = "electricae_electricae_pluma";
const RADIALEM = "electricae_electricae_radialem";

describe("which species carry a host-star gate", () => {
  it("gates the three species whose host star was measured, and nothing else", () => {
    expect(hostStarGateForSpeciesId(PLUMA)?.allowed).toEqual(["A", "N", "D", "H"]);
    expect(hostStarGateForSpeciesId("amphora_amphora_plant")?.allowed).toEqual(["A", "B"]);
    expect(hostStarGateForSpeciesId("anemone_anemone")?.allowed).toEqual(["O", "B", "A"]);
    for (const id of [RADIALEM, "bacterium_bacterium_aurasus", "cone_bark_mounds", "osseus_osseus_discus"]) {
      expect(hostStarGateForSpeciesId(id), id).toBeNull();
    }
  });

  /**
   * Every threshold carries its count and its share. All three were measured against edastro's
   * 4,845,751-row codex file, whose own distribution is the control: K 26.9 %, F 23.8 %, M 22.9 %,
   * G 14.4 %, A 6.2 %, N 2.4 %, B 0.8 %. Bark Mounds sit on that background almost exactly, which is
   * what a genus with no star rule is supposed to look like — and why they carry no gate.
   */
  it("keeps a measured count beside every threshold", () => {
    expect(HOST_STAR_GATES).toHaveLength(3);
    for (const { idIncludes, gate } of HOST_STAR_GATES) {
      expect(gate.evidence, idIncludes).toMatch(/\d,\d{3}/); // a sighting count
      expect(gate.evidence, idIncludes).toMatch(/%/);
      expect(gate.allowed.length, idIncludes).toBeGreaterThan(0);
    }
  });
});

describe("evaluating the gate", () => {
  it("passes on every class the measurement found", () => {
    for (const c of ["A", "N", "D", "H"]) {
      expect(evaluateHostStarGate(PLUMA, [c])!.passes, c).toBe(true);
    }
  });

  it("fails on the classes it did not — including the owner's M dwarf", () => {
    for (const c of ["M", "K", "G", "F", "L", "T", "Y", "O", "B"]) {
      expect(evaluateHostStarGate(PLUMA, [c])!.passes, c).toBe(false);
    }
  });

  /**
   * The barycentre rule, in the form that matters: a body orbiting an M + L pair in a neutron-star
   * system must pass, because one of the stars it could be orbiting is on the list. The set only has
   * to intersect — a body whose host is ambiguous keeps its candidate rather than losing it to a
   * coin flip.
   */
  it("passes when any star of an ambiguous host set is on the list", () => {
    expect(evaluateHostStarGate(PLUMA, ["N", "M", "L"])!.passes).toBe(true);
    expect(evaluateHostStarGate(PLUMA, ["M", "L"])!.passes).toBe(false);
  });

  it("returns null when there is nothing to judge, never a failure", () => {
    expect(evaluateHostStarGate(PLUMA, [])).toBeNull();
    expect(evaluateHostStarGate(PLUMA, null)).toBeNull();
    expect(evaluateHostStarGate(RADIALEM, ["M"])).toBeNull();
  });

  it("names the star and the rule for the reader", () => {
    const v = evaluateHostStarGate(PLUMA, ["M"])!;
    const line = describeHostStarVerdict(v);
    expect(line).toMatch(/M-class/);
    expect(line).toMatch(/neutron star/);
    expect(line).toMatch(/white dwarf/);
  });

  it("reads both vocabularies — journal letters and EDSM prose", () => {
    expect(hostStarClassKeys(["N"])).toEqual(["N"]);
    expect(hostStarClassKeys(["Neutron Star"])).toEqual(["N"]);
    expect(hostStarClassKeys(["DA", "White Dwarf (DQ) Star"])).toEqual(["D"]);
    expect(hostStarClassKeys(["M", null, undefined, "", "M"])).toEqual(["M"]);
  });
});

describe("resolving which stars a body could be orbiting", () => {
  const rec = (bodyId: number, parents: unknown[], starType?: string): ExplorationScanRecord =>
    ({
      systemAddress: 1,
      bodyId,
      bodyName: `B ${bodyId}`,
      starSystem: "S",
      updatedAt: "2026-09-07T00:00:00Z",
      parents,
      ...(starType ? { starType } : {}),
    }) as unknown as ExplorationScanRecord;

  const index = (rows: ExplorationScanRecord[]) => new Map(rows.map((r) => [r.bodyId, r]));

  it("follows a moon up through its planet to the star", () => {
    // Swoilz KI-E b4-9 10 b: [{Planet:36},{Star:0}] — the case that must still resolve to one star.
    const rows = [rec(0, [], "M"), rec(36, [{ Star: 0 }]), rec(38, [{ Planet: 36 }, { Star: 0 }])];
    expect(hostStarBodyIdsForExobiology(rows[2]!, index(rows))).toEqual([0]);
  });

  it("keeps both stars when the chain names a pair", () => {
    const rows = [rec(0, [], "A"), rec(48, [{ Star: 0 }], "Y"), rec(50, [{ Star: 48 }, { Star: 0 }])];
    expect(hostStarBodyIdsForExobiology(rows[2]!, index(rows)).sort()).toEqual([0, 48]);
  });

  /**
   * The Eok Blao case. The body orbits a planet which orbits a barycentre; no star appears anywhere
   * in the chain, so every star in the system is a candidate — which is how the neutron star gets
   * back into the answer instead of an M dwarf being picked out of the pair.
   */
  it("falls back to every star in the system for a barycentre with no star in the chain", () => {
    const rows = [
      rec(1, [], "N"),
      rec(3, [{ Null: 0 }], "M"),
      rec(4, [{ Null: 0 }], "L"),
      rec(44, [{ Null: 2 }, { Null: 0 }]),
      rec(46, [{ Planet: 44 }, { Null: 2 }, { Null: 0 }]),
    ];
    expect(hostStarBodyIdsForExobiology(rows[4]!, index(rows)).sort()).toEqual([1, 3, 4]);
  });

  it("returns nothing when no star has been scanned, rather than guessing", () => {
    const rows = [rec(44, [{ Null: 0 }]), rec(46, [{ Planet: 44 }, { Null: 0 }])];
    expect(hostStarBodyIdsForExobiology(rows[1]!, index(rows))).toEqual([]);
  });
});

describe("the body that reported the bug", () => {
  /** Swoilz KI-E b4-9 10 b — Icy, thin argon, 0.046 g, single M3 Va star, 175 ly from R Cra. */
  const scan = {
    BodyName: "Swoilz KI-E b4-9 10 b",
    BodyID: 38,
    StarSystem: "Swoilz KI-E b4-9",
    SystemAddress: 20464042518049,
    PlanetClass: "Icy body",
    Atmosphere: "thin argon atmosphere",
    AtmosphereType: "Argon",
    SurfaceGravity: 0.453466,
    SurfaceTemperature: 52.167816,
    SurfacePressure: 103.537148,
    Landable: true,
  } as unknown as PlanetScan;

  const ctx = {
    parentStarType: "M",
    parentStarSubclass: 3,
    parentStarLuminosity: "Va",
    hostStarClasses: ["M"],
    systemCoords: { x: 137, y: -88.84375, z: 298.09375 },
  };

  const run = (biologicalSignals: number | null) =>
    matchDatabaseToScan(db, scan, null, null, {
      matchContext: ctx,
      spatialCatalogue: loadSpatialCatalogue(root),
      biologicalSignals,
    });

  const find = (r: ReturnType<typeof run>, id: string) => r.matches.find((m) => m.entry.id === id)!;

  it("demotes both Electricae, each for its own measured reason", () => {
    // The journal reports Biological: 2 on this body, and two other genera survive, so nothing is
    // restored to satisfy the count.
    const r = run(2);
    const pluma = find(r, PLUMA);
    expect(pluma.unlikely).toBe(true);
    expect(pluma.unlikelyReasons!.at(-1)!.field).toBe("StarType");
    expect(pluma.unlikelyReasons!.at(-1)!.detail).toMatch(/neutron star/);

    const radialem = find(r, RADIALEM);
    expect(radialem.unlikely).toBe(true);
    expect(radialem.unlikelyReasons!.at(-1)!.field).toBe("Nebula");
  });

  it("leaves the genus out of the shown list entirely", () => {
    const shown = run(2).matches.filter((m) => !m.unlikely);
    expect(shown.some((m) => m.entry.genusDataDir === "electricae")).toBe(false);
    // …without emptying the panel: the body has real candidates.
    expect(shown.length).toBeGreaterThan(0);
  });

  /**
   * The escape hatch stays open. `FSSBodySignals` saying three genera are present is a harder fact
   * than any catalogue, so a star-demoted row comes back rather than leaving the count unsatisfiable
   * — the same rule that already governed the observation-based star demotion.
   */
  it("gives the species back when the game says more genera are present than survive", () => {
    expect(find(run(3), PLUMA).unlikely).toBeFalsy();
  });

  it("does not demote when no star has been scanned", () => {
    const r = matchDatabaseToScan(db, scan, null, null, {
      matchContext: { systemCoords: ctx.systemCoords },
      spatialCatalogue: loadSpatialCatalogue(root),
      biologicalSignals: 2,
    });
    const pluma = find(r, PLUMA);
    expect(pluma.unlikely).toBeFalsy();
    // …but it is marked, so the genus split withholds its percentage.
    expect(pluma.spatialGateUnresolved).toBe(true);
  });
});
