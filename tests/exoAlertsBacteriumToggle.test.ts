import { describe, expect, it } from "vitest";
import type { BodyExoState, PlanetScan, SpeciesMatch } from "../src/shared/types.js";
import { computeExoDataAlertsForBody } from "../src/server/exoDataConsistencyAlerts.js";

function match(genusDir: string, genus: string): SpeciesMatch {
  return {
    entry: { id: `${genusDir}_x`, displayName: `${genus} x`, genus, genusDataDir: genusDir, criteria: {} },
    reasons: [],
  } as unknown as SpeciesMatch;
}

function body(signals: number): BodyExoState {
  return {
    key: "1:2",
    biologicalSignals: signals,
    genusHints: [],
    organicGenusLocks: [],
  } as unknown as BodyExoState;
}

const scan = { PlanetClass: "Rocky body" } as unknown as PlanetScan;
const db = { species: [] };

/**
 * The "Bacterium" toggle is a choice, not a data defect. With it off, one signal is taken to be the
 * bacterium's slot, so a body with two signals and one non-bacterium candidate is not reported as
 * short. With it on, the same body is short by one and the alert fires as before.
 */
describe("exo data alerts and the Bacterium toggle", () => {
  it("does not report a shortfall of one when bacterium is switched off", () => {
    const { alerts } = computeExoDataAlertsForBody({
      body: body(2),
      mergedScan: scan,
      matches: [match("stratum", "Stratum")],
      speciesMatchCtx: null,
      db,
      includeBacterium: false,
    });
    expect(alerts.filter((a) => a.id.startsWith("signal-count-short:"))).toHaveLength(0);
  });

  it("still reports a shortfall of two when bacterium is switched off", () => {
    const { alerts } = computeExoDataAlertsForBody({
      body: body(3),
      mergedScan: scan,
      matches: [match("stratum", "Stratum")],
      speciesMatchCtx: null,
      db,
      includeBacterium: false,
    });
    const short = alerts.filter((a) => a.id.startsWith("signal-count-short:"));
    expect(short).toHaveLength(1);
    expect(short[0]!.title).toMatch(/^1 genus missing/);
  });

  it("reports the shortfall when bacterium is switched on", () => {
    const { alerts } = computeExoDataAlertsForBody({
      body: body(2),
      mergedScan: scan,
      matches: [match("stratum", "Stratum")],
      speciesMatchCtx: null,
      db,
      includeBacterium: true,
    });
    expect(alerts.filter((a) => a.id.startsWith("signal-count-short:"))).toHaveLength(1);
  });
});
