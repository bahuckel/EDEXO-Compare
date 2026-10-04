/**
 * Pressure in the habitat views (2026-10-04): a feeder profile's `body.surfacePressure` is already in
 * atmospheres, a journal value is pascals. The profile path was converted again and read "0.00 atm".
 */
import { describe, expect, it } from "vitest";
import { formatExomasteryValueForPath } from "../src/server/exomasteryFormat.js";

describe("pressure in the habitat views", () => {
  it("shows a profile's atmospheres as they are", () => {
    expect(formatExomasteryValueForPath("body.surfacePressure", 0.0083)).toMatch(/^0\.008\d* atm$/);
  });
  it("still converts a journal value from pascals", () => {
    expect(formatExomasteryValueForPath("SurfacePressure", 101325)).toBe("1.00 atm");
  });
});
