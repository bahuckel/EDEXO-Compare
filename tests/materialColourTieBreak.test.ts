/**
 * Which colour a plant will be, when the body carries more than one of its materials.
 *
 * A material table lists six materials and a body carries two of them about a third of the time. For
 * as long as this feature has existed the answer in that case was both — "Cyan or Orange" — because
 * nothing in the data picked one, and an earlier pass concluded percentage did not decide it.
 *
 * A rule was found and withdrawn. "The rarest of the species' own materials decides" held on 14 of
 * the owner's 15 Fungoida finds and shipped in 1.1.2; an EDDN capture of 25,858 bodies then gave
 * 14,502 codex entries whose variant suffix **names the deciding material outright**, and across the
 * 907 contested bodies the rarest won 445 and lost 462. A fixed per-species priority fails too.
 *
 * So both candidates are offered again, and that is the state these cases pin. It costs the
 * commander nothing: colour decides which photograph is shown, not what the plant is worth.
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

describe("a contested body", () => {
  it("offers both colours rather than naming one — Myiesue CH-L d8-10 body 45", () => {
    /*
      THE ONE THAT MATTERS. This body found the rule and then the EDDN capture unfound it: the
      commander's plant was Red and tin is the rarer material here, which is exactly the coincidence
      that made fifteen observations look conclusive.
    */
    const answer = colourFromBodyMaterials(
      ruleFor("fungoida gelata"),
      mats(["niobium", 1.318841], ["tin", 1.150448], ["iron", 19.296915]),
    );
    expect(answer.colour, "no single colour claimed").toBeNull();
    expect(answer.candidates.sort()).toEqual(["Green", "Red"]);
  });

  it("keeps no table marked with a tie-break, so nothing names a colour by rank", () => {
    for (const sp of ["fungoida gelata", "fungoida bullarum", "fungoida setisis", "fungoida stabitis"]) {
      expect(ruleFor(sp)!.tieBreak, sp).toBeUndefined();
    }
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
      `PlanetScan.materials` permits Name/Percent and name/percent. The colour still comes back as a
      pair, but both materials must be *seen* — reading one spelling only would drop a candidate and
      turn an honest "Green or Red" into a confident "Red".
    */
    const answer = colourFromBodyMaterials(ruleFor("fungoida gelata"), [
      { name: "niobium", percent: 1.32 },
      { name: "tin", percent: 1.15 },
    ]);
    expect(answer.candidates.sort()).toEqual(["Green", "Red"]);
  });
});
