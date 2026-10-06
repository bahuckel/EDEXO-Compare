/**
 * Star type from a Spansh/EDSM subType, for stars whose spectralClass is empty. The names are the
 * BodyStarSubType enum of Spansh's galaxy.schema.json (github.com/spansh/elite_dangerous_schemas).
 */
import { describe, expect, it } from "vitest";
import { journalStarTypeFromSubType } from "../src/shared/spanshStarType.js";

describe("journalStarTypeFromSubType", () => {
  it.each([
    ["C Star", "C"],
    ["CJ Star", "CJ"],
    ["CN Star", "CN"],
    ["S-type Star", "S"],
    ["MS-type Star", "MS"],
    ["White Dwarf (DAV) Star", "DAV"],
    ["Black Hole", "H"],
    ["Supermassive Black Hole", "SupermassiveBlackHole"],
    ["Wolf-Rayet NC Star", "WNC"],
    ["Herbig Ae/Be Star", "AeBe"],
    ["T Tauri Star", "TTS"],
    ["M (Red super giant) Star", "M"],
    ["Y (Brown dwarf) Star", "Y"],
  ])("%s -> %s", (subType, type) => {
    expect(journalStarTypeFromSubType(subType)).toBe(type);
  });

  it("names nothing for an empty or unknown subType", () => {
    expect(journalStarTypeFromSubType("")).toBeUndefined();
    expect(journalStarTypeFromSubType("Rogue Planet")).toBeUndefined();
  });
});
