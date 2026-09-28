/**
 * The colour-named plants (owner, 2026-09-28).
 *
 * 1. The species tree lists Brain Trees and Sinuous Tubers genus first ("Brain Tree Aureum"); the game
 *    writes them colour first everywhere ("Aureum Brain Tree" in `ScanOrganic`, `CodexEntry` and the
 *    codex dumps). Compared as written, a sample never resolved to its row and the codex badge called
 *    every one unlogged.
 * 2. Their colour is the species — Anemone, Brain Tree, Tubers — or there is only one (Bark Mounds,
 *    Amphora, Shards, Ingensradices), so no colour is predicted or shown for them.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectResolvedOrganicLockSpeciesIds } from "../src/server/organicLocks.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import {
  candidateMorphColorLabelByLight,
  candidateMorphColorShortLabel,
  candidateMorphColorShortLabelForHosts,
  speciesHasColourVariants,
} from "../src/shared/candidateSpawnHints.js";
import { codexHasSpecies, codexNewColoursInRegion, gameOrderSpeciesName } from "../src/shared/codexLog.js";
import { infoGatherReasons } from "../src/shared/infoGather.js";
import type { OrganicGenusLock } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = loadSpeciesDatabaseFromTree(root);
const byId = (id: string) => db.species.find((e) => e.id === id)!;

describe("the game's word order", () => {
  it("turns the tree's genus-first names round, and leaves every other name alone", () => {
    expect(gameOrderSpeciesName("Brain Tree Aureum")).toBe("Aureum Brain Tree");
    expect(gameOrderSpeciesName("Sinuous Tubers Albidum")).toBe("Albidum Sinuous Tubers");
    expect(gameOrderSpeciesName("Aureum Brain Tree")).toBe("Aureum Brain Tree");
    expect(gameOrderSpeciesName("Luteolum Anemone")).toBe("Luteolum Anemone");
    expect(gameOrderSpeciesName("Stratum tectonicas")).toBe("Stratum tectonicas");
  });

  it("resolves a Brain Tree and a Tuber sample to its own row", () => {
    const lock = (genus: string, species: string): OrganicGenusLock =>
      ({
        genusLocalised: genus,
        genusSymbol: "",
        speciesLocalised: species,
        variantLocalised: species,
      }) as OrganicGenusLock;
    expect(collectResolvedOrganicLockSpeciesIds([lock("Brain Tree", "Aureum Brain Tree")], db)).toEqual([
      "brain_trees_brain_tree_aureum",
    ]);
    expect(
      collectResolvedOrganicLockSpeciesIds([lock("Sinuous Tubers", "Roseum Sinuous Tubers")], db),
    ).toEqual([byId("sinuous_tuber_sinuous_tubers_roseum").id]);
    expect(collectResolvedOrganicLockSpeciesIds([lock("Anemone", "Croceum Anemone")], db)).toEqual([
      "anemone_croceum",
    ]);
  });

  it("finds a logged Brain Tree in the codex", () => {
    const logged = new Set(["aureum brain tree"]);
    expect(codexHasSpecies(logged, "Brain Tree Aureum")).toBe(true);
    expect(codexHasSpecies(logged, "Brain Tree Roseum")).toBe(false);
    const regional = new Set(["inner orion spur|aureum brain tree|*"]);
    expect(codexNewColoursInRegion(regional, "Inner Orion Spur", "Brain Tree Aureum", "")).toBeNull();
    expect(codexNewColoursInRegion(regional, "Inner Orion Spur", "Brain Tree Viride", "")).toEqual([]);
  });
});

describe("plants with no colour variants", () => {
  const fixed = [
    "anemone_luteolum",
    "brain_trees_brain_tree_aureum",
    "sinuous_tuber_sinuous_tubers_roseum",
    "crystalline_shards_crystalline_shards",
    "ingensradices_ingensradices_unicus",
    "bark_mounds_bark_mounds",
    "amphora_amphora_plant",
  ];

  it("predict no colour, whatever the star", () => {
    for (const id of fixed) {
      const e = byId(id);
      expect(e, id).toBeDefined();
      expect(speciesHasColourVariants(e), id).toBe(false);
      expect(candidateMorphColorShortLabel(e, "B"), id).toBe("");
      expect(candidateMorphColorShortLabelForHosts(e, ["B", "K"]), id).toBe("");
      expect(candidateMorphColorLabelByLight(e, ["B", "K"]), id).toBe("");
    }
  });

  it("keep predicting for everything else", () => {
    const stratum = byId("stratum_stratum_tectonicas");
    expect(speciesHasColourVariants(stratum)).toBe(true);
    expect(candidateMorphColorShortLabel(stratum, "F")).not.toBe("");
  });

  it("carry no 'colour unknown' tag", () => {
    expect(infoGatherReasons({ colourLabel: "", hasColourVariants: false })).toEqual([]);
    expect(infoGatherReasons({ colourLabel: "", hasColourVariants: false, collectionFocus: true })).toEqual([
      "thin-data",
    ]);
    expect(infoGatherReasons({ colourLabel: "(unknown)" })).toEqual(["colour-unknown"]);
  });
});
