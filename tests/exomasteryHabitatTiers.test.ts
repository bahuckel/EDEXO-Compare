import { describe, expect, it } from "vitest";
import {
  EXOMASTERY_HABITAT_TIER_WEIGHT,
  exomasteryHabitatTier,
  exomasteryHabitatTierWeight,
} from "../src/server/exomasteryHabitatTiers.js";

/**
 * Every path below is one the feeder actually ships in the 79 profiles, spelled the way it is
 * spelled there. A tier that disagrees with the real key silently stops applying.
 */
describe("exomasteryHabitatTier", () => {
  it("puts the five primary conditions in the primary tier", () => {
    for (const p of [
      "body.gravity",
      "body.surfaceTemperature",
      "body.surfacePressure",
      "body.subType",
      "body.atmosphereType",
    ]) {
      expect(exomasteryHabitatTier(p), p).toBe("primary");
    }
  });

  it("demotes every orbital path the feeder ships", () => {
    for (const p of [
      "body.orbitalPeriod",
      "body.semiMajorAxis",
      "body.orbitalInclination",
      "body.argOfPeriapsis",
      "body.rotationalPeriod",
      "body.orbitalEccentricity",
      "body.rotationalPeriodTidallyLocked",
    ]) {
      expect(exomasteryHabitatTier(p), p).toBe("background");
    }
  });

  it("demotes orbital elements no profile carries yet, so they arrive weighted down", () => {
    expect(exomasteryHabitatTier("body.ascendingNode")).toBe("background");
    expect(exomasteryHabitatTier("body.meanAnomaly")).toBe("background");
  });

  it("leaves the rest at standard weight", () => {
    for (const p of [
      "body.earthMasses",
      "body.radius",
      // Kept deliberately: distance_from_star is a real gate on Clypeus speculumi.
      "body.distanceToArrival",
      "body.volcanismType",
      "body.terraformingState",
      "exo.host_star_spectral_primary",
      "materials.Iron",
      "solidComposition.Rock",
    ]) {
      expect(exomasteryHabitatTier(p), p).toBe("standard");
    }
  });

  it("separates atmosphere type from the per-gas composition fractions", () => {
    expect(exomasteryHabitatTier("body.atmosphereType")).toBe("primary");
    expect(exomasteryHabitatTier("body.atmosphereComposition.Carbon dioxide")).toBe("standard");
    expect(exomasteryHabitatTier("atmosphereComposition.Sulphur dioxide")).toBe("standard");
  });

  it("never lets a primary keyword rescue an orbital path", () => {
    // "Rotational period tidally locked" reads like a body property; it is orbital mechanics.
    expect(exomasteryHabitatTier("body.rotationalPeriodTidallyLocked")).toBe("background");
    expect(exomasteryHabitatTierWeight("body.rotationalPeriodTidallyLocked")).toBeLessThan(
      exomasteryHabitatTierWeight("body.gravity"),
    );
  });

  it("orders the weights primary > standard > background, and demotes rather than deletes", () => {
    const { primary, standard, background } = EXOMASTERY_HABITAT_TIER_WEIGHT;
    expect(primary).toBeGreaterThan(standard);
    expect(standard).toBeGreaterThan(background);
    // Demote, never delete: a zero weight would be the wall the owner ruled out.
    expect(background).toBeGreaterThan(0);
  });

  it("falls back to standard for an unknown or empty path", () => {
    expect(exomasteryHabitatTier("")).toBe("standard");
    expect(exomasteryHabitatTier("body.somethingTheFeederHasNotShippedYet")).toBe("standard");
  });
});
