import { describe, expect, it } from "vitest";
import { readableAtmosphereType } from "../src/shared/atmosphereLabel.js";

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
