/**
 * The thirteen Bacterium colour tables, pinned row by row against ED-DSN.
 *
 * Two of them were wrong, and both failed silently — the app reported a colour it had no way of
 * getting right, or no colour at all, and nothing in the suite noticed:
 *
 * - **aurasus** carried a *material* table. Against the commander's own 15 sightings the material
 *   rule scores 4, and all four are "Green", which sits in both tables by accident; the star rule
 *   scores 15, 11 of them on bodies whose host star resolves to a single class. His own photographs
 *   settle it on their own — Emerald, Green, Lime and Teal are G, K, F and M, and not one of them
 *   appears anywhere in the material table it used to carry.
 * - **alcyoneum** was `star_based` with its `mapping` set to the sentence *"Parent star type
 *   determines color"*. `colourFromStar` walks `Object.entries(mapping)`, so on a string it iterated
 *   character indices — `"0"`, `"1"`, `"2"` — and no star class begins with a digit. Alcyoneum
 *   reported no colour on every body it has ever grown on.
 *
 * Neither is the sort of thing a matcher test can catch: the colour never gates a candidate, it only
 * decides what the card says and which photograph it shows (`heroPhotoUrlFor`). So the tables get
 * pinned to their source instead.
 *
 * The source is https://ed-dsn.net/en/bacterium_en/, transcribed below. Where it and the game
 * disagree the game wins — but then this file should be edited deliberately, with the field report
 * that justified it, rather than a row drifting unnoticed.
 */
import { describe, expect, it } from "vitest";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import { inferColour, normaliseMaterial } from "../src/shared/speciesColour.js";
import type { SpeciesEntry } from "../src/shared/types.js";

const db = loadSpeciesDatabase() as unknown as { species: SpeciesEntry[] };
const find = (n: string) => db.species.find((e) => e.displayName.toLowerCase() === n.toLowerCase())!;

/** The table the three star-coloured Bacterium share. */
const STAR_TABLE: Record<string, string> = {
  O: "Turquoise",
  B: "Grey",
  A: "Yellow",
  F: "Lime",
  G: "Emerald",
  K: "Green",
  M: "Teal",
  L: "Sage",
  T: "Red",
  TTS: "Maroon",
  W: "Amethyst",
  D: "Ocher",
  N: "Indigo",
};

const STAR_COLOURED = ["Bacterium alcyoneum", "Bacterium aurasus", "Bacterium cerbrus"] as const;

/**
 * ED-DSN spells antimony "Antinomy"; so did our own data until it was corrected, and
 * `normaliseMaterial` still carries the alias. Keys here use the game's spelling.
 */
const MATERIAL_TABLES: Record<string, Record<string, string>> = {
  "Bacterium acies": {
    Antimony: "Cyan",
    Polonium: "Magenta",
    Ruthenium: "Cobalt",
    Technetium: "Lime",
    Tellurium: "White",
    Yttrium: "Aquamarine",
  },
  "Bacterium bullaris": {
    Antimony: "Cobalt",
    Polonium: "Yellow",
    Ruthenium: "Aquamarine",
    Technetium: "Gold",
    Tellurium: "Lime",
    Yttrium: "Red",
  },
  "Bacterium informem": {
    Antimony: "Red",
    Polonium: "Lime",
    Ruthenium: "Gold",
    Technetium: "Aquamarine",
    Tellurium: "Yellow",
    Yttrium: "Cobalt",
  },
  "Bacterium nebulus": {
    Antimony: "Magenta",
    Polonium: "Gold",
    Ruthenium: "Orange",
    Tellurium: "Green",
    Yttrium: "Cobalt",
  },
  "Bacterium vesicula": {
    Antimony: "Cyan",
    Polonium: "Orange",
    Ruthenium: "Mulberry",
    Technetium: "Gold",
    Tellurium: "Red",
    Yttrium: "Lime",
  },
  "Bacterium volu": {
    Antimony: "Red",
    Polonium: "Aquamarine",
    Ruthenium: "Cobalt",
    Tellurium: "Cyan",
    Yttrium: "Gold",
  },
  "Bacterium omentum": {
    Cadmium: "Lime",
    Mercury: "White",
    Molybdenum: "Aquamarine",
    Niobium: "Peach",
    Tungsten: "Blue",
    Tin: "Red",
  },
  "Bacterium scopulum": {
    Cadmium: "White",
    Mercury: "Peach",
    Molybdenum: "Lime",
    Niobium: "Red",
    Tungsten: "Aquamarine",
    Tin: "Mulberry",
  },
  "Bacterium tela": {
    Cadmium: "Gold",
    Mercury: "Orange",
    Molybdenum: "Yellow",
    Niobium: "Magenta",
    Tungsten: "Green",
    Tin: "Cobalt",
  },
  "Bacterium verrata": {
    Cadmium: "Peach",
    Mercury: "Red",
    Molybdenum: "White",
    Niobium: "Mulberry",
    Tungsten: "Lime",
    Tin: "Blue",
  },
};

/** Elite's two rare-material tiers. Every landable body carries two of the first and one of the second. */
const GRADE_4 = ["Cadmium", "Mercury", "Molybdenum", "Niobium", "Tungsten", "Tin"];
const GRADE_5 = ["Antimony", "Polonium", "Ruthenium", "Technetium", "Tellurium", "Yttrium"];

