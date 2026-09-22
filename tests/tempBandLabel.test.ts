/**
 * How a species' temperature band is written down for the commander.
 *
 * The open-low form printed its ceiling twice — "species range is ≤190190 K" — on the one screen
 * that exists to explain a demotion. A wrong-looking number in an explanation reads as the app being
 * confused, and the commander goes looking for a fault that is not there.
 */
import { describe, expect, it } from "vitest";
import { describeTempBand } from "../src/server/matchSpecies.js";

const OPEN_LO = -1e15;
const OPEN_HI = 1e15;

describe("a species temperature band, in words", () => {
  it("writes an open-low band once, not twice", () => {
    // Concha labiata and every Tubus row on the body that found this.
    expect(describeTempBand({ lo: OPEN_LO, hi: 190 })).toBe("≤190 K");
  });

  it("writes the ordinary closed band as a range", () => {
    expect(describeTempBand({ lo: 160, hi: 190 })).toBe("160–190 K");
  });

  it("writes an open-high band as a floor", () => {
    expect(describeTempBand({ lo: 300, hi: OPEN_HI })).toBe("≥300 K");
  });

  it("says so plainly when the species does not care", () => {
    expect(describeTempBand({ lo: OPEN_LO, hi: OPEN_HI })).toBe("any temperature");
  });
});
