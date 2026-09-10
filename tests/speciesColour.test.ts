/**
 * Naming the colour variant before the commander lands.
 *
 * Reported from the field: Blu Thua VH-G b38-1 1 showed "Bacterium Vesicula (unknown)" when the only
 * colour-driving material on the body was yttrium — which makes it Lime, with certainty, by a rule
 * the app already had in its own data and never applied.
 */
import { describe, expect, it } from "vitest";
import { colourFromMaterials, colourFromStar, inferColour, normaliseMaterial } from "../src/shared/speciesColour.js";

/** Bacterium vesicula's real rule, from data/species/bacterium/bacterium_new.json. */
const VESICULA = {
  type: "material_based",
  mapping: {
    Antinomy: "Cyan",
    Polonium: "Orange",
    Ruthenium: "Mulberry",
    Technetium: "Gold",
    Tellurium: "Red",
    Yttrium: "Lime",
  },
};

/** The body's real material list, from the journal. */
const BLU_THUA = [
  "sulphur",
  "carbon",
  "iron",
  "nickel",
  "phosphorus",
  "chromium",
  "manganese",
  "vanadium",
  "cadmium",
  "molybdenum",
  "yttrium",
].map((Name) => ({ Name }));

describe("the case from the field", () => {
  it("names Lime from yttrium", () => {
    const g = colourFromMaterials(VESICULA, BLU_THUA);
    expect(g.colour).toBe("Lime");
    expect(g.basis).toBe("material");
    expect(g.reason).toContain("Yttrium");
  });

  it("ignores the common materials that say nothing", () => {
    // Iron is on almost every body. Only the six rare ones decide anything.
    const g = colourFromMaterials(VESICULA, [{ Name: "iron" }, { Name: "nickel" }]);
    expect(g.colour).toBeNull();
    expect(g.basis).toBe("none");
  });
});

describe("the misspelling in our own data", () => {
  it("matches the game's antimony against our Antinomy", () => {
    // Ten species carry the misspelling. Left alone none of them would ever resolve a colour.
    expect(normaliseMaterial("Antinomy")).toBe(normaliseMaterial("antimony"));
    const g = colourFromMaterials(VESICULA, [{ Name: "antimony" }]);
    expect(g.colour).toBe("Cyan");
  });
});

describe("when the body cannot decide", () => {
  it("returns both rather than picking one", () => {
    // Two colour-driving materials: the rule genuinely does not decide, and choosing would be a
    // guess that reads exactly like a derivation.
    const g = colourFromMaterials(VESICULA, [{ Name: "yttrium" }, { Name: "polonium" }]);
    expect(g.colour).toBeNull();
    expect(g.candidates.sort()).toEqual(["Lime", "Orange"]);
    expect(g.reason).toContain("→");
  });

  it("says nothing when there are no materials at all", () => {
    expect(colourFromMaterials(VESICULA, []).basis).toBe("none");
    expect(colourFromMaterials(VESICULA, null).basis).toBe("none");
  });
});

describe("star-driven species", () => {
  const byStar = { type: "star_based", mapping: { K: "Teal", M: "Green", F: "Yellow" } };

  it("reads the class letter off a full spectral string", () => {
    expect(colourFromStar(byStar, "K5 V").colour).toBe("Teal");
  });

  it("says nothing without a parent star", () => {
    // Never fall back to the arrival star: in a multi-star system it is routinely a different one,
    // and a wrong colour costs nothing to print and everything to trust.
    expect(colourFromStar(byStar, null).basis).toBe("none");
    expect(colourFromStar(byStar, "").basis).toBe("none");
  });

  it("does not apply a star rule to a material species", () => {
    expect(colourFromStar(VESICULA, "K").basis).toBe("none");
  });
});

describe("choosing a rule", () => {
  it("uses whichever the species actually has", () => {
    expect(inferColour(VESICULA, { materials: BLU_THUA }).colour).toBe("Lime");
    expect(inferColour({ type: "star_based", mapping: { A: "Blue" } }, { parentStarClass: "A" }).colour).toBe(
      "Blue",
    );
  });

  it("returns nothing for a species with no colour rule", () => {
    expect(inferColour(null, { materials: BLU_THUA }).basis).toBe("none");
    expect(inferColour({}, { materials: BLU_THUA }).basis).toBe("none");
  });
});
