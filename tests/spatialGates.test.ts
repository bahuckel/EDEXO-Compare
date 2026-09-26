/**
 * INCLUDE-BODY-IDS Phase 7 — the spatial spawn gates.
 *
 * Three genera are gated on where a system *is* rather than on anything a body scan reports. The
 * thresholds are measured, not chosen, and the tests carry the measurement so a future edit to a
 * number has to argue with the evidence rather than just change a constant.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SPATIAL_GATES,
  describeVerdict,
  distanceLy,
  evaluateSpatialGate,
  gateForSpeciesId,
  nearestPoint,
} from "../src/shared/spatialGates.js";
import { loadSpatialCatalogue } from "../src/server/spatialCatalogue.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cat = loadSpatialCatalogue(root)!;

/** Swoilz KI-E b4-9 — the owner's home system, and the case that reported the bug. */
const HOME = { x: 137, y: -88.84375, z: 298.09375 };

describe("the shipped catalogue", () => {
  it("carries the points the gates need", () => {
    expect(cat).toBeTruthy();
    // 346 = real + procgen. Planetary nebulae are excluded on evidence: not one of 88 Bark Mound
    // systems had one as its nearest neighbour.
    expect(cat.nebulae.length).toBe(346);
    expect(cat.guardian.length).toBe(362);
    expect(cat.core.n).toBe("Sagittarius A*");
  });

  it("says where its points came from", () => {
    expect(cat.sources.nebulae).toMatch(/edastro/i);
    expect(cat.sources.guardian).toMatch(/edsmPOI/i);
  });
});

describe("which species carry a gate", () => {
  it("catches the three gated genera and nothing else", () => {
    expect(gateForSpeciesId("electricae_electricae_radialem")?.kind).toBe("nebula");
    expect(gateForSpeciesId("brain_tree_roseum_brain_tree")?.kind).toBe("guardian");
    expect(gateForSpeciesId("sinuous_tuber_sinuous_tubers_prasinum")?.kind).toBe("core");
    for (const id of [
      "electricae_electricae_pluma", // star-gated, and the control: 0 % within 150 ly of a nebula
      "bacterium_bacterium_aurasus",
      "tussock_tussock_ignis",
      "osseus_osseus_discus",
    ]) {
      expect(gateForSpeciesId(id), id).toBeNull();
    }
  });

  it("keeps the measured evidence beside every threshold", () => {
    for (const { gate } of SPATIAL_GATES) {
      expect(gate.evidence.length).toBeGreaterThan(20);
      expect(gate.evidence).toMatch(/%/);
    }
  });
});

describe("evaluating a gate", () => {
  it("fails radialem at the reported system — 175 ly, rule is 150", () => {
    const v = evaluateSpatialGate("electricae_electricae_radialem", HOME, cat)!;
    expect(v.passes).toBe(false);
    expect(Math.round(v.distanceLy)).toBe(175);
    expect(v.nearestName).toBe("R Cra");
    expect(describeVerdict(v)).toContain("the rule is under 150 ly");
  });

  it("passes radialem beside a nebula", () => {
    const n = cat.nebulae[0]!;
    const v = evaluateSpatialGate("electricae_electricae_radialem", { x: n.x + 40, y: n.y, z: n.z }, cat)!;
    expect(v.passes).toBe(true);
    expect(describeVerdict(v)).toContain("inside the 150 ly rule");
  });

  it("passes Brain Trees in the bubble and fails the Tubers there", () => {
    // The bubble is well inside 1,000 ly of a Guardian site and ~25 kly from the core.
    expect(evaluateSpatialGate("brain_tree_roseum_brain_tree", HOME, cat)!.passes).toBe(true);
    const tubers = evaluateSpatialGate("sinuous_tuber_sinuous_tubers_prasinum", HOME, cat)!;
    expect(tubers.passes).toBe(false);
    expect(describeVerdict(tubers)).toContain("Sagittarius A*");
  });

  it("passes the Tubers near the core", () => {
    const v = evaluateSpatialGate("sinuous_tuber_sinuous_tubers_prasinum", cat.core, cat)!;
    expect(v.passes).toBe(true);
    expect(Math.round(v.distanceLy)).toBe(0);
  });

  /**
   * The rule that keeps this honest. Not knowing where a system is must never read as "the species
   * cannot be here" — that is the absence-of-evidence trap the tri-state flags and
   * `predictionUnsupported` both exist to avoid.
   */
  it("returns null for a missing position or a missing catalogue, never a failure", () => {
    expect(evaluateSpatialGate("electricae_electricae_radialem", null, cat)).toBeNull();
    expect(evaluateSpatialGate("electricae_electricae_radialem", undefined, cat)).toBeNull();
    expect(evaluateSpatialGate("electricae_electricae_radialem", HOME, null)).toBeNull();
    // …and a species with no spatial condition has nothing to evaluate either.
    expect(evaluateSpatialGate("bacterium_bacterium_aurasus", HOME, cat)).toBeNull();
  });
});

