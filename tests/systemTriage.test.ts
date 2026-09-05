import { describe, expect, it } from "vitest";
import {
  genusShares,
  onSiteMinutes,
  triageRow,
  triageSystem,
  LANDING_MINUTES,
  SAMPLING_MINUTES_PER_GENUS,
  type TriageBodyInput,
} from "../src/shared/systemTriage.js";

function body(over: Partial<TriageBodyInput> = {}): TriageBodyInput {
  return {
    bodyKey: "1:2",
    bodyName: "A 3 a",
    signalCount: 2,
    distanceLs: 500,
    multiplier: 1,
    certain: false,
    candidates: [
      { speciesId: "s1", displayName: "One", probability: 0.8, priceCredits: 1_000_000 },
      { speciesId: "s2", displayName: "Two", probability: 0.5, priceCredits: 2_000_000 },
    ],
    ...over,
  };
}

/**
 * The whole screen rests on one sum, so the sum is what the tests pin: chance of being present times
 * what it sells for. Every other column is presentation.
 */
describe("triageRow", () => {
  it("sums the calibrated chance times the price", () => {
    const r = triageRow(body());
    expect(r.expectedCredits).toBe(0.8 * 1_000_000 + 0.5 * 2_000_000);
    expect(r.coverage).toBe(1);
    expect(r.best?.speciesId).toBe("s1");
  });

  it("applies the first-footfall multiplier to the whole body", () => {
    expect(triageRow(body({ multiplier: 5 })).expectedCredits).toBe(5 * (0.8e6 + 1e6));
  });

  /**
   * A candidate the ranking model could not score contributes nothing, and the row says how much of
   * itself rests on the ones it could. Quietly reading low would be the dishonest version.
   */
  it("reports coverage when some candidates could not be scored", () => {
    const r = triageRow(
      body({
        candidates: [
          { speciesId: "s1", displayName: "One", probability: 0.8, priceCredits: 1_000_000 },
          { speciesId: "s2", displayName: "Two", probability: null, priceCredits: 9_000_000 },
        ],
      }),
    );
    expect(r.expectedCredits).toBe(800_000);
    expect(r.coverage).toBe(0.5);
    expect(r.best?.speciesId).toBe("s1");
  });

  it("counts a priceless candidate as evidence but not as credits", () => {
    const r = triageRow(
      body({
        candidates: [{ speciesId: "s1", displayName: "One", probability: 0.9, priceCredits: null }],
      }),
    );
    expect(r.expectedCredits).toBe(0);
    expect(r.coverage).toBe(1);
  });

  it("has nothing to say about a body with no candidates", () => {
    const r = triageRow(body({ candidates: [] }));
    expect(r.expectedCredits).toBe(0);
    expect(r.coverage).toBe(0);
    expect(r.best).toBeNull();
  });
});

describe("onSiteMinutes", () => {
  it("charges one landing and one sampling run per genus the game reports", () => {
    expect(onSiteMinutes(3)).toBeCloseTo(LANDING_MINUTES + 3 * SAMPLING_MINUTES_PER_GENUS, 6);
  });

  /** No signal count is not "no work": the body still costs a landing and at least one run. */
  it("falls back to a single run when the game has not said how many genera are down there", () => {
    expect(onSiteMinutes(null)).toBeCloseTo(LANDING_MINUTES + SAMPLING_MINUTES_PER_GENUS, 6);
    expect(onSiteMinutes(0)).toBeCloseTo(LANDING_MINUTES + SAMPLING_MINUTES_PER_GENUS, 6);
  });
});

describe("triageSystem", () => {
  const rich = body({ bodyKey: "rich", signalCount: 3, distanceLs: 90_000 });
  const near = body({
    bodyKey: "near",
    signalCount: 1,
    distanceLs: 120,
    candidates: [{ speciesId: "s3", displayName: "Three", probability: 0.9, priceCredits: 500_000 }],
  });

  it("puts the most valuable body first by default", () => {
    expect(triageSystem([near, rich]).map((r) => r.bodyKey)).toEqual(["rich", "near"]);
  });

  it("re-orders on credits per on-site minute", () => {
    // The rich body carries three genera, so it costs three sampling runs to collect.
    expect(triageSystem([near, rich], "perMinute").map((r) => r.bodyKey)).toEqual(["rich", "near"]);
    const rows = triageSystem([near, rich], "perMinute");
    expect(rows[0]!.creditsPerMinute).toBeGreaterThan(rows[1]!.creditsPerMinute);
  });

  it("re-orders by distance, and sorts a body with no reading last", () => {
    const unknown = body({ bodyKey: "unknown", distanceLs: null });
    expect(triageSystem([rich, unknown, near], "distance").map((r) => r.bodyKey)).toEqual([
      "near",
      "rich",
      "unknown",
    ]);
  });

  it("breaks a value tie on distance", () => {
    const far = body({ bodyKey: "far", distanceLs: 40_000 });
    const close = body({ bodyKey: "close", distanceLs: 300 });
    expect(triageSystem([far, close]).map((r) => r.bodyKey)).toEqual(["close", "far"]);
  });
});

/**
 * B3: after a DSS the genus is known, so the open question is which species of it — the same
 * posterior, normalised inside the genus rather than across the body.
 */
describe("genusShares", () => {
  it("normalises inside each genus, not across the body", () => {
    const rows = [
      { genus: "bacterium", probability: 0.3 },
      { genus: "bacterium", probability: 0.1 },
      { genus: "stratum", probability: 0.2 },
    ];
    const shares = genusShares(rows);
    expect(shares.get(rows[0]!)).toBeCloseTo(0.75, 6);
    expect(shares.get(rows[1]!)).toBeCloseTo(0.25, 6);
    // The only Stratum candidate takes all of its genus, whatever it scored on the body.
    expect(shares.get(rows[2]!)).toBeCloseTo(1, 6);
  });

  /** No evidence is not evidence of a tie. */
  it("gives null to a genus whose rows all scored zero", () => {
    const rows = [
      { genus: "ghost", probability: 0 },
      { genus: "ghost", probability: 0 },
    ];
    const shares = genusShares(rows);
    expect(shares.get(rows[0]!)).toBeNull();
    expect(shares.get(rows[1]!)).toBeNull();
  });

  it("says nothing about an empty list", () => {
    expect(genusShares([]).size).toBe(0);
  });
});
