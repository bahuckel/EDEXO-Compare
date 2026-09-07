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
        "Electricae radialem",
        // Added 2026-09-07. Sinuous Tubers need the galactic-core region: 94 % of their systems are
        // within 10 000 ly of Sgr A* across 5,139 systems, against controls of 0-20 %
        // (EDSM-targz-to-db/docs/ABSTRACT-COND.md §10.2). The match context carries no system
        // coordinates, so this cannot be answered per body — the same position Electricae radialem
        // is in, and marked the same way.
        "Sinuous Tubers Albidum",
        "Sinuous Tubers Blatteum",
        "Sinuous Tubers Caeruleum",
        "Sinuous Tubers Lindigoticum",
        "Sinuous Tubers Prasinum",
        "Sinuous Tubers Roseum",
        "Sinuous Tubers Violaceum",
        "Sinuous Tubers Viride",
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
  it("does not flag conditions the matcher can already evaluate", () => {
    for (const name of ["Clypeus speculumi", "Fumerola aquatis", "Anemone"]) {
      const e = db.species.find((x) => x.displayName === name);
      expect(e, name).toBeDefined();
      expect(e!.predictionUnsupported, name).toBeUndefined();
    }
  });

  it("leaves the overwhelming majority predictable", () => {
    const flagged = db.species.filter((e) => e.predictionUnsupported).length;
    expect(flagged).toBe(17);
    expect(db.species.length - flagged).toBeGreaterThan(85);
  });
});
