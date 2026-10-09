/**
 * The "green?" question on a gas giant (owner, 2026-10-09: "GGG question goes away if its not
 * considered green by edggg (unless nudge is possible)").
 */
import { describe, expect, it } from "vitest";
import { greenQuestionWorthAsking } from "../src/shared/greenGasGiant.js";

const C2 = "Sudarsky class II gas giant";
// Class II above its nudge range (250-280 K), mass and radius scanned: the ladder can say no.
const ruledOut = { planetClass: C2, surfaceTemperatureK: 300.123456, massEM: 300.5, radiusM: 7.1e7 };

describe("asking whether a gas giant is green", () => {
  it("not when the cloud ladder rules it out", () => {
    expect(greenQuestionWorthAsking(ruledOut, null, null)).toBe(false);
    expect(greenQuestionWorthAsking(ruledOut, { level: "possible", why: "", score: 1.5 }, null)).toBe(false);
  });

  it("in a nudge range, without a mass, or at a rounded temperature: the ladder cannot tell", () => {
    expect(greenQuestionWorthAsking({ ...ruledOut, surfaceTemperatureK: 260.7731 }, null, null)).toBe(true);
    expect(greenQuestionWorthAsking({ ...ruledOut, massEM: undefined }, null, null)).toBe(true);
    expect(greenQuestionWorthAsking({ ...ruledOut, surfaceTemperatureK: 300 }, null, null)).toBe(true);
  });

  it("always with a codex entry, the catalogue, a strong sign or the commander's own call", () => {
    expect(greenQuestionWorthAsking(ruledOut, { level: "catalogued", why: "", gggNumber: 7 }, null)).toBe(true);
    expect(greenQuestionWorthAsking(ruledOut, { level: "likely", why: "", score: 4 }, null)).toBe(true);
    expect(greenQuestionWorthAsking(ruledOut, null, "no")).toBe(true);
  });
});
