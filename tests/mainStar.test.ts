/**
 * The main star: the arrival star, else the lowest star BodyID (Phase 6 dedupe).
 */
import { describe, expect, it } from "vitest";
import { mainStarRecord } from "../src/shared/mainStar.js";

describe("mainStarRecord", () => {
  it("takes the star at zero distance from arrival over a lower BodyID", () => {
    const r = mainStarRecord([
      { bodyId: 1, starType: "M", distanceFromArrivalLs: 1200 },
      { bodyId: 3, starType: "K", distanceFromArrivalLs: 0 },
      { bodyId: 0, starType: null, distanceFromArrivalLs: 0 },
    ]);
    expect(r?.bodyId).toBe(3);
  });

  it("falls back to the lowest star BodyID, and to nothing without a star", () => {
    expect(mainStarRecord([{ bodyId: 4, starType: "F" }, { bodyId: 2, starType: "G" }, { bodyId: 1 }])?.bodyId).toBe(2);
    expect(mainStarRecord([{ bodyId: 1, starType: " " }])).toBeUndefined();
  });
});
