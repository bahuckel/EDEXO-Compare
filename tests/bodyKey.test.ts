/**
 * One body key for the whole app (Phase 6 dedupe): "<SystemAddress>:<BodyID>", and back.
 */
import { describe, expect, it } from "vitest";
import { bodyIdOfBodyKey, bodyKey, systemAddressOfBodyKey } from "../src/shared/bodyKey.js";

describe("bodyKey", () => {
  it("writes and reads the key", () => {
    const k = bodyKey(2_870_514_599_617, 12);
    expect(k).toBe("2870514599617:12");
    expect(systemAddressOfBodyKey(k)).toBe(2_870_514_599_617);
    expect(bodyIdOfBodyKey(k)).toBe(12);
  });

  it("says NaN for a key that is not one", () => {
    for (const bad of ["", "123", ":5", "123:"]) {
      expect(Number.isNaN(systemAddressOfBodyKey(bad)) || Number.isNaN(bodyIdOfBodyKey(bad))).toBe(true);
    }
    expect(systemAddressOfBodyKey(":5")).toBeNaN();
    expect(bodyIdOfBodyKey("123:")).toBeNaN();
  });
});
