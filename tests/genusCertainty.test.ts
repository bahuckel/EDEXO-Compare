import { describe, expect, it } from "vitest";
import type { BodyExoState, SpeciesMatch } from "../src/shared/types.js";
import { genusCertaintyForBodyForTests } from "../src/server/snapshot.js";

function match(genusDir: string, genus: string, unsupported = false): SpeciesMatch {
  return {
    entry: {
      id: `${genusDir}_x`,
      displayName: `${genus} x`,
      genus,
      genusDataDir: genusDir,
      criteria: {},
      ...(unsupported ? { predictionUnsupported: { reason: "r", sourceKey: "location_requirement" } } : {}),
    },
    reasons: [],
  } as unknown as SpeciesMatch;
}

function body(signals: number | null): BodyExoState {
  return { biologicalSignals: signals } as unknown as BodyExoState;
}

/**
 * One genus per biological signal, never the same genus twice. Comparing the candidate genus count
 * with the signal count the game already reported is what turns a candidate list into a verdict.
 */
describe("genusCertaintyForBody", () => {
  it("declares certainty when candidate genera equal the signal count", () => {
    const c = genusCertaintyForBodyForTests(body(2), [
      match("bacterium", "Bacterium"),
      match("stratum", "Stratum"),
    ]);
    expect(c).toEqual({
      status: "certain",
      signalCount: 2,
      candidateGenera: 2,
      genera: ["Bacterium", "Stratum"],
    });
  });

  it("counts genera, not species — three Bacterium species are still one genus", () => {
    const c = genusCertaintyForBodyForTests(body(1), [
      match("bacterium", "Bacterium"),
      match("bacterium", "Bacterium"),
      match("bacterium", "Bacterium"),
    ]);
    expect(c?.status).toBe("certain");
    expect(c?.candidateGenera).toBe(1);
  });

  it("reports ambiguity when there are more candidate genera than signals", () => {
    const c = genusCertaintyForBodyForTests(body(1), [
      match("bacterium", "Bacterium"),
      match("stratum", "Stratum"),
      match("tussock", "Tussock"),
    ]);
    expect(c?.status).toBe("ambiguous");
    expect(c?.candidateGenera).toBe(3);
  });

  it("flags a data defect when there are fewer candidate genera than signals", () => {
    // Impossible in game: the signals are there, so a gate is excluding a genus that really grows here.
    const c = genusCertaintyForBodyForTests(body(3), [match("bacterium", "Bacterium")]);
    expect(c?.status).toBe("underCovered");
    expect(c!.signalCount - c!.candidateGenera).toBe(2);
  });

  it("excludes not-predicted species, so they cannot manufacture certainty", () => {
    // Electricae radialem needs a nebula we cannot check. Letting it satisfy the signal count would
    // claim a certainty nobody earned.
    const c = genusCertaintyForBodyForTests(body(2), [
      match("bacterium", "Bacterium"),
      match("electricae", "Electricae", true),
    ]);
    expect(c?.status).toBe("underCovered");
    expect(c?.candidateGenera).toBe(1);
  });

  it("returns null when the body has no signal count or no candidates", () => {
    expect(genusCertaintyForBodyForTests(body(null), [match("bacterium", "Bacterium")])).toBeNull();
    expect(genusCertaintyForBodyForTests(body(0), [match("bacterium", "Bacterium")])).toBeNull();
    expect(genusCertaintyForBodyForTests(body(2), [])).toBeNull();
  });
});
