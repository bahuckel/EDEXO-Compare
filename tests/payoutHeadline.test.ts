/**
 * One price, the right one (WEBUI-REDESIGN 1.1): the body pane's headline follows the footfall
 * tri-state, and the credit formatter behaves on chips.
 */
import { describe, expect, it } from "vitest";
import type { ExoPayoutRangeDTO } from "../src/shared/types";
import { payoutHeadline } from "../src/client/ExoPayoutRangePanel";
import { fmtCrRangeShort, fmtCrShort } from "../src/client/credits";

function pr(over: Partial<ExoPayoutRangeDTO>): ExoPayoutRangeDTO {
  const rows = (cr: number[]) => cr.map((c, i) => ({ id: `s${i}`, displayName: `Species ${i}`, listCredits: c }));
  return {
    minCr: 0,
    maxCr: 0,
    slotCount: 2,
    slotSource: "bio_signals",
    pricedCandidateCount: 3,
    mult: 1,
    commanderFirstFootfall: false,
    journalWasFootfalled: null,
    footfallSeenLabel: null,
    wasMapped: null,
    mappedSeenLabel: null,
    targetRung: "unknown",
    rungSeenLabel: null,
    mappedPredatesExobiology: false,
    minTotalSpecies: rows([1_000_000, 2_000_000]),
    maxTotalSpecies: rows([5_000_000, 7_000_000]),
    ...over,
  } as ExoPayoutRangeDTO;
}

describe("payoutHeadline", () => {
  it("shows ×5 as the price when first footfall is open", () => {
    const h = payoutHeadline(pr({ journalWasFootfalled: false }));
    expect(h.certainty).toBe("unwalked");
    expect(h.mult).toBe(5);
    expect([h.min, h.max]).toEqual([15_000_000, 60_000_000]);
    expect(h.alt).toBeNull();
  });
  it("shows ×1 and nothing else once the body has been walked", () => {
    const h = payoutHeadline(pr({ journalWasFootfalled: true }));
    expect(h.certainty).toBe("walked");
    expect([h.min, h.max]).toEqual([3_000_000, 12_000_000]);
    expect(h.alt).toBeNull();
  });
  it("shows ×1 with the ×5 as a conditional line when nobody knows", () => {
    const h = payoutHeadline(pr({}));
    expect(h.certainty).toBe("unknown");
    expect([h.min, h.max]).toEqual([3_000_000, 12_000_000]);
    expect(h.alt).toEqual({ label: "if first footfall ×5", min: 15_000_000, max: 60_000_000 });
  });
  it("lets the commander's own flag win over a stale scan", () => {
    const h = payoutHeadline(pr({ journalWasFootfalled: true, commanderFirstFootfall: true }));
    expect(h.certainty).toBe("unwalked");
  });
});

describe("credit formatting", () => {
  it("uses the short scale with the exact figure left to the title", () => {
    expect(fmtCrShort(7_942_100)).toBe("7.94 M");
    expect(fmtCrShort(612_440_386)).toBe("612 M");
    expect(fmtCrShort(23_410)).toBe("23.4 k");
    expect(fmtCrShort(950)).toBe("950");
    expect(fmtCrShort(1_260_000_000)).toBe("1.26 B");
  });
  it("collapses a range to one figure when the ends meet", () => {
    expect(fmtCrRangeShort(5_000_000, 5_000_000)).toBe("5.00 M");
    expect(fmtCrRangeShort(5_000_000, 7_000_000)).toBe("5.00 M – 7.00 M");
  });
});
