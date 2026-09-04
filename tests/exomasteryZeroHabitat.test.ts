import { describe, expect, it } from "vitest";
import {
  MIN_SAMPLES_TO_DEMOTE_ON_HABITAT,
  markExomasteryZeroHabitatMatches,
} from "../src/server/exomasteryGenusFinalize.js";
import type { SpeciesMatch } from "../src/shared/types.js";

/**
 * Minimal match stub. Only the exomastery fields and the DSS fallback flags matter here; the rest of
 * SpeciesMatch is irrelevant to the demotion rule, so it is cast in rather than built out.
 */
function match(over: Partial<SpeciesMatch> & { id: string }): SpeciesMatch {
  const { id, ...rest } = over;
  return {
    entry: { id, displayName: id, genus: "Tussock", genusDataDir: "tussock", criteria: {} },
    reasons: [],
    ...rest,
  } as unknown as SpeciesMatch;
}

describe("markExomasteryZeroHabitatMatches", () => {
  it("keeps every candidate — nothing is ever removed", () => {
    const input = [
      match({ id: "a", exomasteryProfilePresent: true, exomasteryHabitatQuality: 0, exomasteryProfileSampleCount: 900 }),
      match({ id: "b", exomasteryProfilePresent: true, exomasteryHabitatQuality: 62, exomasteryProfileSampleCount: 900 }),
      match({ id: "c" }),
    ];
    const out = markExomasteryZeroHabitatMatches(input);
    expect(out.map((m) => m.entry.id)).toEqual(["a", "b", "c"]);
  });

  it("demotes a zero-habitat match backed by enough samples", () => {
    const [m] = markExomasteryZeroHabitatMatches([
      match({
        id: "tussock_virgam",
        exomasteryProfilePresent: true,
        exomasteryHabitatQuality: 0,
        exomasteryProfileSampleCount: 579,
      }),
    ]);
    expect(m!.exomasteryHabitatUnlikely).toBe(true);
  });

  it("does not demote on a thin profile — one body cannot prove where a species is absent", () => {
    // fonticulua_fluctus and fonticulua_segmentatus both ship with sampleCount 1.
    const [m] = markExomasteryZeroHabitatMatches([
      match({
        id: "fonticulua_fluctus",
        exomasteryProfilePresent: true,
        exomasteryHabitatQuality: 0,
        exomasteryProfileSampleCount: 1,
      }),
    ]);
    expect(m!.exomasteryHabitatUnlikely).toBeUndefined();
  });

  it("treats the sample threshold as inclusive", () => {
    const at = markExomasteryZeroHabitatMatches([
      match({
        id: "at",
        exomasteryProfilePresent: true,
        exomasteryHabitatQuality: 0,
        exomasteryProfileSampleCount: MIN_SAMPLES_TO_DEMOTE_ON_HABITAT,
      }),
    ]);
    const below = markExomasteryZeroHabitatMatches([
      match({
        id: "below",
        exomasteryProfilePresent: true,
        exomasteryHabitatQuality: 0,
        exomasteryProfileSampleCount: MIN_SAMPLES_TO_DEMOTE_ON_HABITAT - 1,
      }),
    ]);
    expect(at[0]!.exomasteryHabitatUnlikely).toBe(true);
    expect(below[0]!.exomasteryHabitatUnlikely).toBeUndefined();
  });

  it("never demotes a DSS temperature or physical slack fallback match", () => {
    const out = markExomasteryZeroHabitatMatches([
      match({
        id: "near_temp",
        exomasteryProfilePresent: true,
        exomasteryHabitatQuality: 0,
        exomasteryProfileSampleCount: 900,
        dssNearestTemperatureMatch: true,
      }),
      match({
        id: "slack",
        exomasteryProfilePresent: true,
        exomasteryHabitatQuality: 0,
        exomasteryProfileSampleCount: 900,
        dssPhysicalSlackMatch: true,
      }),
    ]);
    expect(out.every((m) => m.exomasteryHabitatUnlikely === undefined)).toBe(true);
  });

  it("leaves a match with no profile and a match with unknown sample count alone", () => {
    const out = markExomasteryZeroHabitatMatches([
      match({ id: "no_profile", exomasteryHabitatQuality: 0 }),
      match({ id: "unknown_n", exomasteryProfilePresent: true, exomasteryHabitatQuality: 0 }),
    ]);
    expect(out.every((m) => m.exomasteryHabitatUnlikely === undefined)).toBe(true);
  });

  it("ignores a null habitat quality — only an explicit 0 is evidence of a mismatch", () => {
    const [m] = markExomasteryZeroHabitatMatches([
      match({
        id: "null_hq",
        exomasteryProfilePresent: true,
        exomasteryHabitatQuality: null,
        exomasteryProfileSampleCount: 900,
      }),
    ]);
    expect(m!.exomasteryHabitatUnlikely).toBeUndefined();
  });
});
