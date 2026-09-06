import { describe, expect, it } from "vitest";
import { triageSystem, type TriageBodyInput } from "../src/shared/systemTriage.js";

/**
 * The second screen (§51) adds no maths of its own — it renders {@link triageSystem}. What it does
 * add is an ordering the commander picks on the device in their hand, so these pin the three orders
 * the buttons offer against one system.
 */
function body(
  bodyKey: string,
  over: Partial<TriageBodyInput> & { probability?: number; price?: number } = {},
): TriageBodyInput {
  return {
    bodyKey,
    bodyName: bodyKey,
    signalCount: over.signalCount ?? 1,
    distanceLs: over.distanceLs ?? 100,
    multiplier: over.multiplier ?? 1,
    certain: over.certain ?? false,
    candidates: [
      {
        speciesId: `${bodyKey}-sp`,
        genus: "g",
        displayName: `${bodyKey} species`,
        probability: over.probability ?? 0.5,
        priceCredits: over.price ?? 1_000_000,
      },
    ],
  };
}

describe("the second screen's sort orders", () => {
  const near = body("near", { distanceLs: 50, probability: 0.2, signalCount: 1 });
  const rich = body("rich", { distanceLs: 5_000, probability: 0.9, signalCount: 3 });
  const quick = body("quick", { distanceLs: 900, probability: 0.5, signalCount: 1 });

  it("puts the most valuable body first by default", () => {
    expect(triageSystem([near, rich, quick], "value").map((r) => r.bodyKey)).toEqual([
      "rich",
      "quick",
      "near",
    ]);
  });

  /** Three signals is three sampling runs, so the richest body is not automatically the fastest. */
  it("puts the best rate first on per-minute", () => {
    const rows = triageSystem([near, rich, quick], "perMinute");
    expect(rows[0]!.creditsPerMinute).toBeGreaterThanOrEqual(rows[1]!.creditsPerMinute);
    expect(rows[1]!.creditsPerMinute).toBeGreaterThanOrEqual(rows[2]!.creditsPerMinute);
  });

  it("puts the nearest body first on distance", () => {
    expect(triageSystem([rich, quick, near], "distance").map((r) => r.bodyKey)).toEqual([
      "near",
      "quick",
      "rich",
    ]);
  });

  /** An unknown distance is not a zero — it sorts last rather than to the top of the list. */
  it("sorts a body with no distance reading last", () => {
    const unknown = body("unknown", { distanceLs: null });
    expect(triageSystem([unknown, near], "distance").map((r) => r.bodyKey)).toEqual(["near", "unknown"]);
  });

  it("has nothing to show for a system with no bodies", () => {
    expect(triageSystem([], "value")).toEqual([]);
  });
});

/**
 * A9's value at risk (§53). The question is not "is the expected value right" — in aggregate it is,
 * because the probabilities sum to the signal count — but "do I know what I am flying down for".
 */
describe("value at risk", () => {
  function candidate(id: string, genus: string, probability: number | null, priceCredits: number) {
    return { speciesId: id, genus, displayName: id, probability, priceCredits };
  }

  function row(candidates: ReturnType<typeof candidate>[], certain = false): TriageBodyInput {
    return {
      bodyKey: "b",
      bodyName: "b",
      signalCount: 2,
      distanceLs: 100,
      multiplier: 1,
      certain,
      candidates,
    };
  }

  /** One unlikely species worth 25 M carries almost all of a 4 M expectation. A lottery ticket. */
  it("asks for a map when most of the value rests on one unlikely candidate", () => {
    const [r] = triageSystem([
      row([
        candidate("jackpot", "stratum", 0.15, 25_000_000),
        candidate("filler", "bacterium", 0.9, 300_000),
      ]),
    ]);
    expect(r!.risk.mapFirst).toBe(true);
    expect(r!.risk.concentration).toBeGreaterThan(0.5);
    expect(r!.risk.topContribution).toBe(3_750_000);
  });

  /** The tooltip names this one, and it is deliberately *not* `best`, which is the likeliest. */
  it("names the species carrying the value, not the likeliest one", () => {
    const [r] = triageSystem([
      row([
        candidate("jackpot", "stratum", 0.15, 25_000_000),
        candidate("filler", "bacterium", 0.9, 300_000),
      ]),
    ]);
    expect(r!.risk.topSpecies).toBe("jackpot");
    expect(r!.best?.displayName).toBe("filler");
  });

  /**
   * The condition that makes the advice actionable rather than merely true. A DSS names the genus,
   * so on a body where every candidate is the same genus it costs probes and settles nothing.
   */
  it("does not ask for a map when every candidate is the same genus", () => {
    const [r] = triageSystem([
      row([
        candidate("jackpot", "bacterium", 0.15, 25_000_000),
        candidate("filler", "bacterium", 0.9, 300_000),
      ]),
    ]);
    expect(r!.risk.concentration).toBeGreaterThan(0.5);
    expect(r!.risk.mapFirst).toBe(false);
  });

  /** Four near-certain species of similar price: the same total, and nothing a DSS would settle. */
  it("stays quiet when the value is spread over likely candidates", () => {
    const [r] = triageSystem([
      row([
        candidate("a", "aleoida", 0.9, 1_000_000),
        candidate("b", "bacterium", 0.9, 1_000_000),
        candidate("c", "concha", 0.9, 1_000_000),
        candidate("d", "osseus", 0.9, 1_000_000),
      ]),
    ]);
    expect(r!.risk.mapFirst).toBe(false);
    expect(r!.risk.concentration).toBeCloseTo(0.25, 6);
  });

  /** Concentrated but likely: you know what you are going for, so mapping buys nothing. */
  it("stays quiet when the one big contributor is likely", () => {
    const [r] = triageSystem([
      row([candidate("sure", "stratum", 0.8, 20_000_000), candidate("filler", "bacterium", 0.2, 100_000)]),
    ]);
    expect(r!.risk.mapFirst).toBe(false);
  });

  /** §4.3's certainty: the game has already named as many genera as it reports signals. */
  it("never asks for a map on a body the signal count has already pinned down", () => {
    const [r] = triageSystem([
      row(
        [candidate("jackpot", "stratum", 0.15, 25_000_000), candidate("filler", "bacterium", 0.9, 300_000)],
        true,
      ),
    ]);
    expect(r!.risk.mapFirst).toBe(false);
  });

  it("reports no concentration for a body worth nothing", () => {
    const [r] = triageSystem([row([candidate("unscored", "stratum", null, 1_000_000)])]);
    expect(r!.risk).toEqual({
      topContribution: 0,
      concentration: 0,
      topSpecies: null,
      mapFirst: false,
    });
  });
});
