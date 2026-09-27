/**
 * Journal atmosphere tokens meet the profiles' labels (code review B7, 2026-09-27): sulphur dioxide
 * and every "-rich" atmosphere used to fail the habitat comparison on spelling alone.
 */
import { describe, expect, it } from "vitest";
import { exomasteryAtmosphereTypeCompareKey as key } from "../src/server/exomasteryProfile.js";

describe("atmosphere compare key", () => {
  it("joins the journal's token and the profile's label", () => {
    for (const [journal, profile] of [
      ["SulphurDioxide", "Thin Sulphur dioxide"],
      ["SulphurDioxide", "Hot thin Sulphur dioxide"],
      ["SulfurDioxide", "Thin Sulphur dioxide"],
      ["CarbonDioxide", "Thin Carbon dioxide"],
      ["CarbonDioxideRich", "Thin Carbon dioxide-rich"],
      ["ArgonRich", "Thin Argon-rich"],
      ["NeonRich", "Thin Neon-rich"],
      ["WaterRich", "Thin Water-rich"],
      ["Ammonia", "Thick Ammonia atmosphere"],
    ]) {
      expect(key(journal!), `${journal} ~ ${profile}`).toBe(key(profile!));
    }
  });

  it("keeps different atmospheres apart", () => {
    expect(key("Argon")).not.toBe(key("ArgonRich"));
    expect(key("CarbonDioxide")).not.toBe(key("CarbonDioxideRich"));
    expect(key("Neon")).not.toBe(key("Nitrogen"));
  });
});
