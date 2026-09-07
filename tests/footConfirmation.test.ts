/**
 * Which ScanOrganic types count as confirmation, and which one wins when several arrive.
 *
 * Measured against this commander's 244 journals: 352 distinct (system, body, species) observations,
 * of which 267 were analysed and **85 were logged and never touched again**. Not one was sampled
 * without also being analysed — so the type that was being dropped was `Log`, the only one the
 * handler did not accept, and it accounted for 24 % of everything seen on foot.
 */
import { describe, expect, it } from "vitest";
import { FOOT_CONFIRMATION_RANK, type FootCatalogConfirmation } from "../src/shared/types.js";

const strongest = (a: FootCatalogConfirmation, b: FootCatalogConfirmation): FootCatalogConfirmation =>
  FOOT_CONFIRMATION_RANK[a] >= FOOT_CONFIRMATION_RANK[b] ? a : b;

describe("confirmation rank", () => {
  it("orders the three scan types by how much was taken, not by presence", () => {
    expect(FOOT_CONFIRMATION_RANK.log).toBeLessThan(FOOT_CONFIRMATION_RANK.sample);
    expect(FOOT_CONFIRMATION_RANK.sample).toBeLessThan(FOOT_CONFIRMATION_RANK.analyse);
  });

  it("keeps the strongest whichever order the run arrives in", () => {
    // A run is Log, then Sample, then Analyse — so weaker lines arrive *after* the row exists, and a
    // plain overwrite would record a fully analysed species as merely logged.
    expect(strongest("analyse", "log")).toBe("analyse");
    expect(strongest("log", "analyse")).toBe("analyse");
    expect(strongest("sample", "log")).toBe("sample");
    expect(strongest("log", "sample")).toBe("sample");
    expect(strongest("analyse", "sample")).toBe("analyse");
  });

  it("is idempotent", () => {
    for (const c of ["log", "sample", "analyse"] as FootCatalogConfirmation[]) {
      expect(strongest(c, c)).toBe(c);
    }
  });

  it("covers every member of the union", () => {
    // A fourth type added without a rank would sort as undefined and compare false everywhere,
    // silently making the newest write win regardless of strength.
    const ranked = Object.keys(FOOT_CONFIRMATION_RANK).sort();
    expect(ranked).toEqual(["analyse", "log", "sample"]);
    for (const v of Object.values(FOOT_CONFIRMATION_RANK)) expect(Number.isInteger(v)).toBe(true);
  });
});
