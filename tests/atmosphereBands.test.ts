import { describe, expect, it } from "vitest";
import {
  bandFrom,
  buildAtmosphereBands,
  cellIsUsable,
  MIN_CELL_SAMPLES,
  percentile,
} from "../src/feeder/atmosphereBands.js";
import { proposeEdgesForProfile, SNAP_MIN_SAMPLES, summariseProposals } from "../src/feeder/edgeSnapping.js";

function rows(atmo: string, temps: number[], press: number[] = []) {
  return temps.map((t, i) => ({
    atmosphereType: atmo,
    surfaceTemperatureK: t,
    surfacePressureAtm: press[i] ?? null,
  }));
}

describe("percentile", () => {
  it("takes the nearest observed rank, never an interpolated value", () => {
    // These are temperatures real bodies were measured at; an interpolated p1 is a reading nobody
    // ever took.
    const sorted = [10, 20, 30, 40, 50];
    expect(percentile(sorted, 0)).toBe(10);
    expect(percentile(sorted, 50)).toBe(30);
    expect(percentile(sorted, 100)).toBe(50);
    expect([10, 20]).toContain(percentile(sorted, 1));
    expect(percentile([], 50)).toBeNaN();
  });
});

describe("bandFrom", () => {
  it("keeps min and max but trims the percentiles", () => {
    const values = [...Array.from({ length: 98 }, () => 100), 1, 999];
    const b = bandFrom(values)!;
    expect(b.n).toBe(100);
    expect(b.min).toBe(1);
    expect(b.max).toBe(999);
    // One outlier at each end must not set p1 or p99 — that is the whole point of using them.
    expect(b.p1).toBe(100);
    expect(b.p50).toBe(100);
    expect(b.p99).toBe(100);
  });

  it("ignores non-finite readings and returns null when nothing is left", () => {
    expect(bandFrom([Number.NaN, Number.POSITIVE_INFINITY])).toBeNull();
    expect(bandFrom([1, Number.NaN, 3])?.n).toBe(2);
  });
});

/**
 * The failure this exists to fix: Osseus discus reads 80–641 K over its whole sample, because 14
 * methane bodies sit under 626 water ones at 402–449 K. A 561 K band excludes nothing.
 */
describe("buildAtmosphereBands", () => {
  const bands = buildAtmosphereBands([
    ...rows(
      "Thin Water",
      Array.from({ length: 626 }, (_, i) => 402 + (i % 48)),
      Array.from({ length: 626 }, () => 0.08),
    ),
    ...rows(
      "Thin Methane",
      Array.from({ length: 14 }, (_, i) => 80 + i),
      Array.from({ length: 14 }, () => 0.03),
    ),
  ]);

  it("separates the population from the tail that was setting the floor", () => {
    expect(bands["Thin Water"]!.n).toBe(626);
    expect(bands["Thin Water"]!.surfaceTemperatureK!.p1).toBeGreaterThanOrEqual(402);
    expect(bands["Thin Methane"]!.n).toBe(14);
    expect(bands["Thin Methane"]!.surfaceTemperatureK!.max).toBe(93);
  });

  it("orders cells by size, so the species' real home reads first", () => {
    expect(Object.keys(bands)).toEqual(["Thin Water", "Thin Methane"]);
  });

  it("records a thin cell but does not call it usable", () => {
    // 14 bodies are evidence the species grows there; they are not evidence of a range.
    expect(cellIsUsable(bands["Thin Water"])).toBe(true);
    expect(cellIsUsable(bands["Thin Methane"])).toBe(false);
    expect(MIN_CELL_SAMPLES).toBeGreaterThan(14);
    expect(cellIsUsable(undefined)).toBe(false);
  });

  it("skips bodies with no atmosphere reading rather than inventing a cell for them", () => {
    const b = buildAtmosphereBands([
      { atmosphereType: "", surfaceTemperatureK: 100, surfacePressureAtm: 0.01 },
      { atmosphereType: null, surfaceTemperatureK: 100, surfacePressureAtm: 0.01 },
    ]);
    expect(Object.keys(b)).toEqual([]);
  });
});

/**
 * Proposals only. A wrong hard edge turns a ranking error into a recall loss, and a recall loss is
 * invisible to the commander — they never fly there, so they never find out.
 */
describe("proposeEdgesForProfile", () => {
  const big = (v: number, n: number) => Array.from({ length: n }, () => v);

  it("proposes a round edge when the cell is large and the edge is close", () => {
    const bands = buildAtmosphereBands(
      rows("Thin Carbon dioxide", [165, ...big(200, SNAP_MIN_SAMPLES + 10)]),
    );
    const props = proposeEdgesForProfile("Stratum tectonicas", bands);
    const min = props.find((p) => p.edge === "min" && p.parameter === "surfaceTemperatureK");
    expect(min?.proposed).toBe(165);
    expect(min?.observed).toBe(165);
    expect(min?.deviation).toBe(0);
  });

  it("refuses to propose from a small cell, however round the number", () => {
    const bands = buildAtmosphereBands(rows("Thin Carbon dioxide", [165, ...big(200, 30)]));
    expect(proposeEdgesForProfile("Stratum tectonicas", bands)).toEqual([]);
  });

  it("needs the edge to sit on its grid point, not merely within 2% of one", () => {
    // On a 5 K grid nothing is ever more than 2.5 K from some multiple, which at 165 K is 1.5% —
    // inside tolerance. The percentage alone would confirm a threshold at every large cell, so an
    // edge also has to be within a fifth of the step (1 K here).
    const on = buildAtmosphereBands(rows("Thin CO", [164.5, ...big(200, SNAP_MIN_SAMPLES + 10)]));
    expect(proposeEdgesForProfile("x", on).some((p) => p.edge === "min" && p.proposed === 165)).toBe(true);

    const between = buildAtmosphereBands(rows("Thin CO", [162.5, ...big(200, SNAP_MIN_SAMPLES + 10)]));
    expect(proposeEdgesForProfile("x", between).some((p) => p.edge === "min")).toBe(false);
  });

  it("handles a missing bands table", () => {
    expect(proposeEdgesForProfile("x", undefined)).toEqual([]);
  });
});

describe("summariseProposals", () => {
  it("counts how many independent cells agree on a value, which is what makes it a threshold", () => {
    // One species hitting 165 K is a fact about that species. Several agreeing is a fact about the
    // game.
    const mk = (speciesLabel: string, atmosphere: string) => ({
      speciesLabel,
      atmosphere,
      parameter: "surfaceTemperatureK" as const,
      edge: "min" as const,
      observed: 165,
      proposed: 165,
      deviation: 0,
      n: 500,
    });
    const out = summariseProposals([
      mk("Stratum tectonicas", "Thin Carbon dioxide"),
      mk("Stratum tectonicas", "Thin Ammonia"),
      mk("Stratum paleas", "Thin Carbon dioxide"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.cells).toBe(3);
    expect(out[0]!.species).toBe(2);
    expect(out[0]!.bodies).toBe(1500);
    expect(out[0]!.exact).toBe(3);
  });
});
