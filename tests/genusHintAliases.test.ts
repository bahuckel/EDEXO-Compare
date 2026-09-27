/**
 * DSS genus labels the game spells differently from our genus names (known-spawn tests, 2026-09-27).
 */
import { describe, expect, it } from "vitest";
import { filterByGenusHints } from "../src/server/genusMatchUtils.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";

const db = loadSpeciesDatabaseFromTree(process.cwd());
const ids = (Genus: string, Genus_Localised: string) =>
  filterByGenusHints(db.species, [{ Genus, Genus_Localised }]).map((e) => e.genusDataDir);

describe("every DSS genus label keeps its genus", () => {
  it("Amphora Plant ($Codex_Ent_Vents_Name;) keeps Amphora", () => {
    expect(ids("$Codex_Ent_Vents_Name;", "Amphora Plant")).toEqual(["amphora"]);
  });

  it("the other non-genus-named organisms keep theirs", () => {
    expect(new Set(ids("$Codex_Ent_Sphere_Name;", "Anemone"))).toEqual(new Set(["anemone"]));
    expect(new Set(ids("$Codex_Ent_Cone_Name;", "Bark Mounds"))).toEqual(new Set(["bark-mound"]));
    expect(new Set(ids("$Codex_Ent_Brancae_Name;", "Brain Tree"))).toEqual(new Set(["brain-tree"]));
    expect(new Set(ids("$Codex_Ent_Tube_Name;", "Sinuous Tubers"))).toEqual(new Set(["sinuous-tubers"]));
  });

  it("every genus the game names maps to at least one species", async () => {
    const { genusNameForCodexToken } = await import("../src/shared/codexGenusNames.js");
    const tokens = [
      "Aleoids", "Bacterial", "Cactoid", "Clypeus", "Conchas", "Electricae", "Fonticulus", "Shrubs",
      "Fumerolas", "Fungoids", "Osseus", "Recepta", "Stratum", "Tubus", "Tussocks",
    ].map((g) => `$Codex_Ent_${g}_Genus_Name;`);
    for (const t of [...tokens, "$Codex_Ent_Vents_Name;", "$Codex_Ent_Sphere_Name;", "$Codex_Ent_Cone_Name;", "$Codex_Ent_Brancae_Name;", "$Codex_Ent_Tube_Name;"]) {
      const name = genusNameForCodexToken(t);
      expect(name, t).toBeTruthy();
      expect(ids(t, name!).length, `${t} → ${name}`).toBeGreaterThan(0);
    }
  });
});
