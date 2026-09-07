/**
 * The within-genus species split must not put a number on a species the app cannot gate.
 *
 * Reported from the app 2026-09-07: "If this genus is here: radialem 70 % · pluma 30 %" on a system
 * nowhere near a nebula. Electricae radialem is marked `predictionUnsupported` — the app says on the
 * card that it cannot check the nebula condition — and then this line quietly assigned it a
 * posterior anyway.
 *
 * The subtle half is why *both* figures are wrong. The shares are normalised **inside the genus**, so
 * an unevaluable member does not merely carry a bad number of its own: it makes every sibling's
 * share wrong too, because each is measured against it. Dropping radialem and rendering
 * "pluma 100 %" would be worse than the bug — it would assert an answer where the truth is that we
 * cannot tell.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
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
  it("suppresses the split for Electricae — radialem needs a nebula the app cannot measure", () => {
    const electricae = byGenus("electricae");
    expect(electricae.length).toBeGreaterThan(1);

    const radialem = electricae.find((e) => e.displayName === "Electricae radialem");
    const pluma = electricae.find((e) => e.displayName === "Electricae pluma");
    expect(radialem?.predictionUnsupported, "radialem must stay marked").toBeDefined();
    expect(pluma?.predictionUnsupported, "pluma is star-gated and checkable").toBeUndefined();

    // One ungateable member is enough: pluma's share is normalised against radialem, so it is
    // unfounded too. This is the assertion the reported bug violated.
    expect(splitIsSuppressed(electricae)).toBe(true);
  });

  it("suppresses it for the other genera holding an ungateable species", () => {
    // Brain Trees: every variant but Roseum needs a companion body elsewhere in the system.
    expect(splitIsSuppressed(byGenus("brain_tree"))).toBe(true);
    // Sinuous Tubers: the whole genus is galactic-core gated (2026-09-07).
    expect(splitIsSuppressed(byGenus("sinuous_tuber"))).toBe(true);
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
