/**
 * Demoting a species on an atmosphere it is recorded on but rarely wins.
 *
 * The owner's call after the genus comparison: *"demote tela on CO2, ammonia, nitrogen and argon."*
 *
 * The measurement behind it is a within-genus one, and that is the part worth not losing. Comparing a
 * species against all bio bodies says what kind of world it likes; comparing it against **its own
 * genus** says what it beat, and since the game places one genus per biological signal the siblings
 * are rivals for one slot. Across 14,136 corpus bodies carrying Bacterium, tela's share of the ones
 * on each atmosphere is:
 *
 * ```
 * neon-rich 57.9 %   water 47.4 %   methane 9.1 %   sulphur dioxide 8.3 %
 * argon 1.8 %   carbon dioxide 0.3 %   ammonia 0.3 %   nitrogen 0.3 %
 * ```
 *
 * On carbon dioxide it takes 20 bodies of 6,904. That is not "cannot grow there" — the twenty exist —
 * so this demotes and never excludes.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atmosphereIsUnfavoured, atmospherePreferenceKey } from "../src/shared/atmospherePreference.js";
import { demoteUnfavouredAtmospheres } from "../src/server/matchSpecies.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import type { PlanetScan, SpeciesMatch } from "../src/shared/types.js";

const TELA_UNFAVOURED = ["Carbon dioxide", "Ammonia", "Nitrogen", "Argon"];

describe("matching the atmosphere across two spellings", () => {
  it("reads the journal's spelling against the row's", () => {
    // The row says "Carbon dioxide"; the journal says "CarbonDioxide"; EDSM says "Thin Carbon dioxide".
    expect(atmospherePreferenceKey("CarbonDioxide")).toBe("carbondioxide");
    expect(atmospherePreferenceKey("Thin Carbon dioxide")).toBe("carbondioxide");
    expect(atmospherePreferenceKey("Hot thin Carbon dioxide")).toBe("carbondioxide");
    expect(atmosphereIsUnfavoured(TELA_UNFAVOURED, "CarbonDioxide")).toEqual({ matched: "Carbon dioxide" });
    expect(atmosphereIsUnfavoured(TELA_UNFAVOURED, "Thin Ammonia")).toEqual({ matched: "Ammonia" });
  });

  it("says nothing about an atmosphere that is not on the list", () => {
    // Water and sulphur dioxide are where it actually wins; neon-rich most of all.
    expect(atmosphereIsUnfavoured(TELA_UNFAVOURED, "Water")).toBeNull();
    expect(atmosphereIsUnfavoured(TELA_UNFAVOURED, "SulphurDioxide")).toBeNull();
    expect(atmosphereIsUnfavoured(TELA_UNFAVOURED, "NeonRich")).toBeNull();
  });

  it("says nothing when the species names none, or the body's atmosphere is unknown", () => {
    expect(atmosphereIsUnfavoured(undefined, "CarbonDioxide")).toBeNull();
    expect(atmosphereIsUnfavoured([], "CarbonDioxide")).toBeNull();
    expect(atmosphereIsUnfavoured(TELA_UNFAVOURED, "")).toBeNull();
    expect(atmosphereIsUnfavoured(TELA_UNFAVOURED, null)).toBeNull();
  });
});

function match(id: string, unfavoured?: string[]): Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits"> {
  return {
    entry: {
      id,
      displayName: id,
      genus: "Bacterium",
      genusDataDir: "bacterium",
      criteria: unfavoured ? { atmosphereUnfavouredAnyOf: unfavoured } : {},
    },
    reasons: [],
  } as unknown as Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">;
}

const scan = (atmosphere: string) => ({ AtmosphereType: atmosphere }) as unknown as PlanetScan;

describe("the demotion", () => {
  it("moves the row on an unfavoured atmosphere, with the reason", () => {
    const strict = [match("tela", TELA_UNFAVOURED), match("aurasus")];
    const unlikely: typeof strict = [];
    demoteUnfavouredAtmospheres(strict, unlikely, scan("CarbonDioxide"));
    expect(strict.map((m) => m.entry.id)).toEqual(["aurasus"]);
    expect(unlikely[0]!.unlikelyReasons?.[0]?.field).toBe("Atmosphere");
    expect(unlikely[0]!.unlikelyReasons?.[0]?.detail).toContain("Carbon dioxide");
  });

  it("leaves it alone where it actually wins", () => {
    const strict = [match("tela", TELA_UNFAVOURED)];
    const unlikely: typeof strict = [];
    demoteUnfavouredAtmospheres(strict, unlikely, scan("Water"));
    expect(strict).toHaveLength(1);
    expect(unlikely).toHaveLength(0);
  });

  it("never touches a species that names no unfavoured atmosphere", () => {
    /*
      The sabotage check. Twelve other Bacterium species carry no such list, and a gate that fired on
      them would quietly narrow the whole genus — the opposite of what was asked for.
    */
    const strict = [match("aurasus"), match("cerbrus")];
    const unlikely: typeof strict = [];
    demoteUnfavouredAtmospheres(strict, unlikely, scan("CarbonDioxide"));
    expect(strict).toHaveLength(2);
    expect(unlikely).toHaveLength(0);
  });

  it("does nothing when the body has no atmosphere reading", () => {
    const strict = [match("tela", TELA_UNFAVOURED)];
    const unlikely: typeof strict = [];
    demoteUnfavouredAtmospheres(strict, unlikely, {} as unknown as PlanetScan);
    expect(strict).toHaveLength(1);
  });
});

describe("the shipped row", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const db = loadSpeciesDatabaseFromTree(root);

  it("carries the four atmospheres the owner chose, and only tela does", () => {
    const tela = db.species.find((e) => e.displayName === "Bacterium tela");
    expect(tela?.criteria.atmosphereUnfavouredAnyOf).toEqual(TELA_UNFAVOURED);

    const others = db.species.filter(
      (e) => e.displayName !== "Bacterium tela" && e.criteria.atmosphereUnfavouredAnyOf?.length,
    );
    expect(others.map((e) => e.displayName)).toEqual([]);
  });

  it("does not list the atmospheres tela is known for", () => {
    // Water and neon-rich are where it takes roughly half its genus. Listing either would be a typo
    // with a large blast radius, and nothing else in the file would catch it.
    const tela = db.species.find((e) => e.displayName === "Bacterium tela");
    const keys = (tela?.criteria.atmosphereUnfavouredAnyOf ?? []).map(atmospherePreferenceKey);
    expect(keys).not.toContain("water");
    expect(keys).not.toContain("neonrich");
    expect(keys).not.toContain("sulphurdioxide");
  });
});
