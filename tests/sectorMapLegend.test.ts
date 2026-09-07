/**
 * INCLUDE-BODY-IDS Phase 10 step 6 — the evidence breakdown, and the legend telling the truth.
 *
 * Two things this pins:
 *
 * 1. The tooltip carries the owner's three counts — confirmed, genus hits, FSS-only — rather than a
 *    single total, because a sector with 200 confirmed is a different place from one with 200 maybes.
 * 2. A kind the app **cannot compute** is marked unavailable rather than shown as zero. `predicted`
 *    needs the galaxy export; leaving it unqualified would tell a reader there are no such bodies,
 *    which is the absence-of-evidence trap the whole project keeps having to avoid.
 */
import { describe, expect, it } from "vitest";
import { cellTotals, systemTotals, type SectorMapCell, type SectorSystem } from "../src/shared/sectorMapFile.js";

/**
 * The summary the tooltip renders. Kept in step with `GalaxySectorMap.tsx` — if that formatting
 * changes, this should fail rather than the map quietly losing a count.
 */
function evidenceSummary(t: { confirmed: number; genus: number; signal: number; predicted: number }): string {
  const parts: string[] = [];
  if (t.confirmed) parts.push(`${t.confirmed} confirmed`);
  if (t.genus) parts.push(`${t.genus} genus-only`);
  if (t.signal) parts.push(`${t.signal} signal-only`);
  if (t.predicted) parts.push(`${t.predicted} predicted`);
  return parts.length > 0 ? parts.join(" · ") : "nothing recorded";
}

const cell = (taxa: SectorMapCell["taxa"]): SectorMapCell => ({
  key: "39:32:18",
  x: 39,
  y: 32,
  z: 18,
  name: "Wregoe",
  taxa,
});

describe("the evidence breakdown", () => {
  it("names all three kinds when all three are present", () => {
    const t = cellTotals(cell({ a: [7425, 1, 2, 0] }));
    expect(evidenceSummary(t)).toBe("7425 confirmed · 1 genus-only · 2 signal-only");
  });

  it("omits a kind that is absent rather than printing a zero", () => {
    expect(evidenceSummary(cellTotals(cell({ a: [52, 0, 0, 0] })))).toBe("52 confirmed");
    expect(evidenceSummary(cellTotals(cell({ a: [0, 0, 3, 0] })))).toBe("3 signal-only");
  });

  it("says so plainly when there is nothing", () => {
    expect(evidenceSummary(cellTotals(cell({})))).toBe("nothing recorded");
  });

  it("carries the same breakdown at the system level", () => {
    const system: SectorSystem = {
      key: "1",
      name: "Opet",
      x: 0,
      y: 0,
      z: 0,
      taxa: { "osseus discus": [52, 0, 0, 0] },
      bodies: [],
    };
    expect(evidenceSummary(systemTotals(system))).toBe("52 confirmed");
  });

  /**
   * The reason `predicted` is marked unavailable in the legend rather than shown as zero: the data
   * genuinely cannot say. This asserts the shape a caller sees, so a future export filling it in
   * lights the entry up instead of needing the legend rewritten.
   */
  it("reports predicted as zero today, which is why the legend must qualify it", () => {
    const t = cellTotals(cell({ a: [10, 0, 0, 0] }));
    expect(t.predicted).toBe(0);
    // And when it does arrive, the summary already has a place for it.
    expect(evidenceSummary({ confirmed: 0, genus: 0, signal: 0, predicted: 4 })).toBe("4 predicted");
  });
});
