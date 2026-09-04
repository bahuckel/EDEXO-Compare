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

  it("leaves the overwhelming majority predictable", () => {
    const flagged = db.species.filter((e) => e.predictionUnsupported).length;
    expect(flagged).toBe(9);
    expect(db.species.length - flagged).toBeGreaterThan(95);
  });
});
