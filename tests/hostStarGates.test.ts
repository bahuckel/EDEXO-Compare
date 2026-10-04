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
import { demoteFailedHostStarGates, matchDatabaseToScan } from "../src/server/matchSpecies.js";
import { restoreDemotionsBelowSignalCount } from "../src/server/demotionPasses.js";
import { loadSpatialCatalogue } from "../src/server/spatialCatalogue.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import {
  HOST_STAR_GATES,
  describeHostStarVerdict,
  evaluateHostStarGate,
  hostStarClassKeys,
  hostStarGateForSpeciesId,
} from "../src/shared/hostStarGates.js";
import type {
  ExplorationScanRecord,
  MatchReason,
  PlanetScan,
  SpeciesEntry,
  SpeciesMatch,
  SpeciesMatchContext,
} from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = loadSpeciesDatabaseFromTree(root);

const PLUMA = "electricae_electricae_pluma";
const RADIALEM = "electricae_electricae_radialem";

describe("which species carry a host-star gate", () => {
  it("gates the species whose host star was measured, and nothing else", () => {
    expect(hostStarGateForSpeciesId(PLUMA)?.allowed).toEqual(["A", "N", "D", "H"]);
    expect(hostStarGateForSpeciesId("amphora_amphora_plant")?.allowed).toEqual(["A", "B"]);
    expect(hostStarGateForSpeciesId("anemone_luteolum")?.allowed).toEqual(["B"]);
    expect(hostStarGateForSpeciesId("anemone_puniceum")?.allowed).toEqual(["O", "W"]);
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
    expect(HOST_STAR_GATES).toHaveLength(13);
    for (const { idIncludes, gate } of HOST_STAR_GATES) {
      expect(gate.evidence, idIncludes).toMatch(/\d{2,}/); // a sighting count
      expect(gate.evidence, idIncludes).toMatch(/%/);
      expect(gate.allowed.length, idIncludes).toBeGreaterThan(0);
    }
  });
});

/**
 * The Anemone colours (split 2026-09-28): the class of the star lighting the body and its luminosity
 * class pick the colour, the body class picks which of each pair. Measured on 4,090 Spansh dump bodies
 * where the codex logs exactly one Anemone in the system (hostStarGates.ts has the table).
 */
describe("the Anemone colours", () => {
  // Judged on the system's main star: its class key, and the star as the journal writes it.
  const pass = (id: string, type: string, luminosity?: string) =>
    evaluateHostStarGate(id, ["Y"], hostStarClassKeys([type])[0], { type, luminosity })!.passes;

  it("splits the B stars on their luminosity class", () => {
    expect(pass("anemone_luteolum", "B", "Vz")).toBe(true);
    expect(pass("anemone_luteolum", "B", "IVab")).toBe(true);
    expect(pass("anemone_luteolum", "B", "IIIab")).toBe(false);
    expect(pass("anemone_roseum", "B", "IIIab")).toBe(true);
    expect(pass("anemone_roseum_bioluminescent", "B_BlueWhiteSuperGiant", "Ib")).toBe(true);
    expect(pass("anemone_roseum", "B", "V")).toBe(false);
    expect(pass("anemone_croceum", "B", "VI")).toBe(true);
    expect(pass("anemone_croceum", "B", "V")).toBe(false);
    expect(pass("anemone_blatteum_bioluminescent", "B", "VI")).toBe(false);
  });

  it("takes A giants for Croceum and Rubeum, and Herbig stars only for Prasinum", () => {
    expect(pass("anemone_croceum", "A", "III")).toBe(true);
    expect(pass("anemone_rubeum_bioluminescent", "A_BlueWhiteSuperGiant", "Ib")).toBe(true);
    expect(pass("anemone_croceum", "A", "Va")).toBe(false);
    expect(pass("anemone_croceum", "AeBe", "VI")).toBe(false);
    expect(pass("anemone_prasinum_bioluminescent", "AeBe", "VI")).toBe(true);
    expect(pass("anemone_prasinum_bioluminescent", "A", "III")).toBe(false);
    expect(pass("anemone_prasinum_bioluminescent", "O", "Vz")).toBe(true);
    expect(pass("anemone_puniceum", "O", "Vz")).toBe(true);
    expect(pass("anemone_puniceum", "B", "V")).toBe(false);
  });

  it("judges the class alone when the luminosity is unknown, and abstains with no main star", () => {
    expect(pass("anemone_luteolum", "B")).toBe(true);
    expect(pass("anemone_roseum", "B")).toBe(true);
    expect(pass("anemone_luteolum", "K", "V")).toBe(false);
    expect(evaluateHostStarGate("anemone_luteolum", ["B"], null, null)).toBeNull();
  });

  it("names the luminosity when it decided", () => {
    const v = evaluateHostStarGate("anemone_luteolum", ["T"], "B", { type: "B", luminosity: "IIIab" })!;
    expect(describeHostStarVerdict(v)).toMatch(/^Main star B-class IIIab .* B-class IV, V/);
  });
});

