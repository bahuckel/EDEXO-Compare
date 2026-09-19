/**
 * The observed temperature range demotes a row; it never excludes one.
 *
 * The distinction is the whole design, and it was arrived at by measuring both. Replacing the codex
 * temperature gate with the range a species has actually been found in — `USE_FEEDER_TEMP=1` in the
 * accuracy probe — is worse on every headline the app is judged by: recall 97.9 → 97.4 %,
 * value-weighted 97.4 → 97.0 %, precision 43.2 → 39.4 % on *more* candidates. The codex bands are
 * deliberately wider than anything yet observed and that width earns its keep.
 *
 * Used as a demotion the same data pays. Measured 2026-09-19 on one cache, the shipped path against
 * `NO_TEMP_ENVELOPE=1`:
 *
 * ```
 *   decidable bodies     497 (35.1 %)  ->  527 (37.2 %)
 *   mean ambiguity       4.80 genera   ->  4.71
 *   default-panel prec.  43.2 % (461)  ->  43.9 % (453)
 *   default-panel recall 13 missed     ->  16 missed
 *   both tiers together  616 found, 9 missed  ->  unchanged
 * ```
 *
 * Three species step out of the default panel and **none is lost** — they wait one click away with
 * the reason attached. That last part is why this is a soft failure carrying a sentence rather than
 * a silent reordering: a row demoted without an explanation is worse than the ambiguity it cures.
 */
import { describe, expect, it } from "vitest";
import { speciesMatchesCriteria } from "../src/server/matchSpecies.js";
import { estimatedTemperatureRangeForScan } from "../src/server/planetTemperature.js";
import type { PlanetScan, SpeciesEntry } from "../src/shared/types.js";

const EARTH_G = 9.80665;

/** A species the codex lets live anywhere above 165 K, with an envelope far narrower than that. */
function entry(over: Partial<SpeciesEntry> = {}): SpeciesEntry {
  return {
    id: "probe_species",
    displayName: "Probe species",
    genus: "Probe",
    genusDataDir: "probe",
    criteria: {
      planetClassAnyOf: ["Icy body"],
      atmosphereTypeAnyOf: ["CarbonDioxide"],
      surfaceTemperatureK: { min: 165 },
      atmospherePressureCategory: "thin",
    },
    observedTemperatureK: { min: 170, max: 200, count: 400 },
    ...over,
  } as unknown as SpeciesEntry;
}

function body(tempK: number): PlanetScan {
  return {
    BodyName: "probe",
    BodyID: 1,
    StarSystem: "probe",
    SystemAddress: 1,
    PlanetClass: "Icy body",
    AtmosphereType: "CarbonDioxide",
    Atmosphere: "thin carbon dioxide atmosphere",
    atmosphereComposition: [{ Name: "CarbonDioxide", Percent: 100 }],
    Volcanism: "",
    SurfaceTemperature: tempK,
    SurfaceGravity: 0.2 * EARTH_G,
    SurfacePressure: 300,
    Landable: true,
  } as unknown as PlanetScan;
}

function verdict(e: SpeciesEntry, tempK: number) {
  const scan = body(tempK);
  const est = estimatedTemperatureRangeForScan(scan);
  return speciesMatchesCriteria(e, scan, { minK: tempK, maxK: tempK }, est, { surfacePressureAtm: 0.003 });
}

describe("inside the observed range", () => {
  it("passes, with no demotion", () => {
    expect(verdict(entry(), 185).ok).toBe(true);
  });

  it("passes at either edge, because the edge is an observation not a wall", () => {
    expect(verdict(entry(), 170).ok).toBe(true);
    expect(verdict(entry(), 200).ok).toBe(true);
  });
});

describe("outside the observed range", () => {
  it("demotes rather than excludes — the row survives, one tier down", () => {
    /*
      `softOnly` is what the panel reads to put a row behind "show unlikely". A hard failure here
      would delete a species the codex still allows, which is the thing that measured worse.
    */
    const r = verdict(entry(), 260);
    expect(r.ok).toBe(false);
    expect(r.softOnly).toBe(true);
  });

  it("says why, with the numbers behind it", () => {
    // A row demoted without an explanation is worse than the ambiguity it was meant to cure.
    const r = verdict(entry(), 260);
    const detail = r.reasons.map((x) => x.detail).join(" ");
    expect(detail).toContain("260.0 K");
    expect(detail).toContain("170–200 K");
    expect(detail).toContain("400 bodies");
    expect(detail).toContain("codex band still allows it");
  });

  it("demotes below the range as well as above it", () => {
    const r = verdict(entry(), 166); // clears the codex 165 K floor, under everything observed
    expect(r.ok).toBe(false);
    expect(r.softOnly).toBe(true);
  });
});

describe("when it keeps quiet", () => {
  it("says nothing about a species with no envelope", () => {
    // Most often a profile under twenty bodies: a handful of observations is not an envelope, and
    // demoting against three of them would assert more than we know.
    expect(verdict(entry({ observedTemperatureK: undefined }), 260).ok).toBe(true);
  });

  it("does not turn a hard rejection soft", () => {
    /*
      It runs last and only on a row with no failures yet, so it can move a candidate down and never
      up. Gravity is the hard gate used here on purpose: the planet-class and atmosphere lists are
      themselves soft — the corpus is allowed to know better than the codex — so they would have
      proved nothing about this.
    */
    const capped = entry({
      criteria: {
        planetClassAnyOf: ["Icy body"],
        atmosphereTypeAnyOf: ["CarbonDioxide"],
        atmospherePressureCategory: "thin",
        surfaceGravity: { max: 0.1 },
      },
    } as Partial<SpeciesEntry>);
    const r = verdict(capped, 260); // outside the envelope *and* over the gravity cap
    expect(r.ok).toBe(false);
    expect(r.softOnly, "a body over the gravity cap must stay excluded").not.toBe(true);
  });

  it("says nothing when the body has no temperature reading", () => {
    /*
      No reading, nothing to compare. The entry here carries no codex temperature gate either, so the
      only thing that could fail is the demotion — an earlier version of this test kept the 165 K
      floor and measured that gate failing instead, which proved nothing.
    */
    const noGate = entry({
      criteria: {
        planetClassAnyOf: ["Icy body"],
        atmosphereTypeAnyOf: ["CarbonDioxide"],
        atmospherePressureCategory: "thin",
      },
    } as Partial<SpeciesEntry>);
    const scan = body(185);
    delete (scan as unknown as Record<string, unknown>).SurfaceTemperature;
    const est = estimatedTemperatureRangeForScan(scan);
    expect(speciesMatchesCriteria(noGate, scan, null, est, { surfacePressureAtm: 0.003 }).ok).toBe(true);
  });
});