describe("geometry", () => {
  it("measures a straight line in light years", () => {
    expect(distanceLy({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBe(5);
  });

  it("finds the nearest of many, and nothing in an empty catalogue", () => {
    const pts = [
      { n: "far", x: 100, y: 0, z: 0 },
      { n: "near", x: 10, y: 0, z: 0 },
    ];
    expect(nearestPoint({ x: 0, y: 0, z: 0 }, pts)!.point.n).toBe("near");
    expect(nearestPoint({ x: 0, y: 0, z: 0 }, [])).toBeNull();
  });

  it("reads distances at the scale they matter — ly close in, kly far out", () => {
    const near = evaluateSpatialGate("electricae_electricae_radialem", HOME, cat)!;
    expect(describeVerdict(near)).toMatch(/\d+ ly/);
    const far = evaluateSpatialGate("sinuous_tuber_sinuous_tubers_prasinum", HOME, cat)!;
    expect(describeVerdict(far)).toMatch(/kly/);
  });
});

/**
 * Bark Mounds' two radii (owner, 2026-09-26): 93 % of their systems are within 150 ly of a nebula,
 * 100 % within 300. His Flyai Flyuae FM-C b0 grew them at 169 ly while the app offered Anemone.
 */
describe("the Bark Mounds soft band", () => {
  const one = { ...cat, nebulae: [{ n: "Test Nebula", x: 0, y: 0, z: 0 }] };
  const at = (ly: number) => ({ x: ly, y: 0, z: 0 });

  it("passes inside 150 ly, keeps 150–300 ly at half its chance, fails beyond 300", () => {
    expect(evaluateSpatialGate("bark_mounds_bark_mounds", at(100), one)).toMatchObject({ passes: true });
    const band = evaluateSpatialGate("bark_mounds_bark_mounds", at(169), one)!;
    expect(band.passes).toBe(false);
    expect(band.softBand).toEqual({ factor: 0.5, bandLy: 300 });
    expect(describeVerdict(band)).toContain("inside 300 ly");
    const out = evaluateSpatialGate("bark_mounds_bark_mounds", at(350), one)!;
    expect(out.passes).toBe(false);
    expect(out.softBand).toBeUndefined();
  });

  it("gives radialem no band: 82 % at 300 ly is not the same evidence", () => {
    const v = evaluateSpatialGate("electricae_electricae_radialem", at(169), one)!;
    expect(v.passes).toBe(false);
    expect(v.softBand).toBeUndefined();
  });

  it("keeps a band row in the main list with the factor on it", async () => {
    const { demoteFailedSpatialGates } = await import("../src/server/matchSpecies.js");
    const row = { entry: { id: "bark_mounds_bark_mounds" }, reasons: [] } as never;
    const strict = [row];
    const unlikely: never[] = [];
    demoteFailedSpatialGates(strict, unlikely, { systemCoords: at(169) } as never, one);
    expect(unlikely).toHaveLength(0);
    expect(strict[0]).toMatchObject({ presenceFactor: 0.5 });
    demoteFailedSpatialGates(strict, unlikely, { systemCoords: at(350) } as never, one);
    expect(strict).toHaveLength(0);
    expect(unlikely).toHaveLength(1);
  });
});
