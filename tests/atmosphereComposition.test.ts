/**
 * The atmosphere gases, which the ranking model could not see.
 *
 * Fonticulua splits on this axis and on almost nothing else: campestris lives on 52-100 % argon,
 * upupam on 50-100 % nitrogen with 0.4-50 % argon beside it, and across 761 and 56 corpus rows the
 * two ranges do not touch. `valueForNumericPath` had no branch for `body.atmosphereComposition.*`,
 * so both returned null, and the model separated the two on the corpus prior instead — campestris
 * has thirteen times the rows, so upupam sat at 15-17 % on bodies that were unmistakably its own.
 *
 * The atmosphere *type* does not rescue it, which is the trap worth pinning: the commander's upupam
 * body is `ArgonRich` by name and 64 % nitrogen by composition.
 */
import { describe, expect, it } from "vitest";
import { valueForNumericPath } from "../src/server/exomasteryProfile.js";
import type { PlanetScan } from "../src/shared/types.js";

/** The body the commander found Fonticulua upupam on: named for argon, made of nitrogen. */
const upupamBody = {
  PlanetClass: "Icy body",
  Atmosphere: "thin argon rich atmosphere",
  AtmosphereType: "ArgonRich",
  atmosphereComposition: [
    { Name: "Nitrogen", Percent: 64.38 },
    { Name: "Argon", Percent: 35.62 },
  ],
} as unknown as PlanetScan;

describe("body.atmosphereComposition reaches the ranking model", () => {
  it("reports each gas as the percentage the profile stores", () => {
    expect(valueForNumericPath("body.atmosphereComposition.Nitrogen", upupamBody, null)).toBeCloseTo(
      64.38,
      2,
    );
    expect(valueForNumericPath("body.atmosphereComposition.Argon", upupamBody, null)).toBeCloseTo(35.62, 2);
  });

  it("reports a gas the body does not have as zero, not as unknown", () => {
    // Absence is evidence: a body with no argon is a body campestris does not grow on.
    expect(valueForNumericPath("body.atmosphereComposition.Oxygen", upupamBody, null)).toBe(0);
  });

  it("says nothing when the body has no atmosphere reading at all", () => {
    expect(
      valueForNumericPath(
        "body.atmosphereComposition.Argon",
        { PlanetClass: "Icy body" } as PlanetScan,
        null,
      ),
    ).toBeNull();
  });

  it("separates the two Fonticulua on a body whose name says the opposite", () => {
    // The whole point. On the type name alone both are plausible; on the composition only one is.
    const n = valueForNumericPath("body.atmosphereComposition.Nitrogen", upupamBody, null)!;
    const a = valueForNumericPath("body.atmosphereComposition.Argon", upupamBody, null)!;
    // upupam 50.32-99.64 N / 0.36-49.68 Ar; campestris 0.07-48.03 N / 51.97-100 Ar.
    expect(n).toBeGreaterThan(50.32);
    expect(n).toBeGreaterThan(48.03);
    expect(a).toBeLessThan(49.68);
    expect(a).toBeLessThan(51.97);
  });
});
