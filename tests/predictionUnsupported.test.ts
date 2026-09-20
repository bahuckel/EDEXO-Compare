import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import type { SpeciesDatabase } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let db: SpeciesDatabase;
beforeAll(() => {
  db = loadSpeciesDatabaseFromTree(root);
});

/**
 * A species is marked "not predicted" when its spawn depends on something a body scan cannot answer.
 * The candidate is still listed — nothing is ever removed — but the app stops implying it predicted
 * something it did not.
 */
describe("predictionUnsupported", () => {
  it("flags nothing any more, because every condition in the tree is now measured", () => {
    /*
      This list used to hold Amphora plant and seven Brain Trees. Their condition is about a
      *different* body in the same system, and the match context now carries the system's other
      bodies, so `demoteFailedSystemBodyGates` answers it against real scans instead of the loader
      shrugging. The flag comes off only where a real check replaced it — §7.9 acceptance rule 6,
      the same bar Phase 7 cleared for the nebula and core rules.
    */
    const flagged = db.species.filter((e) => e.predictionUnsupported).map((e) => e.displayName);
    expect(flagged).toEqual([]);
  });

  it("carries the companion-body requirement into the criteria instead", () => {
    // The condition did not disappear; it moved somewhere the matcher reads.
    const amphora = db.species.find((e) => e.displayName === "Amphora plant");
    expect(amphora!.criteria.systemBodyClassesAnyOf).toContain("Earth-Like World");
    expect(amphora!.criteria.systemBodyClassesAnyOf).toContain("Water Giant");

    // The Brain Trees say `requires_system_bodies: true` and leave the list to the genus file.
    const aureum = db.species.find((e) => e.displayName === "Brain Tree Aureum");
    expect(aureum!.criteria.systemBodyClassesAnyOf).toEqual([
      "Earth-Like World",
      "Gas Giant with water-based life",
    ]);
  });

  it("does not gate a row whose requirement is explicitly false", () => {
    // Brain Tree Roseum carries `requires_system_bodies: false` — the requirement does not apply, and
    // `false` must not be read as an empty list that nothing can satisfy.
    const roseum = db.species.find((e) => e.displayName === "Brain Tree Roseum");
    expect(roseum).toBeDefined();
    expect(roseum!.predictionUnsupported).toBeUndefined();
    expect(roseum!.criteria.systemBodyClassesAnyOf).toBeUndefined();
  });

  it("does not flag star-type requirements, which are resolvable from the journal", () => {
    // The parent star is available via Scan.Parents, so Anemone and Electricae pluma are a wiring
    // job, not an unknowable. Calling them unpredictable would hide work worth doing.
    for (const name of ["Anemone", "Electricae pluma"]) {
      const e = db.species.find((x) => x.displayName === name);
      expect(e, name).toBeDefined();
      expect(e!.predictionUnsupported, name).toBeUndefined();
    }
  });

  it("gives every flagged species a reason and the condition key behind it", () => {
    for (const e of db.species.filter((x) => x.predictionUnsupported)) {
      expect(e.predictionUnsupported!.reason.length, e.displayName).toBeGreaterThan(10);
      expect(
        ["requires_system_bodies", "system_requirements", "location_requirement"],
        e.displayName,
      ).toContain(e.predictionUnsupported!.sourceKey);
    }
  });

  /**
   * The conditions that are *checkable* must stay checkable. ABSTRACT-COND tags nine genera as
   * carrying an abstract condition; on inspection the app can already evaluate most of them, and
   * marking those would lose predictions rather than gain honesty:
   *
   * - Anemone's `parent_star_types: [O, B, A]` — encoded, and the context has `parentStarType`.
   * - Clypeus speculumi's `distance_from_star.min_ls: 2500` — encoded, context has the orbit distance.
   * - Fumerola's `geologicalSignalIncludes` — encoded, context has `signalHints`.
   *
   * Only the conditions needing data the context does not carry are flagged: other bodies in the
   * system, and galactic position.
   */
  /**
   * Phase 7 lifted the flag from the species whose *location* condition is measured against a
   * catalogue. The companion-body conditions followed, once the context could see the system.
   */
  it("lifts the flag wherever a real check replaced it", () => {
    for (const name of [
      "Electricae radialem",
      "Sinuous Tubers Prasinum",
      "Sinuous Tubers Roseum",
      "Amphora plant",
      "Brain Tree Aureum",
    ]) {
      const e = db.species.find((x) => x.displayName === name);
      expect(e, name).toBeDefined();
      expect(e!.predictionUnsupported, name).toBeUndefined();
    }
  });

  it("does not flag conditions the matcher can already evaluate", () => {
    for (const name of ["Clypeus speculumi", "Fumerola aquatis", "Anemone"]) {
      const e = db.species.find((x) => x.displayName === name);
      expect(e, name).toBeDefined();
      expect(e!.predictionUnsupported, name).toBeUndefined();
    }
  });

  it("leaves every species predictable", () => {
    expect(db.species.filter((e) => e.predictionUnsupported).length).toBe(0);
    expect(db.species.length).toBeGreaterThan(95);
  });
});
