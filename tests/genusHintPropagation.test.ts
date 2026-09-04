import { describe, expect, it } from "vitest";
import { filterByGenusHints } from "../src/server/genusMatchUtils.js";
import type { GenusHint, SpeciesEntry } from "../src/shared/types.js";

function entry(id: string, genus: string, dir: string): SpeciesEntry {
  return { id, displayName: id, genus, genusDataDir: dir, criteria: {} } as unknown as SpeciesEntry;
}

function hint(symbol: string, localised: string): GenusHint {
  return { Genus: symbol, Genus_Localised: localised } as GenusHint;
}

const DB = [
  entry("bacterium_aurasus", "Bacterium", "bacterium"),
  entry("fonticulua_digitos", "Fonticulua", "fonticulua"),
  entry("stratum_paleas", "Stratum", "stratum"),
  entry("concha_labiata", "Concha", "concha"),
];

/**
 * The hint filter itself is correct — it keeps exactly the genera it is given. The defect it was
 * blamed for lived upstream in `propagateExoAmongSimilarMoons`, which overwrote a sibling moon's own
 * DSS genus list with a neighbour's instead of merging, so genera the commander later scanned on that
 * moon had already been deleted from its hints. These tests pin the filter's contract so the
 * distinction stays visible: given the right hints it keeps the right species, and given a partial
 * list it will faithfully drop the rest — which is why the list must never be narrowed by accident.
 */
describe("filterByGenusHints", () => {
  it("keeps every species whose genus is hinted", () => {
    const out = filterByGenusHints(DB, [
      hint("$Codex_Ent_Bacterial_Genus_Name;", "Bacterium"),
      hint("$Codex_Ent_Fonticulus_Genus_Name;", "Fonticulua"),
    ]);
    expect(out.map((e) => e.id)).toEqual(["bacterium_aurasus", "fonticulua_digitos"]);
  });

  it("drops a genus that is missing from the hints — the reason a partial list is destructive", () => {
    // The real-world case: moon 5 c carried [Bacterium] after a sibling's DSS overwrote its hints,
    // and Fonticulua digitos — which the commander went on to scan there — vanished from the list.
    const out = filterByGenusHints(DB, [hint("$Codex_Ent_Bacterial_Genus_Name;", "Bacterium")]);
    expect(out.map((e) => e.id)).toEqual(["bacterium_aurasus"]);
    expect(out.some((e) => e.id === "fonticulua_digitos")).toBe(false);
  });

  it("returns everything when there are no hints — the post-FSS case", () => {
    expect(filterByGenusHints(DB, null)).toHaveLength(DB.length);
    expect(filterByGenusHints(DB, [])).toHaveLength(DB.length);
  });

  it("matches the localised name that every journal hint carries", () => {
    // Measured over 244 journals: 1,316 genus hints, all 1,316 with Genus_Localised.
    const out = filterByGenusHints(DB, [hint("$Codex_Ent_Conchas_Genus_Name;", "Concha")]);
    expect(out.map((e) => e.id)).toEqual(["concha_labiata"]);
  });

  it("tolerates a plural label — the journal symbols pluralise (Conchas, Tussocks)", () => {
    const out = filterByGenusHints(DB, [hint("$Codex_Ent_Conchas_Genus_Name;", "Conchas")]);
    expect(out.map((e) => e.id)).toEqual(["concha_labiata"]);
  });

  it("maps the Bacterial symbol onto the Bacterium folder", () => {
    const out = filterByGenusHints(DB, [hint("$Codex_Ent_Bacterial_Genus_Name;", "Bacterial")]);
    expect(out.map((e) => e.id)).toEqual(["bacterium_aurasus"]);
  });
});
