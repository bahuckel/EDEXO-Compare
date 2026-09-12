/**
 * Gravity at the commander's feet, read as an altimeter.
 *
 * `Status.json` drops `Altitude` while on foot but keeps `Gravity`, and a `ScanOrganic` only ever
 * happens on foot — so this is the one elevation available at the moment a plant is recorded, and
 * nothing recovers it afterwards.
 */
import { describe, expect, it } from "vitest";
import { elevationFromGravity, journalSurfaceGravityToG } from "../src/shared/journalPhysics.js";

// Smoje MF-C c14-0 A 2, from the commander's own journal.
const RADIUS_M = 3302185.75;
const SURFACE_GRAVITY_MS2 = 5.072564;
const REFERENCE_G = journalSurfaceGravityToG(SURFACE_GRAVITY_MS2);

describe("elevation from the gravity reported on foot", () => {
  it("puts a reading at the reference gravity on the datum", () => {
    const e = elevationFromGravity(REFERENCE_G, SURFACE_GRAVITY_MS2, RADIUS_M);
    expect(e).not.toBeNull();
    expect(Math.abs(e!)).toBeLessThan(1);
  });

  it("reads weaker gravity as higher ground", () => {
    // Standing 1 km up, gravity falls by (r/(r+h))^2.
    const higher = REFERENCE_G * Math.pow(RADIUS_M / (RADIUS_M + 1000), 2);
    const e = elevationFromGravity(higher, SURFACE_GRAVITY_MS2, RADIUS_M);
    expect(e).toBeCloseTo(1000, 0);
  });

  it("reads stronger gravity as lower ground", () => {
    const lower = REFERENCE_G * Math.pow(RADIUS_M / (RADIUS_M - 500), 2);
    const e = elevationFromGravity(lower, SURFACE_GRAVITY_MS2, RADIUS_M);
    expect(e).toBeCloseTo(-500, 0);
  });

  it("resolves a single digit of Status.json Gravity to a few metres", () => {
    const one = elevationFromGravity(REFERENCE_G - 1e-6, SURFACE_GRAVITY_MS2, RADIUS_M)!;
    expect(one).toBeGreaterThan(1);
    expect(one).toBeLessThan(10);
  });

  it("returns null rather than inventing an elevation from missing data", () => {
    expect(elevationFromGravity(null, SURFACE_GRAVITY_MS2, RADIUS_M)).toBeNull();
    expect(elevationFromGravity(REFERENCE_G, undefined, RADIUS_M)).toBeNull();
    expect(elevationFromGravity(REFERENCE_G, SURFACE_GRAVITY_MS2, undefined)).toBeNull();
    expect(elevationFromGravity(0, SURFACE_GRAVITY_MS2, RADIUS_M)).toBeNull();
    expect(elevationFromGravity(REFERENCE_G, 0, RADIUS_M)).toBeNull();
    expect(elevationFromGravity(Number.NaN, SURFACE_GRAVITY_MS2, RADIUS_M)).toBeNull();
  });
});
