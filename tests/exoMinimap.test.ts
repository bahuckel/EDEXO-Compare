/**
 * The overlay minimap — where things are around you, in metres.
 *
 * The owner asked for a minimap "based on the coordinates on the planet", and the coordinates were
 * already being captured for the distance readouts. What was missing was the geometry: turning two
 * latitudes into "12 m north, 40 m east" so a transparent HUD can draw an arrow without doing
 * spherical trigonometry on a 320 ms tick.
 *
 * Two things are pinned here because getting either wrong is invisible until you are standing on a
 * planet in the dark: the sign convention (north is +, east is +) and the longitude wrap, which is
 * the difference between "20 m that way" and "half a planet away" for anything near the
 * antimeridian.
 *
 * What is *not* testable here, and is stated in the code instead: a plant can only be placed if the
 * app was running when it was scanned. `ScanOrganic` carries no coordinates.
 */
import { describe, expect, it } from "vitest";
import { buildExoOrganicOverlayDto, type ExoOrganicOverlayHost } from "../src/server/exoOrganicTracker.js";
import type { PriceIndex } from "../src/server/priceList.js";

/** A body about the size of a small moon, so a degree is a round-ish number of metres. */
const RADIUS_M = 1_000_000;
const M_PER_DEG = (Math.PI * RADIUS_M) / 180;

function host(
  over: {
    lat?: number;
    lon?: number;
    heading?: number | null;
    marks?: { bodyKey: string; latDeg: number; lonDeg: number; label: string }[];
    ship?: { bodyKey: string; latDeg: number; lonDeg: number } | null;
  } = {},
): ExoOrganicOverlayHost {
  return {
    exoOrganicTracker: {
      bundleKey: "b",
      bodyKey: "1:2",
      speciesKey: "bacterium aurasus",
      speciesDisplay: "Bacterium Aurasus",
      genusLocalised: "Bacterium",
      bodyNameNorm: "body",
      minSampleDistanceM: 500,
      anchors: [{ latDeg: over.lat ?? 0, lonDeg: over.lon ?? 0, planetRadiusM: RADIUS_M }],
      phase: "tracking",
      celebrationUntil: 0,
    },
    exoOrganicLastFix: {
      latDeg: over.lat ?? 0,
      lonDeg: over.lon ?? 0,
      planetRadiusM: RADIUS_M,
      bodyName: "body",
      headingDeg: over.heading === undefined ? 90 : over.heading,
    },
    firstFootfallBodies: new Set<string>(),
    surfaceSampleMarks: over.marks ?? [],
    surfaceShipMark: over.ship ?? null,
    addSurfaceSampleMark() {
      /* not exercised by the DTO builder */
    },
  };
}

/** Empty: the minimap is geometry, and a price would only change the credits rows beside it. */
const prices: PriceIndex = new Map();

function build(h: ExoOrganicOverlayHost) {
  return buildExoOrganicOverlayDto(h, prices);
}

describe("the minimap payload", () => {
  it("puts north on the plus side and east on the plus side", () => {
    const oneDegNorth = { bodyKey: "1:2", latDeg: 1, lonDeg: 0, label: "North plant" };
    const oneDegEast = { bodyKey: "1:2", latDeg: 0, lonDeg: 1, label: "East plant" };
    const mm = build(host({ marks: [oneDegNorth, oneDegEast] }))!.minimap!;

    const north = mm.marks.find((m) => m.label === "North plant")!;
    expect(north.northM).toBeCloseTo(M_PER_DEG, 0);
    expect(north.eastM).toBeCloseTo(0, 6);

    const east = mm.marks.find((m) => m.label === "East plant")!;
    expect(east.eastM).toBeCloseTo(M_PER_DEG, 0);
    expect(east.northM).toBeCloseTo(0, 6);
  });

  it("puts south and west on the minus side", () => {
    const mm = build(
      host({ marks: [{ bodyKey: "1:2", latDeg: -1, lonDeg: -1, label: "Southwest" }] }),
    )!.minimap!;
    expect(mm.marks[0]!.northM).toBeLessThan(0);
    expect(mm.marks[0]!.eastM).toBeLessThan(0);
  });

  it("takes the short way round the antimeridian", () => {
    // Standing at 179.9°, a plant at -179.9° is 0.2° away, not 359.8°.
    const mm = build(
      host({ lon: 179.9, marks: [{ bodyKey: "1:2", latDeg: 0, lonDeg: -179.9, label: "Over there" }] }),
    )!.minimap!;
    expect(mm.marks[0]!.eastM).toBeCloseTo(0.2 * M_PER_DEG, 0);
    // And the reported distance agrees with the offset rather than wrapping the long way.
    expect(mm.marks[0]!.distanceM).toBeCloseTo(0.2 * M_PER_DEG, 0);
  });

  it("shrinks east-west distance near the pole, where a degree of longitude is short", () => {
    const atEquator = build(host({ lat: 0, marks: [{ bodyKey: "1:2", latDeg: 0, lonDeg: 1, label: "e" }] }))!
      .minimap!.marks[0]!.eastM;
    const atSixty = build(host({ lat: 60, marks: [{ bodyKey: "1:2", latDeg: 60, lonDeg: 1, label: "e" }] }))!
      .minimap!.marks[0]!.eastM;
    // cos(60°) = 0.5, so the same degree of longitude is half the distance.
    expect(atSixty).toBeCloseTo(atEquator * 0.5, 0);
  });

  it("carries the ship as its own kind, so the map can draw it differently", () => {
    const mm = build(
      host({
        marks: [{ bodyKey: "1:2", latDeg: 0.001, lonDeg: 0, label: "A plant" }],
        ship: { bodyKey: "1:2", latDeg: 0, lonDeg: 0.002 },
      }),
    )!.minimap!;
    expect(mm.marks.map((m) => m.kind).sort()).toEqual(["sample", "ship"]);
    expect(mm.marks.find((m) => m.kind === "ship")!.label).toBe("Your ship");
  });

  it("leaves out marks from another body — the map is this rock, not the last one", () => {
    const mm = build(
      host({
        marks: [{ bodyKey: "9:9", latDeg: 0.001, lonDeg: 0, label: "Elsewhere" }],
        ship: { bodyKey: "9:9", latDeg: 0, lonDeg: 0.002 },
      }),
    )!.minimap!;
    expect(mm.marks).toHaveLength(0);
  });

  it("carries the genus separation, so the map can draw the ring being cleared", () => {
    const mm = build(host())!.minimap!;
    expect(mm.minSampleDistanceM).toBe(500);
    expect(mm.radiusM).toBe(500);
  });

  it("passes the heading through, and null when the game is not reporting one", () => {
    expect(build(host({ heading: 217 }))!.minimap!.headingDeg).toBe(217);
    expect(build(host({ heading: null }))!.minimap!.headingDeg).toBeNull();
  });

  it("is absent entirely when the game has not given a surface position", () => {
    const h = host();
    h.exoOrganicLastFix = null;
    expect(build(h)!.minimap).toBeNull();
  });
});
