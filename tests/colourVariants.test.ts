/**
 * Colour variants are a species property, not a genus one.
 *
 * Every case here is a body the owner actually walked, with the colour the game gave him. The two
 * "or" cases are not failures: a material table lists six materials, this body carries two of them,
 * and nothing in 373 foot scans decides which one drives the colour — so both are offered and the
 * truth has never yet fallen outside the pair.
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getProjectRoot } from "../src/server/paths.js";
import { normaliseMaterial } from "../src/shared/speciesColour.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import { candidateMorphColorShortLabel } from "../src/shared/candidateSpawnHints.js";
import { colourVariantLabel, resolveColourVariant } from "../src/shared/colourVariants.js";
import type { SpeciesEntry } from "../src/shared/types.js";

const db = loadSpeciesDatabase();
const all = (db as unknown as { species: SpeciesEntry[] }).species;
const find = (n: string): SpeciesEntry => {
  const e = all.find((x) => x.displayName.toLowerCase() === n.toLowerCase());
  if (!e) throw new Error(`no species entry for ${n}`);
  return e;
};

/** Blu Thua EM-D d12-25 A 1 a: F8 Vb parent, nine genera, nine species walked. */
const BLU_THUA_MATS = [
  { Name: "iron" },
  { Name: "sulphur" },
  { Name: "nickel" },
  { Name: "carbon" },
  { Name: "phosphorus" },
  { Name: "chromium" },
  { Name: "germanium" },
  { Name: "zirconium" },
  { Name: "niobium" },
  { Name: "tungsten" },
  { Name: "technetium" },
];

describe("one genus, two rules", () => {
  it("reads Bacterium aurasus off the star and Bacterium vesicula off a material", () => {
    expect(find("Bacterium aurasus").colourVariant?.source).toBe("star");
    expect(find("Bacterium vesicula").colourVariant?.source).toBe("material");
  });

  it("splits Osseus the same way", () => {
    expect(find("Osseus fractus").colourVariant?.source).toBe("star");
    expect(find("Osseus discus").colourVariant?.source).toBe("material");
  });
});

describe("Blu Thua EM-D d12-25 A 1 a, against the foot scans", () => {
  const cases: [string, string][] = [
    ["Tussock caputus", "Yellow"],
    ["Bacterium aurasus", "Lime"],
    ["Aleoida coronamus", "Teal"],
    ["Cactoida cortexum", "Yellow"],
    ["Stratum excutitus", "Emerald"],
    ["Osseus fractus", "Turquoise"],
    ["Frutexa acus", "Green"],
  ];
  for (const [name, colour] of cases) {
    it(`names ${name} ${colour}`, () => {
      expect(candidateMorphColorShortLabel(find(name), "F", BLU_THUA_MATS)).toBe(colour);
    });
  }

  it("offers both candidates when two table materials are on the body", () => {
    // niobium → White, tungsten → Peach for stabitis. The plant was Peach; nothing here says which.
    const got = candidateMorphColorShortLabel(find("Fungoida stabitis"), "F", BLU_THUA_MATS);
    expect(got.split(" or ").sort()).toEqual(["Peach", "White"]);
  });
});

describe("other bodies the owner walked", () => {
  it("Fonticulua campestris under an M parent is Amethyst", () => {
    // Blu Thua ML-P b47-2 A 3.
    expect(candidateMorphColorShortLabel(find("Fonticulua campestris"), "M", null)).toBe("Amethyst");
  });

  it("Bacterium vesicula on yttrium is Lime and on tellurium is Red", () => {
    const v = find("Bacterium vesicula");
    expect(candidateMorphColorShortLabel(v, "M", [{ Name: "yttrium" }])).toBe("Lime");
    expect(candidateMorphColorShortLabel(v, "M", [{ Name: "tellurium" }])).toBe("Red");
  });

  it("Osseus pumice reads a rare material, not the star", () => {
    // Col 359 Sector XY-Y c1-18 B 2 — tellurium, and the plant was Green.
    expect(candidateMorphColorShortLabel(find("Osseus pumice"), "M", [{ Name: "tellurium" }])).toBe(
      "Green",
    );
  });
});

describe("the resolver itself", () => {
  it("says nothing rather than guessing when the table has no row", () => {
    const rule = { source: "star" as const, map: { F: "Lime" } };
    expect(colourVariantLabel(resolveColourVariant(rule, { parentStarType: "M" }))).toBeNull();
    expect(colourVariantLabel(resolveColourVariant(rule, { parentStarType: null }))).toBeNull();
  });

  it("does not read a star table off materials, or a material table off the star", () => {
    const star = { source: "star" as const, map: { F: "Lime" } };
    const mat = { source: "material" as const, map: { yttrium: "Lime" } };
    expect(resolveColourVariant(star, { materials: [{ Name: "yttrium" }] }).basis).toBe("none");
    expect(resolveColourVariant(mat, { parentStarType: "F" }).basis).toBe("none");
  });
});

describe("the antimony spelling", () => {
  /**
   * The game writes `antimony`. Our species data used to write `Antinomy` in ten rows across three
   * genera, and every one of them resolved nothing at all. The data is fixed; the filter stays, for
   * anything that reaches us from somewhere other than a journal.
   */
  it("has no Antinomy left in the shipped species data", () => {
    const files = globSync("data/species/*/*_new.json", { cwd: getProjectRoot() });
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const raw = readFileSync(join(getProjectRoot(), f), "utf8");
      expect(raw.toLowerCase().includes("antinomy"), f).toBe(false);
    }
  });

  it("still resolves the old spelling if something hands it to us", () => {
    expect(normaliseMaterial("Antinomy")).toBe("antimony");
    expect(normaliseMaterial("antimony")).toBe("antimony");
  });

  it("names the colour off the journal's own spelling", () => {
    // Bacterium vesicula, antimony -> Cyan; the row the misspelling used to hide.
    expect(candidateMorphColorShortLabel(find("Bacterium vesicula"), "M", [{ Name: "antimony" }])).toBe(
      "Cyan",
    );
  });
});
