/**
 * The regional prior's weight, and the rule that the probe must measure the app.
 *
 * `REGION_PRIOR_WEIGHT` blends the species' recorded count in this codex region into the
 * corpus-wide prior: `w · log(regionalCount + 0.5) + (1 − w) · corpusLogPrior`. It moved from 0.5
 * to 0.25 on a sweep the earlier one could not have made, because the earlier one carried no
 * calibration column:
 *
 * ```
 * weight          mean rank   top-1          top-3          calibration
 * 0, corpus only    3.303     199 (34.0%)    363 (62.1%)      0.0024
 * 0.25              3.094     202 (34.5%)    386 (66.0%)      0.0069
 * 0.5 (was)         3.072     205 (35.0%)    382 (65.3%)      0.0108
 * 0.75              3.075     214 (36.6%)    389 (66.5%)      0.0127
 * 1                 3.087     220 (37.6%)    389 (66.5%)      0.0190
 * ```
 *
 * Top-3 is all but saturated at 0.25 — 386 of the 389 the curve ever reaches — so the cheapest
 * setting buys nearly all of "the answer is visible without scrolling", and everything above it buys
 * top-1 while the calibration gap grows monotonically to eight times its floor.
 *
 * The other half of this file is a guard, not a measurement. Twice in one day a weight was reported
 * against a probe configuration the app does not run: once because `--model` was opt-in when the
 * panel had ordered by the posterior for months, and once because `--region-prior` was opt-in when
 * the panel had been blending it at 0.5. Both produced honest arithmetic about the wrong program.
 * So the probe's defaults are asserted here against the app's own constants.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REGION_PRIOR_WEIGHT, TERM_DAMPING, VOLCANISM_TERM_WEIGHT } from "../src/server/speciesLikelihood.js";

const probe = readFileSync(path.resolve(__dirname, "../scripts/rank-probe.ts"), "utf8");
const snapshot = readFileSync(path.resolve(__dirname, "../src/server/snapshot.ts"), "utf8");

describe("the regional prior's weight", () => {
  it("is the value the sweep chose", () => {
    expect(REGION_PRIOR_WEIGHT).toBe(0.25);
  });

  it("stays a blend, never the region alone", () => {
    /*
      At 1 the prior is a log count spanning ten log units while the damped likelihood contributes
      one or two, so the posterior stops being a posterior and becomes a regional popularity lookup
      with the body's physics as a tiebreaker. The regional counts also come from bodies commanders
      *chose* to map, so a species merely unpopular to scan here must not be ranked away for it.
    */
    expect(REGION_PRIOR_WEIGHT).toBeGreaterThan(0);
    expect(REGION_PRIOR_WEIGHT).toBeLessThan(1);
  });

  it("is the one the panel uses, read from the same constant", () => {
    // Not a copy in `snapshot.ts` that can drift from the one the probe reads.
    expect(snapshot).toContain("regionPriorWeight: REGION_PRIOR_WEIGHT");
    expect(snapshot).not.toContain("PRESENCE_REGION_PRIOR_WEIGHT");
  });
});

describe("the probe measures the app, not a configuration nobody runs", () => {
  it("ranks by the posterior unless asked otherwise", () => {
    // `--model` used to be opt-in while the panel had ordered by the posterior for months.
    expect(probe).toContain('const USE_MODEL = !process.argv.includes("--similarity")');
  });

  it("blends the regional prior unless asked otherwise", () => {
    // And `--region-prior` used to be opt-in while the panel blended it at 0.5.
    expect(probe).toContain('const REGION_PRIOR = !process.argv.includes("--no-region-prior")');
  });

  it("defaults every swept weight to the app's own constant", () => {
    /*
      A literal here would be a second copy of a tuned number, and the whole failure this file
      guards against is two copies disagreeing quietly.
    */
    expect(probe).toContain("--region-weight=${REGION_PRIOR_WEIGHT}");
    expect(probe).toContain("--damping=${TERM_DAMPING}");
    expect(probe).toContain("--volcanism-weight=${VOLCANISM_TERM_WEIGHT}");
    // And it imports them rather than restating them.
    expect(probe).toContain("REGION_PRIOR_WEIGHT");
    expect(TERM_DAMPING).toBe(0.15);
    expect(VOLCANISM_TERM_WEIGHT).toBe(2);
  });
});
