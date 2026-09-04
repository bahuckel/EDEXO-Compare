import { describe, expect, it } from "vitest";
import { estimateTemperatureRange, type PlanetInput } from "../src/shared/temperatureRangeEstimator.js";

/**
 * The band this returns is what the matcher compares against every species' codex temperature
 * gate, so a silent change here changes which species the app predicts on every body.
 */
const base: PlanetInput = {
  tidalLock: false,
  volcanism: false,
  atmosphere: "thin",
  bodyClass: "icy",
};

describe("estimateTemperatureRange", () => {
  it("blends the journal temperature 65/35 against the body-class bias", () => {
    // icy bias is 150 K: 0.65 * 300 + 0.35 * 150 = 247.5
    expect(estimateTemperatureRange({ ...base, surfaceTemperature: 300 })).toEqual({
      tMin: 193,
      tMid: 248,
      tMax: 292,
    });
  });

  it("falls back to the body-class bias when the journal has no temperature", () => {
    expect(estimateTemperatureRange({ ...base, bodyClass: "rocky_standard" }).tMid).toBe(240);
    expect(estimateTemperatureRange({ ...base, bodyClass: "icy" }).tMid).toBe(150);
    expect(estimateTemperatureRange({ ...base, bodyClass: "high_metal_hot" }).tMid).toBe(750);
  });

  it("keeps tMin ≤ tMid ≤ tMax across every body class", () => {
    const classes = ["icy", "rocky_cold", "rocky_standard", "rocky_thin_atmo", "high_metal_hot"] as const;
    for (const bodyClass of classes) {
      for (const surfaceTemperature of [undefined, 60, 200, 800]) {
        const r = estimateTemperatureRange({ ...base, bodyClass, surfaceTemperature });
        expect(r.tMin).toBeLessThanOrEqual(r.tMid);
        expect(r.tMid).toBeLessThanOrEqual(r.tMax);
      }
    }
  });

  it("widens the band for a tidally locked body without moving its centre", () => {
    const free = estimateTemperatureRange({ ...base, surfaceTemperature: 300 });
    const locked = estimateTemperatureRange({ ...base, surfaceTemperature: 300, tidalLock: true });
    expect(locked.tMid).toBe(free.tMid);
    expect(locked.tMax - locked.tMin).toBeGreaterThan(free.tMax - free.tMin);
  });

  it("widens the band for volcanism and for a closer orbit", () => {
    const quiet = estimateTemperatureRange({ ...base, surfaceTemperature: 300 });
    const volcanic = estimateTemperatureRange({ ...base, surfaceTemperature: 300, volcanism: true });
    expect(volcanic.tMax - volcanic.tMin).toBeGreaterThan(quiet.tMax - quiet.tMin);

    const far = estimateTemperatureRange({ ...base, surfaceTemperature: 300, semiMajorAxisAU: 30 });
    const near = estimateTemperatureRange({ ...base, surfaceTemperature: 300, semiMajorAxisAU: 0.3 });
    expect(near.tMax - near.tMin).toBeGreaterThan(far.tMax - far.tMin);
  });

  it("uses the asymmetric spread above 500 K, and airless bodies swing wider", () => {
    // high_metal_hot with no journal temperature: tMid 750, so the hot branch applies.
    expect(estimateTemperatureRange({ ...base, bodyClass: "high_metal_hot", atmosphere: "none" })).toEqual({
      tMin: 603,
      tMid: 750,
      tMax: 872,
    });

    const airless = estimateTemperatureRange({ ...base, surfaceTemperature: 300, atmosphere: "none" });
    const thin = estimateTemperatureRange({ ...base, surfaceTemperature: 300, atmosphere: "thin" });
    expect(airless.tMin).toBeLessThan(thin.tMin);
    expect(airless.tMax).toBeGreaterThan(thin.tMax);
  });

  it("honours an explicit irradiation override instead of the orbit distance", () => {
    const fromOrbit = estimateTemperatureRange({ ...base, surfaceTemperature: 300, semiMajorAxisAU: 25 });
    const overridden = estimateTemperatureRange({
      ...base,
      surfaceTemperature: 300,
      semiMajorAxisAU: 25,
      irradiationFactor: 2,
    });
    expect(overridden.tMax - overridden.tMin).toBeGreaterThan(fromOrbit.tMax - fromOrbit.tMin);
  });
});
