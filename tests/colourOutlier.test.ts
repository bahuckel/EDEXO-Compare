/**
 * A plant logged in a colour the app did not predict goes in the outliers file (owner, 2026-09-26).
 * Tests run with a temporary EDEXO_USER_DATA_DIR (tests/setup).
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  exoOutlierTally,
  recordColourOutliersForBody,
  resetExoOutlierLogCacheForTests,
} from "../src/server/exoOutlierLog.js";
import { resolveExoOutlierLogPath } from "../src/server/paths.js";
import type { BodyExoState } from "../src/shared/types.js";

const body = {
  key: "1:6",
  bodyName: "Hypao Flee MS-T d3-63 2 c",
  bodyId: 6,
  systemAddress: 1,
  starSystem: "Hypao Flee MS-T d3-63",
  biologicalSignals: 2,
  scan: { PlanetClass: "Rocky body", AtmosphereType: "CarbonDioxide", SurfaceTemperature: 180 },
} as unknown as BodyExoState;

const miss = {
  speciesId: "bacterium_bacterium_alcyoneum",
  speciesName: "Bacterium alcyoneum",
  predicted: "Red",
  logged: "Lime",
};

beforeEach(() => {
  rmSync(resolveExoOutlierLogPath(), { force: true });
  resetExoOutlierLogCacheForTests();
});

describe("colour outliers", () => {
  it("writes one colour record per body and species, and counts it", () => {
    const args = { body, misses: [miss], colourStarType: "T", candidates: [miss.speciesId] };
    expect(recordColourOutliersForBody(args)).toBe(1);
    expect(recordColourOutliersForBody(args)).toBe(0);
    const lines = readFileSync(resolveExoOutlierLogPath(), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]!);
    expect(rec).toMatchObject({
      severity: "colour",
      predictedColour: "Red",
      loggedColour: "Lime",
      colourStarType: "T",
      bodyName: "Hypao Flee MS-T d3-63 2 c",
    });
    expect(exoOutlierTally().colour).toBe(1);
  });

  it("is read back from the file after a restart", () => {
    recordColourOutliersForBody({ body, misses: [miss], colourStarType: "T", candidates: [] });
    resetExoOutlierLogCacheForTests();
    expect(exoOutlierTally()).toMatchObject({ total: 1, colour: 1 });
    // …and still written only once.
    expect(recordColourOutliersForBody({ body, misses: [miss], colourStarType: "T", candidates: [] })).toBe(
      0,
    );
  });

  it("writes nothing when nothing was mis-coloured", () => {
    expect(recordColourOutliersForBody({ body, misses: [], colourStarType: "F", candidates: [] })).toBe(0);
    expect(existsSync(resolveExoOutlierLogPath())).toBe(false);
  });
});
