import { describe, it, expect } from "vitest";
import { buildGlobalEdges, equalWidthEdges, globalEdges } from "../src/feeder/histograms.js";
import { HISTOGRAM_BINS } from "../src/shared/likelihoodBins.js";

/** A corpus shaped like the real rock fraction: one species piled on a point, a few spread out. */
function clusteredRockCorpus(): number[] {
  const vals: number[] = [];
  for (let i = 0; i < 3600; i++) vals.push(91 + (i % 40) / 100);
  for (let i = 0; i < 900; i++) vals.push(64 + (i % 800) / 100);
  return vals;
}

describe("edges for the crust split", () => {
  it("quantiles collapse on a clustered corpus, which is why these paths do not use them", () => {
    const q = globalEdges(clusteredRockCorpus());
    const spanOfLastTen = q[q.length - 1]! - q[4]!;
    expect(spanOfLastTen).toBeLessThan(1);
  });

  it("equal width keeps every bin the same size, whoever contributed the rows", () => {
    const e = equalWidthEdges(clusteredRockCorpus());
    expect(e).toHaveLength(HISTOGRAM_BINS - 1);
    const widths = e.slice(1).map((v, i) => v - e[i]!);
    for (const w of widths) expect(w).toBeCloseTo(widths[0]!, 6);
  });

  it("says nothing when the corpus is too thin or has no spread", () => {
    expect(equalWidthEdges([1, 2, 3])).toEqual([]);
    expect(equalWidthEdges(new Array(500).fill(42))).toEqual([]);
  });

  it("routes rock and metal to equal width and leaves other paths on quantiles", () => {
    const rock = clusteredRockCorpus();
    const out = buildGlobalEdges(
      new Map([
        ["body.solidComposition.Rock", rock],
        ["body.solidComposition.Metal", rock],
        ["body.surfaceTemperature", rock],
      ]),
    );
    expect(out["body.solidComposition.Rock"]).toEqual(equalWidthEdges(rock));
    expect(out["body.solidComposition.Metal"]).toEqual(equalWidthEdges(rock));
    expect(out["body.surfaceTemperature"]).toEqual(globalEdges(rock));
  });

  it("leaves ice out entirely — the third fraction is the other two counted again", () => {
    const out = buildGlobalEdges(new Map([["body.solidComposition.Ice", clusteredRockCorpus()]]));
    expect(out["body.solidComposition.Ice"]).toBeUndefined();
  });
});
