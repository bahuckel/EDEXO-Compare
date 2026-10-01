import { describe, expect, it } from "vitest";
import { readableAtmosphereLead, readableAtmosphereType } from "../src/shared/atmosphereLabel.js";

describe("readable atmosphere names (UI review V4)", () => {
  it("turns the journal's AtmosphereType into words", () => {
    expect(readableAtmosphereType("SulphurDioxide")).toBe("Sulphur dioxide");
    expect(readableAtmosphereType("NeonRich")).toBe("Neon-rich");
    expect(readableAtmosphereType("CarbonDioxideRich")).toBe("Carbon dioxide-rich");
    expect(readableAtmosphereType("EarthLike")).toBe("Earth-like");
    expect(readableAtmosphereType("AmmoniaOxygen")).toBe("Ammonia and oxygen");
    expect(readableAtmosphereType("SilicateVapour")).toBe("Silicate vapour");
    expect(readableAtmosphereType("Water")).toBe("Water");
    expect(readableAtmosphereType("None")).toBe("None");
    expect(readableAtmosphereType("")).toBe("");
    expect(readableAtmosphereType(null)).toBeNull();
  });
});

/** Fable review 1.3: the body card and the species quad printed "SulphurDioxide". */
describe("a display line that starts with the journal's type", () => {
  it("makes the leading type readable and keeps the rest", () => {
    expect(readableAtmosphereLead("SulphurDioxide")).toBe("Sulphur dioxide");
    expect(readableAtmosphereLead("CarbonDioxideRich · any thin atmosphere")).toBe("Carbon dioxide-rich · any thin atmosphere");
    expect(readableAtmosphereLead("NeonRich")).toBe("Neon-rich");
  });

  it("leaves words alone: Spansh's names, the journal's sentence, a single gas", () => {
    expect(readableAtmosphereLead("Sulphur dioxide")).toBe("Sulphur dioxide");
    expect(readableAtmosphereLead("thin sulphur dioxide atmosphere")).toBe("thin sulphur dioxide atmosphere");
    expect(readableAtmosphereLead("Neon · codex allows ALL atmospheres")).toBe("Neon · codex allows ALL atmospheres");
    expect(readableAtmosphereLead("Thin Carbon dioxide")).toBe("Thin Carbon dioxide");
  });
});
