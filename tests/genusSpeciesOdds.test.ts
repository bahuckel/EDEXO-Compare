/**
 * The within-genus species split must not put a number on a species the app cannot gate.
 *
 * Reported from the app 2026-09-07: "If this genus is here: radialem 70 % · pluma 30 %" on a system
 * nowhere near a nebula. The shares are normalised **inside the genus**, so an unevaluable member
 * does not merely carry a bad number of its own — every sibling's share is measured against it.
 * Dropping radialem and rendering "pluma 100 %" would be worse than the bug, because it asserts an
 * answer where the truth is that we cannot tell.
 *
 * **Phase 7 changed which species that applies to.** Electricae radialem and the Sinuous Tubers are
 * now *measured* against a catalogue, so they are predictable again — and when their gate fails they
 * are demoted to the `unlikely` tier, which this split already filters out. The suppression rule
 * therefore stays, and the set it catches shrinks to the species whose condition still has nothing
 * behind it: a companion body elsewhere in the system.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { evaluateSpatialGate, gateForSpeciesId } from "../src/shared/spatialGates.js";
import { loadSpatialCatalogue } from "../src/server/spatialCatalogue.js";
import type { SpeciesDatabase, SpeciesEntry } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let db: SpeciesDatabase;
beforeAll(() => {
  db = loadSpeciesDatabaseFromTree(root);
});

/** The rule the UI applies, extracted so it can be asserted without rendering React. */
function splitIsSuppressed(entries: readonly SpeciesEntry[]): boolean {
  return entries.some((e) => e.predictionUnsupported);
}

const byGenus = (genusFragment: string) => db.species.filter((e) => e.id.startsWith(genusFragment));

describe("within-genus odds", () => {
  it("suppresses the split where the condition still has nothing behind it", () => {
    // Brain Trees: every variant but Roseum needs a companion body elsewhere in the system, and no
    // catalogue answers that.
    expect(splitIsSuppressed(byGenus("brain_tree"))).toBe(true);
  });

  /**
   * Electricae is the case the bug was reported on, and Phase 7 fixed it a level deeper: radialem is
   * no longer "unpredictable", it is *measured*. At the owner's home system the nebula gate fails, so
   * radialem lands in the `unlikely` tier — which the split filters out before it counts members —
   * leaving pluma alone and no split to draw.
   */
  it("Electricae is now measured rather than suppressed", () => {
    const electricae = byGenus("electricae");
    expect(splitIsSuppressed(electricae)).toBe(false);

    const cat = loadSpatialCatalogue(root);
    expect(cat, "the shipped catalogue must be present").toBeTruthy();

    // Swoilz KI-E b4-9 — 175 ly from R Cra, the nearest nebula.
    const home = { x: 137, y: -88.84375, z: 298.09375 };
    const radialem = evaluateSpatialGate("electricae_electricae_radialem", home, cat)!;
    expect(radialem.passes, "radialem must fail 175 ly from the nearest nebula").toBe(false);
    expect(Math.round(radialem.distanceLy)).toBe(175);

    // pluma is star-gated, not spatial — it must not be swept up by the same rule.
    expect(gateForSpeciesId("electricae_electricae_pluma")).toBeNull();
  });

  it("leaves an ordinary genus alone — the fix must not silence every split", () => {
    for (const genus of ["bacterium", "tussock", "stratum", "osseus", "fonticulua"]) {
      const rows = byGenus(genus);
      expect(rows.length, genus).toBeGreaterThan(1);
      expect(splitIsSuppressed(rows), genus).toBe(false);
    }
  });

  it("every ungateable species carries a reason the UI can show", () => {
    for (const e of db.species.filter((x) => x.predictionUnsupported)) {
      expect(e.predictionUnsupported!.reason.length, e.displayName).toBeGreaterThan(10);
    }
  });
});
