import { describe, expect, it } from "vitest";
import type { PlanetScan } from "../src/shared/types.js";
import {
  type ExomasteryProfileV1,
  exomasteryHabitatQualityPercent,
} from "../src/server/exomasteryProfile.js";

/** A rollup the scorer reads as "the sample agrees strongly on this value". */
function tight(mode: number): {
  min: number;
  max: number;
  mean: number;
  count: number;
  mode: number;
  modeCount: number;
} {
  return { min: mode * 0.98, max: mode * 1.02, mean: mode, count: 100, mode, modeCount: 90 };
}

/**
 * Gravity, temperature and pressure in the primary tier; the six orbital paths in the background
 * tier. Real feeder key spellings — the tier lookup matches on the path, so a renamed key stops
 * applying silently.
 */
const PROFILE: ExomasteryProfileV1 = {
  formatVersion: 1,
  speciesLabel: "Test species",
  numerics: {
    "body.gravity": tight(0.4),
    "body.surfaceTemperature": tight(180),
    "body.surfacePressure": tight(0.03),
    "body.orbitalPeriod": tight(400),
    "body.semiMajorAxis": tight(2),
    "body.orbitalInclination": tight(10),
    "body.argOfPeriapsis": tight(90),
    "body.rotationalPeriod": tight(30),
    "body.orbitalEccentricity": tight(0.01),
  },
  materials: {},
  atmosphereComposition: {},
  solidComposition: {},
};

const AU_METERS = 149_597_870_700;
const SECONDS_PER_DAY = 86_400;

function scan(input: {
  gravityG: number;
  temperatureK: number;
  pressureAtm: number;
  orbitalPeriodDays: number;
  semiMajorAxisAu: number;
  inclination: number;
  periapsis: number;
  rotationDays: number;
  eccentricity: number;
}): PlanetScan {
  return {
    PlanetClass: "High metal content body",
    // Journal units: gravity in m/s^2, pressure in Pa, periods in seconds, axis in metres.
    SurfaceGravity: input.gravityG * 9.80665,
    SurfaceTemperature: input.temperatureK,
    SurfacePressure: input.pressureAtm * 101_325,
    OrbitalPeriod: input.orbitalPeriodDays * SECONDS_PER_DAY,
    SemiMajorAxis: input.semiMajorAxisAu * AU_METERS,
    OrbitalInclination: input.inclination,
    Periapsis: input.periapsis,
    RotationPeriod: input.rotationDays * SECONDS_PER_DAY,
    Eccentricity: input.eccentricity,
  } as unknown as PlanetScan;
}

const ON_PROFILE = {
  gravityG: 0.4,
  temperatureK: 180,
  pressureAtm: 0.03,
  orbitalPeriodDays: 400,
  semiMajorAxisAu: 2,
  inclination: 10,
  periapsis: 90,
  rotationDays: 30,
  eccentricity: 0.01,
};

/**
 * The point of the tiers: sample concentration measures how *consistent* a parameter is, not how
 * much it decides where a species grows. A moon whose orbital period clusters tightly says only that
 * the commanders who found it were looking at similar moons.
 */
describe("habitat scoring weights primary conditions over orbital geometry", () => {
  it("scores a body that matches gravity, temperature and pressure above one that matches only the orbit", () => {
    const rightPhysics = exomasteryHabitatQualityPercent(
      PROFILE,
      scan({
        ...ON_PROFILE,
        orbitalPeriodDays: 4000,
        semiMajorAxisAu: 40,
        inclination: 80,
        periapsis: 300,
        rotationDays: 900,
        eccentricity: 0.6,
      }),
      null,
    );
    const rightOrbit = exomasteryHabitatQualityPercent(
      PROFILE,
      scan({ ...ON_PROFILE, gravityG: 4, temperatureK: 700, pressureAtm: 8 }),
      null,
    );

    expect(rightPhysics).not.toBeNull();
    expect(rightOrbit).not.toBeNull();
    expect(rightPhysics!).toBeGreaterThan(rightOrbit!);
  });

  it("still lets orbital geometry move the score - demoted, not deleted", () => {
    const onProfile = exomasteryHabitatQualityPercent(PROFILE, scan(ON_PROFILE), null)!;
    const orbitOff = exomasteryHabitatQualityPercent(
      PROFILE,
      scan({ ...ON_PROFILE, orbitalPeriodDays: 4000, semiMajorAxisAu: 40, eccentricity: 0.6 }),
      null,
    )!;
    expect(orbitOff).toBeLessThan(onProfile);
  });

  it("moves the score further when a primary condition is wrong than when the whole orbit is", () => {
    const onProfile = exomasteryHabitatQualityPercent(PROFILE, scan(ON_PROFILE), null)!;
    const gravityOff = exomasteryHabitatQualityPercent(PROFILE, scan({ ...ON_PROFILE, gravityG: 4 }), null)!;
    const wholeOrbitOff = exomasteryHabitatQualityPercent(
      PROFILE,
      scan({
        ...ON_PROFILE,
        orbitalPeriodDays: 4000,
        semiMajorAxisAu: 40,
        inclination: 80,
        periapsis: 300,
        rotationDays: 900,
        eccentricity: 0.6,
      }),
      null,
    )!;
    // One of five primaries outweighs all six orbital paths together.
    expect(onProfile - gravityOff).toBeGreaterThan(onProfile - wholeOrbitOff);
  });
});
