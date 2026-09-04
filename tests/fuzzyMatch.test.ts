import { describe, expect, it } from "vitest";
import { fuzzyRank, fuzzyRankAny } from "../src/client/fuzzyMatch.js";

describe("fuzzyRank", () => {
  it("matches a scattered subsequence that a substring search would miss", () => {
    expect("Bacterium Acies".toLowerCase().includes("bacacies")).toBe(false);
    expect(fuzzyRank("Bacterium Acies", "bacacies")).not.toBeNull();
  });

  it("ranks a contiguous hit ahead of a scattered one", () => {
    const contiguous = fuzzyRank("Bacterium Acies", "acies")!;
    const scattered = fuzzyRank("Bacterium Acies", "bacacies")!;
    expect(contiguous).toBeLessThan(scattered);
  });

  it("ranks an earlier contiguous hit ahead of a later one", () => {
    expect(fuzzyRank("Bacterium Acies", "bacterium")).toBeLessThan(fuzzyRank("Bacterium Acies", "acies")!);
  });

  it("prefers the tighter subsequence when neither is contiguous", () => {
    const tight = fuzzyRank("Bacterium Acies", "bact")!;
    const loose = fuzzyRank("Bacterium Acies", "bcis")!;
    expect(tight).toBeLessThan(loose);
  });

  it("ignores case and the spaces in the query", () => {
    expect(fuzzyRank("C 1 b", "c1b")).not.toBeNull();
    expect(fuzzyRank("Stratum Tectonicas", "STRATUM")).toBe(fuzzyRank("Stratum Tectonicas", "stratum"));
  });

  it("returns null when a character is missing or out of order", () => {
    expect(fuzzyRank("Bacterium Acies", "xyz")).toBeNull();
    expect(fuzzyRank("Bacterium Acies", "seica")).toBeNull();
  });

  it("treats an empty or blank query as matching everything equally", () => {
    expect(fuzzyRank("anything", "")).toBe(0);
    expect(fuzzyRank("anything", "   ")).toBe(0);
  });
});

describe("fuzzyRankAny", () => {
  it("takes the best rank across the fields it is given", () => {
    expect(fuzzyRankAny(["Aleoida Arcus", "Aleoida"], "aleoida")).toBe(0);
    expect(fuzzyRankAny([null, undefined, "Stratum Tectonicas"], "tecton")).not.toBeNull();
  });

  it("returns null only when no field matches", () => {
    expect(fuzzyRankAny(["Aleoida Arcus", "Aleoida"], "zzz")).toBeNull();
    expect(fuzzyRankAny([null, undefined], "a")).toBeNull();
  });

  it("matches everything on a blank query, even with no usable fields", () => {
    expect(fuzzyRankAny([null], "  ")).toBe(0);
  });
});
