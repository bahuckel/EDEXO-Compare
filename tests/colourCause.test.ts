/**
 * The variant "cause" tag (review F-5.2): beside a predicted colour, the star class or material that
 * decided it. It must exist exactly when the colour label names one colour, for every species.
 */
import { describe, expect, it } from "vitest";
import { candidateMorphColorCause, candidateMorphColorShortLabel } from "../src/shared/candidateSpawnHints.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";

const db = loadSpeciesDatabaseFromTree(process.cwd());
const HOSTS = ["O", "B", "A", "F", "G", "K", "M", "L", "T", "Y", "DA", "N", "W", "TTS", "Ae"];
const MATERIALS = [
  [],
  [{ Name: "antimony", Percent: 0.5 }],
  [{ Name: "polonium", Percent: 0.4 }],
  [{ Name: "ruthenium", Percent: 0.9 }, { Name: "tellurium", Percent: 0.3 }],
  [{ Name: "cadmium", Percent: 1.1 }, { Name: "mercury", Percent: 0.6 }, { Name: "yttrium", Percent: 0.7 }],
];

describe("candidateMorphColorCause", () => {
  it("names a cause exactly when the label names one colour", () => {
    let withCause = 0;
    for (const e of db.species) {
      for (const host of HOSTS) {
        for (const mats of MATERIALS) {
          const label = candidateMorphColorShortLabel(e, host, mats);
          const cause = candidateMorphColorCause(e, [host], mats);
          const single = !!label && label !== "(unknown)" && !label.includes(" or ");
          expect({ id: e.id, host, mats: mats.map((m) => m.Name), cause: cause !== null }).toEqual({
            id: e.id,
            host,
            mats: mats.map((m) => m.Name),
            cause: single,
          });
          if (cause) withCause += 1;
        }
      }
    }
    expect(withCause).toBeGreaterThan(100);
  });

  it("is a star class or a material name", () => {
    const seen = new Set<string>();
    for (const e of db.species) {
      for (const host of HOSTS) {
        for (const mats of MATERIALS) {
          const c = candidateMorphColorCause(e, [host], mats);
          if (c) seen.add(c);
        }
      }
    }
    for (const c of seen) expect(c).toMatch(/^([A-Z]{1,3}|[A-Z][a-z]+)$/);
    expect([...seen].some((c) => /^[A-Z]{1,2}$/.test(c))).toBe(true);
    expect([...seen].some((c) => /^[A-Z][a-z]+$/.test(c))).toBe(true);
  });

  it("says nothing for several hosts that disagree on the cause", () => {
    const e = db.species.find((s) => candidateMorphColorCause(s, ["G"], []) === "G")!;
    expect(e).toBeTruthy();
    expect(candidateMorphColorCause(e, ["G", "K"], [])).toBeNull();
    expect(candidateMorphColorCause(e, ["G", "G"], [])).toBe("G");
  });
});
