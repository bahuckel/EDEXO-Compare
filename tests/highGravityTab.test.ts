/** High-gravity mark on the body tab (review F-5.3; owner, 2026-10-03: 2.7 g). */
import { describe, expect, it } from "vitest";
import { bodyGravityG, HIGH_GRAVITY_G } from "../src/client/BodyTabStrip";
import type { BodyComputed } from "../src/shared/types";

const body = (ms2: number | null, merged = true) =>
  ({
    mergedScan: merged && ms2 != null ? { SurfaceGravity: ms2 } : null,
    state: { scan: !merged && ms2 != null ? { SurfaceGravity: ms2 } : null },
  }) as unknown as BodyComputed;

describe("bodyGravityG", () => {
  it("reads the journal's m/s² as g, from the merged scan or the body's own", () => {
    expect(bodyGravityG(body(26.5))!).toBeGreaterThanOrEqual(HIGH_GRAVITY_G);
    expect(bodyGravityG(body(26.0, false))!).toBeLessThan(HIGH_GRAVITY_G);
    expect(bodyGravityG(body(null))).toBeNull();
  });
});
