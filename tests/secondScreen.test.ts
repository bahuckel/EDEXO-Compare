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
    expect(triageSystem([unknown, near], "distance").map((r) => r.bodyKey)).toEqual([
      "near",
      "unknown",
    ]);
  });

  it("has nothing to show for a system with no bodies", () => {
    expect(triageSystem([], "value")).toEqual([]);
  });
});
