import { describe, it, expect } from "vitest";
import { valueForNumericPath } from "../src/server/exomasteryProfile.js";
import type { ExplorationScanRecord, PlanetScan } from "../src/shared/types.js";

/**
 * The crust split, read by the ranking model.
 *
 * Every profile ships `body.solidComposition.Rock` and `.Metal` histograms and the model scored
 * neither, because this function had no branch for them and returned null for both. Frutexa acus
 * (rock 85.31-97.28 %) and metallicum (64.25-72 %) do not overlap on this axis at all, and the
 * ranking was deciding between them on temperature and gravity alone.
 */
describe("body.solidComposition.* reaches the ranking model", () => {
  const scan = {
    PlanetClass: "Rocky body",
    composition: { Ice: 0, Rock: 0.910199, Metal: 0.089801 },
  } as unknown as PlanetScan;

  it("reports the journal fraction as the percentage the profile stores", () => {
    expect(valueForNumericPath("body.solidComposition.Rock", scan, null)).toBeCloseTo(91.0199, 4);
    expect(valueForNumericPath("body.solidComposition.Metal", scan, null)).toBeCloseTo(8.9801, 4);
  });

  it("falls back to the exploration record when the scan carries no composition", () => {
    const rec = { composition: { Ice: 0, Rock: 0.669908, Metal: 0.330091 } } as unknown as ExplorationScanRecord;
    expect(valueForNumericPath("body.solidComposition.Rock", {} as PlanetScan, rec)).toBeCloseTo(66.9908, 4);
  });

  it("says nothing rather than zero when the body has no composition at all", () => {
    expect(valueForNumericPath("body.solidComposition.Rock", {} as PlanetScan, null)).toBeNull();
  });

  it("reports absent elements as zero, since the journal lists every one it found", () => {
    expect(valueForNumericPath("body.solidComposition.Ice", scan, null)).toBe(0);
  });

  it("leaves the other numeric paths alone", () => {
    const s = { SurfaceTemperature: 164.15, composition: { Rock: 0.91 } } as unknown as PlanetScan;
    expect(valueForNumericPath("body.surfaceTemperature", s, null)).toBeCloseTo(164.15, 2);
  });
});
