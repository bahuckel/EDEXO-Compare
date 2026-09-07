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
