/**
 * Every spelling of a planet class reduces to one class (code review B7, 2026-09-28). The table is the
 * four vocabularies side by side: journal, Spansh / EDSM, species files, codex / companion lists.
 */
import { describe, expect, it } from "vitest";
import { planetClassId, toJournalPlanetClass } from "../src/shared/normalise/planetClass.js";
import { planetClassKey } from "../src/shared/planetClassKey.js";
import { hostStarClassKey } from "../src/shared/hostStarClass.js";
import { expandPlanetTypesToJournalClasses } from "../src/server/speciesCriterionParser.js";

const TABLE: [string, string[]][] = [
  ["Rocky body", ["Rocky body", "Rocky", "rocky"]],
  ["Icy body", ["Icy body", "Icy"]],
  ["Rocky ice body", ["Rocky ice body", "Rocky Ice world", "Rocky Ice"]],
  ["High metal content body", ["High metal content body", "High metal content world", "High Metal Content"]],
  ["Metal rich body", ["Metal rich body", "Metal-rich body", "Metal Rich", "Metal-Rich"]],
  ["Earthlike body", ["Earthlike body", "Earth-like world", "Earth-Like World"]],
  ["Water world", ["Water world", "Water World"]],
  ["Ammonia world", ["Ammonia world", "Ammoniac World"]],
  ["Water giant", ["Water giant", "Water Giant"]],
  [
    "Gas giant with water based life",
    ["Gas giant with water based life", "Gas giant with water-based life", "Gas Giant with water-based life"],
  ],
  [
    "Gas giant with ammonia based life",
    ["Gas giant with ammonia based life", "Gas giant with ammonia-based life"],
  ],
  ["Helium rich gas giant", ["Helium rich gas giant", "Helium-rich gas giant"]],
  ["Sudarsky class I gas giant", ["Sudarsky class I gas giant", "Class I gas giant"]],
  ["Sudarsky class IV gas giant", ["Sudarsky class IV gas giant", "Class IV gas giant"]],
];

describe("one planet class, whoever spells it", () => {
  for (const [journal, spellings] of TABLE) {
    it(journal, () => {
      const ids = new Set(spellings.map((s) => planetClassId(s)));
      expect(ids.size).toBe(1);
      expect([...ids][0]).not.toBeNull();
      for (const s of spellings) {
        expect(toJournalPlanetClass(s)).toBe(journal);
        expect(planetClassKey(s)).toBe(planetClassKey(journal));
      }
    });
  }

  it("reads the species files' hyphenated Metal-Rich (it was dropped)", () => {
    expect(expandPlanetTypesToJournalClasses(["Metal-Rich", "High Metal Content"])).toEqual([
      "Metal rich body",
      "High metal content body",
    ]);
  });

  it("names no class for a label that is not one", () => {
    expect(planetClassId("Airless")).toBeNull();
    expect(expandPlanetTypesToJournalClasses(["Airless"])).toEqual([]);
  });

  it("keys the journal's SupermassiveBlackHole as a black hole, like its spelled-out name", () => {
    expect(hostStarClassKey("SupermassiveBlackHole")).toBe("H");
    expect(hostStarClassKey("Supermassive Black Hole")).toBe("H");
  });
});
