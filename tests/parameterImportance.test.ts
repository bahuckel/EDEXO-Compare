import { describe, expect, it } from "vitest";
import {
  bucketCategoricalValue,
  bucketCounts,
  buildParameterImportance,
  determinismVsBackground,
  entropy,
  MIN_SAMPLES_FOR_IMPORTANCE,
  poolBackground,
  type CategoricalTable,
} from "../src/feeder/parameterImportance.js";

describe("bucketCategoricalValue", () => {
  it("collapses spectral classes to the type the game keys on", () => {
    // 88 distinct classes in the corpus make a species that only grows on F stars look undecided.
    expect(bucketCategoricalValue("exo.host_star_spectral_primary", "F2")).toBe("F");
    expect(bucketCategoricalValue("exo.host_star_spectral_primary", "F6 V")).toBe("F");
    expect(bucketCategoricalValue("exo.host_star_spectral_primary", "A6")).toBe("A");
    expect(bucketCategoricalValue("exo.host_star_spectral_primary", "N")).toBe("N");
    expect(bucketCategoricalValue("exo.host_star_spectral_primary", "DA")).toBe("D");
    expect(bucketCategoricalValue("exo.host_star_spectral_primary", "?")).toBe("other");
  });

  it("collapses pressure prefixes and -rich variants of the same gas", () => {
    // Pressure is measured separately, and far better, as a number.
    for (const v of [
      "Thin Carbon dioxide",
      "Hot thin Carbon dioxide",
      "Thick Carbon dioxide",
      "Carbon dioxide-rich",
    ]) {
      expect(bucketCategoricalValue("body.atmosphereType", v), v).toBe("carbon dioxide");
    }
  });

  it("collapses volcanism intensity, which is the same mechanism either way", () => {
    expect(bucketCategoricalValue("body.volcanismType", "Minor rocky magma volcanism")).toBe(
      "rocky magma volcanism",
    );
    expect(bucketCategoricalValue("body.volcanismType", "Major rocky magma volcanism")).toBe(
      "rocky magma volcanism",
    );
  });

  it("leaves anything it has no rule for alone", () => {
    expect(bucketCategoricalValue("body.subType", "High metal content body")).toBe("High metal content body");
    expect(bucketCategoricalValue("body.subType", "  ")).toBe("");
  });
});

describe("entropy", () => {
  it("is zero for a single value and maximal for a uniform spread", () => {
    expect(entropy({ a: 100 })).toBe(0);
    expect(entropy({})).toBe(0);
    expect(entropy({ a: 25, b: 25, c: 25, d: 25 })).toBeCloseTo(Math.log(4), 6);
    expect(entropy({ a: 90, b: 10 })).toBeLessThan(entropy({ a: 50, b: 50 }));
  });
});

/**
 * The owner's rule: importance is measured, never declared. A species pinned to one value on a
 * parameter the galaxy spreads across is one the parameter decides.
 */
describe("determinismVsBackground", () => {
  const spread = { F: 40, G: 16, K: 11, M: 11, A: 8, L: 6, N: 5, D: 3 };

  it("scores a species that pins one value against a spread background", () => {
    expect(determinismVsBackground({ A: 100 }, spread)!).toBeGreaterThan(0.5);
  });

  it("scores zero for a species spread exactly like the background", () => {
    expect(determinismVsBackground(spread, spread)!).toBeCloseTo(0, 6);
  });

  it("goes negative for a species spread wider than the galaxy", () => {
    // "Push it back to a very low priority" (§11.1), arrived at by arithmetic rather than a list.
    const wider = { F: 12, G: 12, K: 13, M: 13, A: 12, L: 13, N: 13, D: 12 };
    expect(determinismVsBackground(wider, spread)!).toBeLessThan(0);
  });

  /**
   * The correction that mattered. Dividing by the background's own entropy is the obvious form and
   * it is wrong: 97 % of bodies are "Not terraformable", so H(background) is tiny and every species
   * scores near 1 — which ranked terraforming state second only to atmosphere, for a parameter that
   * says almost nothing. Normalising by the maximum possible entropy fixes it.
   */
  it("does not reward a parameter for having a concentrated background", () => {
    const nearlyConstant = { "Not terraformable": 970, Terraformable: 30 };
    const pinned = determinismVsBackground({ "Not terraformable": 500 }, nearlyConstant)!;
    const informative = determinismVsBackground({ A: 100 }, spread)!;
    expect(pinned).toBeLessThan(0.2);
    expect(pinned).toBeLessThan(informative);
  });

  it("returns null when the parameter has one value in the whole corpus", () => {
    expect(determinismVsBackground({ x: 10 }, { x: 900 })).toBeNull();
  });
});

describe("poolBackground and buildParameterImportance", () => {
  const tables: CategoricalTable[] = [
    { "body.atmosphereType": { "Thin Carbon dioxide": 60, "Thin Ammonia": 40 } },
    { "body.atmosphereType": { "Carbon dioxide-rich": 50, "Thin Water": 50 } },
  ];

  it("pools every species into one distribution, bucketing on the way in", () => {
    const bg = poolBackground(tables);
    // "Thin Carbon dioxide" and "Carbon dioxide-rich" are the same gas.
    expect(bg["body.atmosphereType"]).toEqual({
      "carbon dioxide": 110,
      ammonia: 40,
      water: 50,
    });
  });

  it("scores a species against the pool", () => {
    const bg = poolBackground(tables);
    const imp = buildParameterImportance(tables[0], bg)!;
    expect(imp["body.atmosphereType"]).toBeTypeOf("number");
  });

  /**
   * Rarity is not unreliability: a thin profile is still the best estimate of where a rare species
   * lives. What it cannot do is tell us which parameter decides, so it is left unscored and the
   * consumer keeps its default weighting.
   */
  it("refuses to score a species with too few observations", () => {
    const bg = poolBackground(tables);
    const thin = { "body.atmosphereType": { "Thin Water": MIN_SAMPLES_FOR_IMPORTANCE - 1 } };
    expect(buildParameterImportance(thin, bg)).toBeUndefined();
    expect(buildParameterImportance(undefined, bg)).toBeUndefined();
  });

  it("bucketCounts drops empty values rather than making a bucket for them", () => {
    expect(bucketCounts("body.subType", { "": 5, Icy: 3, Rocky: 0 })).toEqual({ Icy: 3 });
  });
});