describe("Bacterium colour tables", () => {
  it("covers every Bacterium that has a colour rule at all", () => {
    // If a fourteenth ever appears, it should be transcribed here rather than left unpinned.
    const withRules = db.species
      .filter((e) => e.genus.toLowerCase() === "bacterium" && e.speciesColourRules?.type)
      .map((e) => e.displayName)
      .sort();
    expect(withRules).toEqual([...STAR_COLOURED, ...Object.keys(MATERIAL_TABLES)].sort());
  });

  it.each(STAR_COLOURED)("%s is coloured by its parent star", (name) => {
    const rules = find(name).speciesColourRules!;
    expect(rules.type).toBe("star_based");
    /*
      A string here is what broke alcyoneum. `Object.entries` accepts one happily and yields
      character indices, so the rule reads as a table with keys "0", "1", "2" and matches nothing —
      no throw, no warning, just a species that never has a colour.
    */
    expect(typeof rules.mapping, `${name} mapping must be a table, not prose`).toBe("object");
    expect(rules.mapping).toEqual(STAR_TABLE);
  });

  it.each(Object.entries(MATERIAL_TABLES))("%s matches ED-DSN row for row", (name, table) => {
    const rules = find(name).speciesColourRules!;
    expect(rules.type).toBe("material_based");
    const got = Object.fromEntries(
      Object.entries(rules.mapping as Record<string, string>).map(([m, c]) => [normaliseMaterial(m), c]),
    );
    const want = Object.fromEntries(Object.entries(table).map(([m, c]) => [normaliseMaterial(m), c]));
    expect(got).toEqual(want);
  });

  it("gives each material species one tier and never a mix of the two", () => {
    /*
      The tiers are the reason a colour is certain or not: exactly one grade-5 material sits on every
      landable body, and exactly two grade-4 — measured across 10,618 of the commander's scans, with
      no exceptions either way. So a grade-5 species always resolves to one colour and a grade-4
      species always offers two. A row mixing the tiers would quietly break that.
    */
    for (const [name, table] of Object.entries(MATERIAL_TABLES)) {
      const mats = Object.keys(table).map(normaliseMaterial);
      const in4 = mats.filter((m) => GRADE_4.map(normaliseMaterial).includes(m)).length;
      const in5 = mats.filter((m) => GRADE_5.map(normaliseMaterial).includes(m)).length;
      expect(in4 === 0 || in5 === 0, `${name} mixes the two material tiers`).toBe(true);
      expect(in4 + in5, `${name} names a material outside both tiers`).toBe(mats.length);
    }
  });

  it("resolves a real colour for every star class, on all three star species", () => {
    // The assertion alcyoneum would have failed for as long as it has existed.
    for (const name of STAR_COLOURED) {
      const rules = find(name).speciesColourRules;
      for (const [cls, colour] of Object.entries(STAR_TABLE)) {
        const guess = inferColour(rules, { parentStarClass: cls, materials: null });
        expect(guess.basis, `${name} on a ${cls} star`).toBe("star");
        expect(guess.colour, `${name} on a ${cls} star`).toBe(colour);
      }
    }
  });

  it("gives a T Tauri star Maroon and not Red", () => {
    /*
      Found by the test above. `TTS` starts with `T`, and the lookup returned the first key that
      fitted in object order — which is plain `T`, Red. Every T Tauri star in the game was being
      coloured as a brown dwarf. The lookup now tries the longest key first.
    */
    for (const name of STAR_COLOURED) {
      const rules = find(name).speciesColourRules;
      expect(inferColour(rules, { parentStarClass: "TTS", materials: null }).colour, name).toBe("Maroon");
      expect(inferColour(rules, { parentStarClass: "T", materials: null }).colour, name).toBe("Red");
    }
  });

  it("reads a class with a subclass and luminosity after it", () => {
    // The journal writes `K5 V`, not `K`. Prefix matching is what handles that, and it has to keep
    // handling it now that the keys are sorted by length.
    const rules = find("Bacterium aurasus").speciesColourRules;
    expect(inferColour(rules, { parentStarClass: "K5 V", materials: null }).colour).toBe("Green");
    expect(inferColour(rules, { parentStarClass: "M3 VZ", materials: null }).colour).toBe("Teal");
  });

  it("ignores the ground for a star species, and the star for a material one", () => {
    /*
      Aurasus was the case: a grade-5 material on the body and a material table on the row meant the
      star was never consulted. Yttrium and a K star together should now give Green from the star,
      not Orange from the ground.
    */
    const aurasus = inferColour(find("Bacterium aurasus").speciesColourRules, {
      materials: [{ Name: "yttrium" }],
      parentStarClass: "K",
    });
    expect(aurasus.colour).toBe("Green");
    expect(aurasus.basis).toBe("star");

    const acies = inferColour(find("Bacterium acies").speciesColourRules, {
      materials: [{ Name: "yttrium" }],
      parentStarClass: "K",
    });
    expect(acies.colour).toBe("Aquamarine");
    expect(acies.basis).toBe("material");
  });

  it("says two colours, not one, when the body carries two of a grade-4 table's materials", () => {
    /*
      Always the case for omentum, scopulum, tela and verrata: two grade-4 materials on every body.
      Returning one of them would read exactly like a derived answer, so the guess stays undecided —
      the precedence between them is not known yet (five observations, all consistent with
      cadmium < molybdenum < tin < niobium/mercury/tungsten, which is far too thin to encode).
    */
    const guess = inferColour(find("Bacterium tela").speciesColourRules, {
      materials: [{ Name: "niobium" }, { Name: "tungsten" }],
      parentStarClass: "K",
    });
    expect(guess.candidates.sort()).toEqual(["Green", "Magenta"]);
    expect(guess.colour).toBeNull();
  });

  it("still reads ED-DSN's spelling of antimony", () => {
    // Their page writes "Antinomy". Anything transcribed from it has to keep landing on the game's
    // "antimony", which is the only spelling a journal will ever produce.
    const guess = inferColour(find("Bacterium acies").speciesColourRules, {
      materials: [{ Name: "Antinomy" }],
      parentStarClass: null,
    });
    expect(guess.colour).toBe("Cyan");
  });
});