describe("evaluating the gate", () => {
  it("passes on every class the measurement found", () => {
    for (const c of ["A", "N", "D", "H"]) {
      expect(evaluateHostStarGate(PLUMA, [c], c)!.passes, c).toBe(true);
    }
  });

  it("fails on the classes it did not — including the owner's M dwarf", () => {
    for (const c of ["M", "K", "G", "F", "L", "T", "Y", "O", "B"]) {
      expect(evaluateHostStarGate(PLUMA, [c], c)!.passes, c).toBe(false);
    }
  });

  /**
   * Judged on the system's **main** star, which is what the codex CSV measured. A body orbiting an
   * M + L pair — or a lone M, Y or T dwarf — in a neutron-star or A-star system passes: 12 of the
   * corpus' 69 pluma bodies orbit such a dwarf, and every one of them was demoted while the gate read
   * the host. A single-star M system still fails.
   */
  it("reads the main star, not the dwarf the body happens to orbit", () => {
    expect(evaluateHostStarGate(PLUMA, ["N", "M", "L"], "N")!.passes).toBe(true);
    expect(evaluateHostStarGate(PLUMA, ["M", "L"], "N")!.passes).toBe(true);
    expect(evaluateHostStarGate(PLUMA, ["Y"], "A")!.passes).toBe(true);
    expect(evaluateHostStarGate(PLUMA, ["M"], "M")!.passes).toBe(false);
    // No main star known: abstain rather than fall back to the host.
    expect(evaluateHostStarGate(PLUMA, ["M"])).toBeNull();
  });

  // HIP 118062 B 6 g (EDDN ScanOrganic set, 2026-10-03): main star G, the body round the DBV dwarf B.
  it("passes on the body's own host too, when that is a white dwarf in a G system", () => {
    expect(evaluateHostStarGate(PLUMA, ["D"], "G")!.passes).toBe(true);
    expect(evaluateHostStarGate(PLUMA, ["K"], "G")!.passes).toBe(false);
  });

  it("returns null when there is nothing to judge, never a failure", () => {
    expect(evaluateHostStarGate(PLUMA, [])).toBeNull();
    expect(evaluateHostStarGate(PLUMA, null)).toBeNull();
    expect(evaluateHostStarGate(RADIALEM, ["M"])).toBeNull();
  });

  it("names the star and the rule for the reader", () => {
    const v = evaluateHostStarGate(PLUMA, ["M"], "M")!;
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

  /**
   * A chain naming two stars is not a pair — it is a hierarchy.
   *
   * This expected `[0, 48]`, on the reading that either star might be the host. `Parents` is ordered
   * nearest-first, so `[{Star:48},{Star:0}]` says the body orbits star 48 and star 48 orbits star 0:
   * 48 is the host and 0 is the host's ancestor, which may be nothing like it.
   *
   * The correction is measured, not argued. Our answer was checked against Spansh's independent
   * `hostStarBodyId` over 17,487 corpus bodies with identical parent chains: 99.51 % agreement, and
   * every one of the 86 disagreements was this shape. Reading the order took it to 100.00 %.
   *
   * The genuinely ambiguous case — a chain naming **no** star — is below and is untouched.
   */
  it("takes the nearest star when the chain names a hierarchy", () => {
    const rows = [rec(0, [], "A"), rec(48, [{ Star: 0 }], "Y"), rec(50, [{ Star: 48 }, { Star: 0 }])];
    expect(hostStarBodyIdsForExobiology(rows[2]!, index(rows))).toEqual([48]);
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
    // A single-star system: the M3 is also the main star, which is what the pluma gate reads.
    systemMainStarClass: "M",
    systemCoords: { x: 137, y: -88.84375, z: 298.09375 },
  };

  const run = (biologicalSignals: number | null) =>
    matchDatabaseToScan(db, scan, null, null, {
      matchContext: ctx,
      spatialCatalogue: loadSpatialCatalogue(root),
      biologicalSignals,
    });

  const find = (r: ReturnType<typeof run>, id: string) => r.matches.find((m) => m.entry.id === id)!;

  it("demotes pluma for its star; radialem stays at a low chance (owner, 2026-10-04, Q7)", () => {
    // The journal reports Biological: 2 on this body, and two other genera survive, so nothing is
    // restored to satisfy the count.
    const r = run(2);
    const pluma = find(r, PLUMA);
    expect(pluma.unlikely).toBe(true);
    expect(pluma.unlikelyReasons!.at(-1)!.field).toBe("StarType");
    expect(pluma.unlikelyReasons!.at(-1)!.detail).toMatch(/neutron star/);

    // 175 ly from R CrA: past the 150 ly rule, which a fifth of radialem's own systems are, so it
    // stays listed at 0.22 of its chance and the 1 % floors decide (it was demoted until 2026-10-04).
    const radialem = find(r, RADIALEM);
    expect(radialem.unlikely).toBeFalsy();
    expect(radialem.presenceFactor).toBeCloseTo(0.22);
    expect(radialem.reasons.at(-1)!.field).toBe("Nebula");
  });

  it("keeps the panel's other candidates", () => {
    const shown = run(2).matches.filter((m) => !m.unlikely);
    expect(shown.filter((m) => m.entry.genusDataDir === "electricae").map((m) => m.entry.id)).toEqual([RADIALEM]);
    expect(shown.length).toBeGreaterThan(1);
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

describe("Stratum tectonicas and the star it orbits (owner, 2026-10-02)", () => {
  const TECTONICAS = "stratum_stratum_tectonicas";

  it("is demoted under a G, A or neutron host, and only the host counts", () => {
    for (const host of ["G", "A", "N"]) expect(evaluateHostStarGate(TECTONICAS, [host], "K")!.passes).toBe(false);
    for (const host of ["K", "M", "F", "L", "T"]) expect(evaluateHostStarGate(TECTONICAS, [host], "G")!.passes).toBe(true);
  });

  it("keeps a pair with one allowed star", () => {
    expect(evaluateHostStarGate(TECTONICAS, ["G", "K"], "G")!.passes).toBe(true);
  });

  it("leaves the other Stratum alone", () => {
    expect(evaluateHostStarGate("stratum_stratum_paleas", ["G"], "G")).toBeNull();
  });
});

describe("a gate measured on the main star", () => {
  const ARANEAMUS = "stratum_stratum_araneamus";

  it("is judged on the main star, not the star the body orbits", () => {
    // A third of araneamus's bodies orbit a Y or T dwarf in an A-star system.
    expect(evaluateHostStarGate(ARANEAMUS, ["Y"], "A")!.passes).toBe(true);
    expect(evaluateHostStarGate(ARANEAMUS, ["T"], "N")!.passes).toBe(true);
    // And an A-class host does not rescue a system whose main star is F.
    expect(evaluateHostStarGate(ARANEAMUS, ["A"], "F")!.passes).toBe(false);
  });

  it("abstains when the main star is not known, however the host reads", () => {
    expect(evaluateHostStarGate(ARANEAMUS, ["F"], null)).toBeNull();
    expect(evaluateHostStarGate(ARANEAMUS, ["F"], undefined)).toBeNull();
  });

  it("says so in its own words", () => {
    const v = evaluateHostStarGate(ARANEAMUS, ["K"], "K")!;
    expect(describeHostStarVerdict(v)).toMatch(/^Main star K-class/);
  });
});

/**
 * BD-12 1172 11 a (EDDN ScanOrganic set, 2026-10-03): thin sulphur dioxide demoted every Anemone on
 * its atmosphere; the DSS named Anemone, and the restore took Luteolum (main star B) on list order.
 * The main star is an O — Prasinum Bioluminescent's, and what players logged there.
 */
describe("a DSS-named genus restores the row the star allows", () => {
  type Row = Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">;
  const atm: MatchReason = { field: "AtmosphereType", detail: "Codex lists (no atmosphere)", soft: true };
  const row = (id: string): Row =>
    ({
      entry: { id, displayName: id, genusDataDir: "anemone" } as SpeciesEntry,
      reasons: [atm],
      unlikely: true,
      unlikelyReasons: [atm],
    }) as Row;
  it("takes Prasinum Bioluminescent under an O main star, not Luteolum", () => {
    const strict: Row[] = [];
    const unlikely = [row("anemone_luteolum"), row("anemone_prasinum_bioluminescent")];
    const ctx = { hostStarClasses: ["T"], systemMainStarClass: "O", systemMainStarType: "O", systemMainStarLuminosity: "V" };
    demoteFailedHostStarGates(strict, unlikely, ctx as SpeciesMatchContext);
    expect(unlikely[0]!.unlikelyReasons!.map((r) => r.field)).toEqual(["AtmosphereType", "StarType"]);
    restoreDemotionsBelowSignalCount(strict, unlikely, 2, new Set(["anemone"]));
    expect(strict.map((m) => m.entry.id)).toEqual(["anemone_prasinum_bioluminescent"]);
  });
});

// Amphora on a companion in an A-star system (2026-10-03, known-spawn bodies Flyauduae TE-Q d5-4 B 1 etc.).
describe("Amphora's star", () => {
  it("is read on the main star, or the body's own host", () => {
    expect(evaluateHostStarGate("amphora_amphora_plant", ["M"], "A")!.passes).toBe(true);
    expect(evaluateHostStarGate("amphora_amphora_plant", ["B"], "K")!.passes).toBe(true);
    expect(evaluateHostStarGate("amphora_amphora_plant", ["K"], "K")!.passes).toBe(false);
  });
});
