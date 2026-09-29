/**
 * Rank and credits to the next rank, from the commander's own journal (shared/rankProgress.ts;
 * guild tester report, owner's choice 2026-09-30).
 */
import { describe, expect, it } from "vitest";
import { estimateRank, type RankLine } from "../src/shared/rankProgress.js";
import type { IncomeEvent } from "../src/shared/incomeCategories.js";

const sale = (at: string, credits: number, category: IncomeEvent["category"] = "exobiology"): IncomeEvent => ({
  at,
  category,
  credits,
});

describe("rank estimate", () => {
  it("measures the band from the promotion to the last reading, and takes off what was sold since", () => {
    const lines: RankLine[] = [
      { at: "2026-05-01T10:00:00Z", event: "Rank", exobio: 6, explore: 9 },
      { at: "2026-05-03T16:22:56Z", event: "Promotion", exobio: 7 },
      { at: "2026-06-01T10:00:00Z", event: "Rank", exobio: 7, explore: 9 },
      { at: "2026-06-01T10:00:00Z", event: "Progress", exobio: 40, explore: 12 },
    ];
    const income = [
      sale("2026-05-03T16:22:56Z", 999), // the sale that promoted: not part of the new rank
      sale("2026-05-10T00:00:00Z", 300_000_000),
      sale("2026-05-20T00:00:00Z", 100_000_000),
      sale("2026-05-21T00:00:00Z", 5_000_000, "exploration"), // other rank's money
      sale("2026-06-05T00:00:00Z", 100_000_000), // after the last reading
    ];
    const e = estimateRank(lines, income, "exobio")!;
    expect(e.name).toBe("Geneticist");
    expect(e.next).toBe("Elite");
    expect(e.basis).toBe("promotion");
    expect(e.bandCredits).toBeCloseTo(1_000_000_000, -3); // 400 M = 40 %
    expect(e.progressPct).toBe(40);
    expect(e.estimatedPct).toBeCloseTo(50, 5); // + 100 M of 1 bn
    expect(e.creditsToNext).toBeCloseTo(500_000_000, -3);
  });

  it("uses two readings of the rank when the promotion is older than the journals", () => {
    const lines: RankLine[] = [
      { at: "2026-01-01T00:00:00Z", event: "Rank", explore: 10 },
      { at: "2026-01-01T00:00:00Z", event: "Progress", explore: 20 },
      { at: "2026-02-01T00:00:00Z", event: "Rank", explore: 10 },
      { at: "2026-02-01T00:00:00Z", event: "Progress", explore: 30 },
    ];
    const e = estimateRank(lines, [sale("2026-01-15T00:00:00Z", 50_000_000, "exploration")], "explore")!;
    expect(e.name).toBe("Elite II");
    expect(e.basis).toBe("readings");
    expect(e.bandCredits).toBeCloseTo(500_000_000, -3); // 50 M = 10 points
    expect(e.creditsToNext).toBeCloseTo(350_000_000, -3);
  });

  it("gives no figure on too small a step, and none past Elite V", () => {
    const small: RankLine[] = [
      { at: "2026-01-01T00:00:00Z", event: "Promotion", exobio: 3 },
      { at: "2026-01-02T00:00:00Z", event: "Progress", exobio: 1 },
    ];
    const e = estimateRank(small, [sale("2026-01-01T12:00:00Z", 1_000_000)], "exobio")!;
    expect(e.name).toBe("Collector");
    expect(e.creditsToNext).toBeNull();
    const top = estimateRank([{ at: "2026-01-01T00:00:00Z", event: "Rank", explore: 13 }], [], "explore")!;
    expect(top.name).toBe("Elite V");
    expect(top.next).toBeNull();
    expect(estimateRank([], [], "explore")).toBeNull();
  });
});
