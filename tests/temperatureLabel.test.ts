/** Temperature label, journal value first (owner, D2, 2026-10-01; review F-1.4). */
import { describe, expect, it } from "vitest";
import { formatTemperaturePillLine, temperatureParts } from "../src/client/planetDisplayUtils";

const band = { minK: 108, maxK: 270, midK: 190 };

describe("temperatureParts", () => {
  it("puts the journal value first and the band beside it as an estimate", () => {
    expect(temperatureParts(223, band, "K")).toEqual({ main: "223 K", est: "est. 108–270 K" });
    expect(formatTemperaturePillLine(223, band, "K")).toBe("223 K (est. 108–270 K)");
  });

  it("says the band is an estimate when there is no journal value", () => {
    expect(temperatureParts(null, band, "K")).toEqual({ main: "est. 108–270 K", est: null });
  });

  it("journal value alone, nothing, and other units", () => {
    expect(formatTemperaturePillLine(223, null, "K")).toBe("223 K");
    expect(formatTemperaturePillLine(null, null, "K")).toBe("—");
    expect(formatTemperaturePillLine(273.15, band, "C")).toBe("0°C (est. -165°C – -3°C)");
  });
});
