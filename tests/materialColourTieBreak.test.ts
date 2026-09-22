/**
 * Which colour a plant will be, when the body carries more than one of its materials.
 *
 * A material table lists six materials and a body carries two of them about a third of the time. For
 * as long as this feature has existed the answer in that case was both — "Cyan or Orange" — because
 * nothing in the data picked one, and an earlier pass concluded percentage did not decide it.
 *
 * That pass was run against tables we now know were wrong: Fungoida bullarum and setisis read an
 * entirely different set of six elements from gelata and stabitis, so the material credited with a
 * colour was often not the one the game had used. With the commander's four corrected tables the
 * rule is plain — **the rarest material on the body decides** — at 14 of his own 15 Fungoida finds,
 * against 10 for the most abundant.
 *
 * Every case below is one of those finds, materials and percentages straight from his journal.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { colourFromBodyMaterials, type ColourVariantRule } from "../src/shared/colourVariants.js";
import { colourVariantRuleFor } from "../src/server/eddsnColourVariants.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ruleFor = (species: string) => colourVariantRuleFor(root, species.split(" ")[0]!, species);
const mats = (...pairs: [string, number][]) => pairs.map(([Name, Percent]) => ({ Name, Percent }));

describe("the tables the commander corrected", () => {
  it("gives gelata and stabitis one set of elements and bullarum and setisis another", () => {
    /*
      The thing that made the old analysis wrong. Same genus, two disjoint element sets — which is
      why crediting a colour to whichever listed material happened to be present produced nonsense
      for half of Fungoida.
    */
    expect(Object.keys(ruleFor("fungoida gelata")!.map).sort()).toEqual([
      "cadmium",
      "mercury",
      "molybdenum",
      "niobium",
      "tin",
      "tungsten",
    ]);
    expect(Object.keys(ruleFor("fungoida setisis")!.map).sort()).toEqual([
      "antimony",
      "polonium",
      "ruthenium",
      "technetium",
      "tellurium",
      "yttrium",
    ]);
    // Same elements as setisis, different colours — one table per species, not per genus.
    expect(ruleFor("fungoida bullarum")!.map.antimony).toBe("Red");
    expect(ruleFor("fungoida setisis")!.map.antimony).toBe("Peach");
  });
});

describe("a contested body, on the species where the rule was checked", () => {
  it("takes the rarest material — Myiesue CH-L d8-10 body 45, where he found Red", () => {
    /*
      THE ONE THAT MATTERS, and the body that started it. Niobium is the more abundant and maps to
      Green; tin is rarer and maps to Red. The game gave Red.
    */
    const answer = colourFromBodyMaterials(
      ruleFor("fungoida gelata"),
      mats(["niobium", 1.318841], ["tin", 1.150448], ["iron", 19.296915]),
    );
    expect(answer.colour).toBe("Red");
    expect(answer.reason).toContain("tin");
  });

  it("holds on his two earlier gelata finds as well", () => {
    // 2026-09-13: tin 1.53 beats cadmium 1.84. 2026-09-18: niobium 1.38 beats cadmium 1.57.
    expect(
      colourFromBodyMaterials(ruleFor("fungoida gelata"), mats(["cadmium", 1.84], ["tin", 1.53])).colour,
    ).toBe("Red");
    expect(
      colourFromBodyMaterials(ruleFor("fungoida gelata"), mats(["cadmium", 1.57], ["niobium", 1.38])).colour,
    ).toBe("Green");
  });

  it("still answers when only one material is present, as it always did", () => {
    // Bullarum and setisis are never contested in the corpus — one material, one answer.
    expect(colourFromBodyMaterials(ruleFor("fungoida bullarum"), mats(["tellurium", 0.94])).colour).toBe(
      "Gold",
    );
    expect(colourFromBodyMaterials(ruleFor("fungoida setisis"), mats(["antimony", 1.13])).colour).toBe(
      "Peach",
    );
  });
});

describe("where the rule has not been earned", () => {
  it("leaves stabitis undecided rather than confidently wrong", () => {
    /*
      76 Leonis 6 a, 2025-09-04. Stabitis' own table makes molybdenum Magenta and niobium White, and
      molybdenum is the rarer of the two — so the rule would say Magenta. He found **White**. The
      rarest material on that body was antimony at 1.183 %, from the set stabitis is not supposed to
      read at all.

      Until that is resolved in the field, stabitis keeps both candidates. A guess wearing the
      clothes of a derivation is worse than an honest "one of these two".
    */
    const answer = colourFromBodyMaterials(
      ruleFor("fungoida stabitis"),
      mats(["antimony", 1.183], ["molybdenum", 1.257], ["niobium", 1.315]),
    );
    expect(answer.colour, "no single answer claimed").toBeNull();
    expect(answer.candidates.sort()).toEqual(["Magenta", "White"]);
    expect(answer.candidates, "and the colour he actually found is still offered").toContain("White");
  });

  it("leaves every unmarked species undecided too", () => {
    // The tie-break is opt-in per species. Nothing inherits it by being in the same genus or file.
    const unmarked: ColourVariantRule = {
      source: "material",
      map: { tin: "Red", niobium: "Green" },
    };
    const answer = colourFromBodyMaterials(unmarked, mats(["niobium", 1.32], ["tin", 1.15]));
    expect(answer.colour).toBeNull();
    expect(answer.candidates.sort()).toEqual(["Green", "Red"]);
  });

  it("falls back to candidates when the percentages are missing", () => {
    // Some callers only have material names. Ranking without numbers would be invention.
    const rule = { ...ruleFor("fungoida gelata")! };
    const answer = colourFromBodyMaterials(rule, [{ Name: "niobium" }, { Name: "tin" }]);
    expect(answer.colour).toBeNull();
    expect(answer.candidates.sort()).toEqual(["Green", "Red"]);
  });
});

describe("however the source spells it", () => {
  it("reads lower-case name and percent, which is how some records arrive", () => {
    /*
      `PlanetScan.materials` permits Name/Percent and name/percent. Reading only the journal's
      spelling would leave the tie-break silently inert on every record that had been through a
      Spansh or EDSM shape — the failure mode with no symptom.
    */
    const answer = colourFromBodyMaterials(ruleFor("fungoida gelata"), [
      { name: "niobium", percent: 1.32 },
      { name: "tin", percent: 1.15 },
    ]);
    expect(answer.colour).toBe("Red");
  });
});
