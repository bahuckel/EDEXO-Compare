import { describe, expect, it } from "vitest";
import { codexHasSpecies, codexSpeciesFromLine, codexSpeciesKey } from "../src/shared/codexLog.js";

/**
 * Real lines, trimmed to the fields read. The first is the one B4 is about; the second is why the
 * category has to be checked at all — the journal logs a codex page for stars too.
 */
const BIO_ENTRY = {
  event: "CodexEntry",
  Name: "$Codex_Ent_Fonticulus_05_M_Name;",
  Name_Localised: "Fonticulua Fluctus - Amethyst",
  Category: "$Codex_Category_Biology;",
  Category_Localised: "Biological and Geological",
  IsNewEntry: true,
};

const STAR_ENTRY = {
  event: "CodexEntry",
  Name: "$Codex_Ent_DQ_Type_Name;",
  Name_Localised: "DQ Type Star",
  Category: "$Codex_Category_StellarBodies;",
  Category_Localised: "Astronomical Bodies",
  IsNewEntry: true,
};

describe("codexSpeciesKey", () => {
  /** The colour variant is a fact about the host star, not the species. */
  it("drops the colour variant and the case", () => {
    expect(codexSpeciesKey("Fonticulua Fluctus - Amethyst")).toBe("fonticulua fluctus");
    expect(codexSpeciesKey("Fonticulua fluctus")).toBe("fonticulua fluctus");
    expect(codexSpeciesKey("Stratum Tectonicas - Emerald")).toBe("stratum tectonicas");
  });

  it("gives the journal and the species tree the same key", () => {
    expect(codexSpeciesKey("Bacterium Aurasus - Lime")).toBe(codexSpeciesKey("Bacterium aurasus"));
  });
});

describe("codexSpeciesFromLine", () => {
  it("takes the species out of a biology entry", () => {
    expect(codexSpeciesFromLine(BIO_ENTRY)).toBe("fonticulua fluctus");
  });

  it("ignores a codex entry that is not about biology", () => {
    expect(codexSpeciesFromLine(STAR_ENTRY)).toBeNull();
  });

  it("ignores anything that is not a codex entry", () => {
    expect(codexSpeciesFromLine({ ...BIO_ENTRY, event: "Scan" })).toBeNull();
    expect(codexSpeciesFromLine({ event: "CodexEntry", Category_Localised: "Biological" })).toBeNull();
  });
});

describe("codexHasSpecies", () => {
  const logged = new Set(["fonticulua fluctus", "bacterium aurasus"]);

  it("recognises a species however the two sides spell it", () => {
    expect(codexHasSpecies(logged, "Fonticulua fluctus")).toBe(true);
    expect(codexHasSpecies(logged, "Bacterium Aurasus")).toBe(true);
  });

  it("says no for a species with no page", () => {
    expect(codexHasSpecies(logged, "Stratum tectonicas")).toBe(false);
  });

  /**
   * A genus-level key would mark every Bacterium as logged the moment one of them was, which is the
   * one way this badge could actively mislead.
   */
  it("refuses to answer on a genus name alone", () => {
    expect(codexHasSpecies(new Set(["bacterium"]), "Bacterium")).toBe(false);
  });
});
