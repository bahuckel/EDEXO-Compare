/**
 * The gravity curve — the strongest single predictor found in the commander's journals, and the
 * only one in this app that answers "is there biology here at all" rather than "which plant".
 *
 * It is worth nothing once he is in the system, because the FSS answers it for free. It is worth a
 * great deal for a body nobody has visited, which is what the galaxy scan lists — so this is where
 * it went, and the things worth pinning are the ways it could quietly become dishonest:
 *
 *  - the shape itself, since it is copied from a measurement that cannot be re-run from here;
 *  - **0 of 32 is not "never"** — the filter must compare against the smoothed figure, or the end of
 *    the curve becomes a law derived from thirty-two bodies;
 *  - a body the curve cannot speak for must **pass** the filter, not fail it, or the shortlist
 *    quietly biases toward the systems the dump happens to describe best;
 *  - it must stay a report and a filter, never a gate the commander did not ask for.
 */
import { describe, expect, it } from "vitest";
import {
  clearsGravityOdds,
  gravityBiologyCurve,
  gravityBiologyOdds,
} from "../src/server/gravityBiologyOdds.js";

describe("the measured curve", () => {
  it("falls monotonically, which is the finding", () => {
    /*
      The reason it is believed at all. A curve that wobbled would be noise in eleven bands; this one
      never rises, across 1,795 bodies, and it survives being cut by planet class and by pressure.
    */
    const curve = gravityBiologyCurve();
    expect(curve).toHaveLength(11);
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i]!.sharePct, curve[i]!.bandLabel).toBeLessThanOrEqual(curve[i - 1]!.sharePct);
    }
  });

  it("reads the bands the measurement reported", () => {
    expect(gravityBiologyOdds(0.18, true)?.observedPct).toBe(100);
    expect(gravityBiologyOdds(0.22, true)?.observedPct).toBe(100);
    expect(gravityBiologyOdds(0.47, true)?.observedPct).toBe(44);
    expect(gravityBiologyOdds(0.58, true)?.observedPct).toBe(14);
    expect(gravityBiologyOdds(0.62, true)?.observedPct).toBe(3);
    expect(gravityBiologyOdds(1.3, true)?.observedPct).toBe(0);
  });

  it("puts a band boundary on the lower side", () => {
    // 0.25 belongs to 0.25-0.30, not to the band below it, or the 746-for-746 claim moves.
    expect(gravityBiologyOdds(0.2499, true)?.bandLabel).toBe("0.20–0.25 g");
    expect(gravityBiologyOdds(0.25, true)?.bandLabel).toBe("0.25–0.30 g");
  });

  it("carries the sample size, because the ends of the curve are thin", () => {
    expect(gravityBiologyOdds(0.37, true)?.bodies).toBe(208);
    expect(gravityBiologyOdds(0.9, true)?.bodies).toBe(32);
  });
});

describe("smoothing, so a measurement does not become a law", () => {
  it("turns 0 of 32 into a small chance rather than none", () => {
    /*
      A Jeffreys prior: (0 + 0.5) / (32 + 1) = 1.5 %. The raw 0 % is the honest report and stays on
      the row; the filter needs a number that says "unlikely", because "impossible" is not something
      thirty-two bodies can establish.
    */
    const odds = gravityBiologyOdds(0.9, true)!;
    expect(odds.observedPct).toBe(0);
    expect(odds.smoothedPct).toBe(2);
    expect(odds.smoothedPct).toBeGreaterThan(0);
  });

  it("leaves the 100 % band reading 100, and that is fine", () => {
    /*
      The prior applies at both ends, but 603 of 603 smooths to 99.9 % and these figures are whole
      percent, so it rounds straight back to 100. Worth stating rather than asserting a difference
      that is not there: the smoothing exists for the *sparse* end, where 0 of 32 becomes 2 % and
      changes what the filter does. At the dense end it changes nothing anyone can act on, and the
      filter's own range stops at 90 % so it is never the deciding value either.
    */
    const odds = gravityBiologyOdds(0.1, true)!;
    expect(odds.observedPct).toBe(100);
    expect(odds.smoothedPct).toBe(100);
    expect(odds.bodies).toBe(603);
  });
});

describe("what the curve refuses to answer", () => {
  it("says nothing about an airless body", () => {
    /*
      It measured 0 of 8,239 beside this curve, so the temptation is to return 0 %. But every species
      the scan can offer needs an atmosphere, so an airless body arriving here means something else
      is unusual — and answering a question the curve was not measured on is worse than silence.
    */
    expect(gravityBiologyOdds(0.3, false)).toBeNull();
  });

  it("says nothing when the dump never recorded a gravity", () => {
    // Zero is "unrecorded" throughout this file's data, not a measurement of zero.
    expect(gravityBiologyOdds(0, true)).toBeNull();
    expect(gravityBiologyOdds(Number.NaN, true)).toBeNull();
  });
});

describe("the filter", () => {
  it("is off at zero, and then everything passes", () => {
    expect(clearsGravityOdds(1.5, true, 0)).toBe(true);
    expect(clearsGravityOdds(0.1, true, 0)).toBe(true);
  });

  it("keeps the light worlds and drops the heavy ones", () => {
    expect(clearsGravityOdds(0.2, true, 50)).toBe(true);
    expect(clearsGravityOdds(0.42, true, 50)).toBe(true);
    expect(clearsGravityOdds(0.47, true, 50)).toBe(false);
    expect(clearsGravityOdds(0.9, true, 50)).toBe(false);
  });

  it("passes a body it cannot speak for, rather than dropping it", () => {
    /*
      "Unknown" is not "unlikely". Dropping the bodies the dump recorded least well would bias the
      shortlist toward well-documented systems — which are, by definition, the ones somebody has
      already been to, and the whole feature is about the ones nobody has.
    */
    expect(clearsGravityOdds(0, true, 90)).toBe(true);
    expect(clearsGravityOdds(0.3, false, 90)).toBe(true);
  });

  it("uses the smoothed figure, so the top of the range is not absolutely excluded", () => {
    // 1.5 % rounds to 2: a floor of 1 % keeps a 0.9 g body, a floor of 10 % does not.
    expect(clearsGravityOdds(0.9, true, 1)).toBe(true);
    expect(clearsGravityOdds(0.9, true, 10)).toBe(false);
  });
});
