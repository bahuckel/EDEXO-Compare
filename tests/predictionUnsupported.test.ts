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
  it("flags the species whose requirements a Scan cannot satisfy", () => {
    const flagged = db.species.filter((e) => e.predictionUnsupported).map((e) => e.displayName);
    expect(flagged.sort()).toEqual(
      [
        "Amphora plant",
        "Brain Tree Aureum",
        "Brain Tree Gypseeum",
        "Brain Tree Lindigoticum",
        "Brain Tree Lividum",
        "Brain Tree Ostrinum",
        "Brain Tree Puniceum",
        "Brain Tree Viride",
      ].sort(),
    );
  });

  it("does not flag a row whose requirement is explicitly false", () => {
    // Brain Tree Roseum carries `requires_system_bodies: false` — the requirement does not apply.
    const roseum = db.species.find((e) => e.displayName === "Brain Tree Roseum");
    expect(roseum).toBeDefined();
    expect(roseum!.predictionUnsupported).toBeUndefined();
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
   * Phase 7 lifted the flag from the two species whose *location* condition is now measured against
   * a catalogue — §7.9 acceptance rule 6: it comes off only where a real check replaced it.
   *
   * Brain Trees and Amphora keep it, and the reason is worth stating: their other condition needs a
   * companion body elsewhere in the system, which nothing in a scan answers. Half a check is not a
   * check.
   */
  it("lifts the flag where a real spatial check replaced it", () => {
    for (const name of ["Electricae radialem", "Sinuous Tubers Prasinum", "Sinuous Tubers Roseum"]) {
      const e = db.species.find((x) => x.displayName === name);
      expect(e, name).toBeDefined();
      expect(e!.predictionUnsupported, name).toBeUndefined();
    }
    // Still marked: the companion-body condition has no catalogue behind it.
    for (const name of ["Amphora plant", "Brain Tree Aureum"]) {
      expect(db.species.find((x) => x.displayName === name)!.predictionUnsupported, name).toBeDefined();
    }
  });

  it("does not flag conditions the matcher can already evaluate", () => {
    for (const name of ["Clypeus speculumi", "Fumerola aquatis", "Anemone"]) {
      const e = db.species.find((x) => x.displayName === name);
      expect(e, name).toBeDefined();
      expect(e!.predictionUnsupported, name).toBeUndefined();
    }
  });

  it("leaves the overwhelming majority predictable", () => {
    const flagged = db.species.filter((e) => e.predictionUnsupported).length;
    expect(flagged).toBe(8);
    expect(db.species.length - flagged).toBeGreaterThan(95);
  });
});
