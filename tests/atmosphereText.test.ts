/**
 * The shared atmosphere steps (Phase 6 dedupe): airless words, density words, CamelCase.
 */
import { describe, expect, it } from "vitest";
import { atmosphereTypeWords, isNoAtmosphereText, stripAtmosphereDensity } from "../src/shared/atmosphereText.js";

describe("atmosphereText", () => {
  it("knows the words for airless", () => {
    for (const t of ["None", "No atmosphere", "no_atmosphere", " none "]) expect(isNoAtmosphereText(t)).toBe(true);
    for (const t of ["", "Neon", "NeonRich"]) expect(isNoAtmosphereText(t)).toBe(false);
  });

  it("drops the density words in front of the gas, in any order", () => {
    expect(stripAtmosphereDensity("Hot thin Sulphur dioxide")).toBe("Sulphur dioxide");
    expect(stripAtmosphereDensity("thick hot Water")).toBe("Water");
    expect(stripAtmosphereDensity("SulphurDioxide")).toBe("SulphurDioxide");
  });

  it("reads the journal's CamelCase", () => {
    expect(atmosphereTypeWords("SulphurDioxide")).toEqual({ words: ["Sulphur", "Dioxide"], rich: false });
    expect(atmosphereTypeWords("NeonRich")).toEqual({ words: ["Neon"], rich: true });
    expect(atmosphereTypeWords("Rich")).toEqual({ words: ["Rich"], rich: false });
  });
});
