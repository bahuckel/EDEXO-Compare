/**
 * The sample radar's radius, which used to be the constant `MINIMAP_RADIUS_M = 500`.
 *
 * 500 m was the right number for a good reason — the widest genus separation in the game is 500 m,
 * so the ring being cleared always fitted — and it stayed right until the owner raised Elite's
 * `LODDistanceScale` to 6 and plants began rendering out to roughly a kilometre. The in-game
 * scanner already reached 750 m. A fixed 500 m radar is then narrower than both the tool and the
 * eye: a plant he can see, and could scan, sits outside the circle as a rim arrow.
 *
 * What matters here is that the radar's DTO reports the radius the setting says, because that one
 * field is what both the HUD and the app draw from — and that the bounds are enforced where the
 * value is stored rather than only in the launcher's input.
 */
import { describe, expect, it } from "vitest";
import {
  RADAR_RADIUS_DEFAULT_M,
  RADAR_RADIUS_MAX_M,
  RADAR_RADIUS_MIN_M,
  clampRadarRadiusM,
  radarRadiusDto,
} from "../src/shared/radarRadius.js";
import { buildExoMinimapDto, type ExoOrganicOverlayHost } from "../src/server/exoOrganicTracker.js";
import { GameStateStore } from "../src/server/gameState.js";

/** A commander standing on a body with one plant already sampled 600 m north of them. */
function host(radius?: number): ExoOrganicOverlayHost {
  return {
    exoOrganicTracker: null,
    exoOrganicLastFix: {
      latDeg: 0,
      lonDeg: 0,
      headingDeg: 0,
      planetRadiusM: 2_000_000,
      bodyName: "Probe 1 a",
    } as ExoOrganicOverlayHost["exoOrganicLastFix"],
    firstFootfallBodies: new Set<string>(),
    surfaceSampleMarks: [
      {
        bodyKey: "b1",
        bodyNameNorm: "probe 1 a",
        latDeg: 0.0172,
        lonDeg: 0,
        label: "Stratum tectonicas",
        atIso: "2026-09-18T00:00:00Z",
      },
    ] as ExoOrganicOverlayHost["surfaceSampleMarks"],
    explorationScans: new Map(),
    addSurfaceSampleMark: () => {},
    surfaceShipMark: null,
    minimapRadiusM: radius,
  };
}

describe("the radar radius", () => {
  it("is what the radar's DTO reports, not a constant", () => {
    /*
      The whole feature. If this reads 500 with the setting at 1000, the control in the Overlay
      panel changes a number nothing draws from.
    */
    expect(buildExoMinimapDto(host(1000), "b1", 500)?.radiusM).toBe(1000);
    expect(buildExoMinimapDto(host(750), "b1", 500)?.radiusM).toBe(750);
  });

  it("falls back to 500 m for a host that has no setting", () => {
    // Older stores, and the test hosts elsewhere in this repo, carry no such field.
    expect(buildExoMinimapDto(host(undefined), "b1", 500)?.radiusM).toBe(RADAR_RADIUS_DEFAULT_M);
  });

  it("clamps at the store, not only in the launcher's input", () => {
    /*
      The bounds ride to the launcher on /api/status so its input cannot offer a rejected value, but
      the route also takes JSON from anything on the LAN and the settings file is hand-editable.
    */
    const store = new GameStateStore();
    expect(store.minimapRadiusM).toBe(RADAR_RADIUS_DEFAULT_M);
    store.setMinimapRadiusM(50);
    expect(store.minimapRadiusM).toBe(RADAR_RADIUS_MIN_M);
    store.setMinimapRadiusM(99_999);
    expect(store.minimapRadiusM).toBe(RADAR_RADIUS_MAX_M);
  });

  it("reports whether it moved, so a no-op writes no settings file", () => {
    const store = new GameStateStore();
    expect(store.setMinimapRadiusM(RADAR_RADIUS_DEFAULT_M)).toBe(false);
    expect(store.setMinimapRadiusM(1000)).toBe(true);
    expect(store.setMinimapRadiusM(1000)).toBe(false);
  });

  it("treats a missing value as the default rather than the minimum", () => {
    // `Number(null)` is 0, which is finite; the same trap the poll rates had.
    for (const bad of [null, undefined, "", [], {}, NaN]) {
      expect(clampRadarRadiusM(bad)).toBe(RADAR_RADIUS_DEFAULT_M);
    }
  });

  it("ships its bounds so the launcher's input matches the server's", () => {
    const dto = radarRadiusDto(750);
    expect(dto).toEqual({
      radiusM: 750,
      minM: RADAR_RADIUS_MIN_M,
      maxM: RADAR_RADIUS_MAX_M,
      defaultM: RADAR_RADIUS_DEFAULT_M,
    });
  });

  it("still draws the far mark, because distance is measured not clipped", () => {
    /*
      Widening the radar must not be the only way to see a distant plant, and narrowing it must not
      delete one. The server sends every mark with its true distance; the radius decides whether the
      client draws a dot or a rim arrow, and that decision belongs on the drawing side.
    */
    const narrow = buildExoMinimapDto(host(250), "b1", 500);
    const wide = buildExoMinimapDto(host(2000), "b1", 500);
    expect(narrow?.marks).toHaveLength(1);
    expect(wide?.marks).toHaveLength(1);
    expect(Math.round(narrow!.marks[0]!.distanceM)).toBe(Math.round(wide!.marks[0]!.distanceM));
  });
});
