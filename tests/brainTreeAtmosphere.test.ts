/**
 * Brain Trees grow on thin atmospheres too (2026-10-04): of 4,142 confirmed single-species Brain Tree
 * bodies, 318 that carry one were offered no Brain Tree at all after a DSS, because a genus-wide
 * "airless only" gate overrode the species' own atmosphere lists.
 */
import { describe, expect, it } from "vitest";
import { speciesMatchesCriteria } from "../src/server/matchSpecies.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import type { PlanetScan } from "../src/shared/types.js";

const db = loadSpeciesDatabaseFromTree(process.cwd());
const roseum = db.species.find((e) => e.id === "brain_trees_brain_tree_roseum")!;

/** Synuefe EH-T b37-3 8: a confirmed Brain Tree Roseum body in Inner Orion Spur. */
const body = {
  PlanetClass: "High metal content body",
  AtmosphereType: "CarbonDioxide",
  Atmosphere: "thin carbon dioxide atmosphere",
  Volcanism: "minor metallic magma volcanism",
  SurfaceTemperature: 252,
  SurfaceGravity: 12.2,
  Landable: true,
} as PlanetScan;

describe("Brain Trees on a thin atmosphere", () => {
  it("are judged by the species' atmosphere list, not refused outright", () => {
    const v = speciesMatchesCriteria(roseum, body, null, null, null);
    expect(v.reasons.some((r) => /airless/i.test(r.detail))).toBe(false);
    expect(v.reasons.filter((r) => r.field === "AtmosphereType" && !(r as { soft?: boolean }).soft)).toEqual([]);
  });
});
