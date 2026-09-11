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
import {
  buildExoMinimapDto,
  buildExoOrganicOverlayDto,
  type ExoOrganicOverlayHost,
} from "../src/server/exoOrganicTracker.js";
import type { PriceIndex } from "../src/server/priceList.js";
import { normStatusBodyName } from "../src/server/organicSampleSessionFile.js";

/** A body about the size of a small moon, so a degree is a round-ish number of metres. */
const RADIUS_M = 1_000_000;
const M_PER_DEG = (Math.PI * RADIUS_M) / 180;

/**
 * The rock the commander is standing on, as `Status.json` names it.
 *
 * Marks are matched against this rather than against a body id, because `Status.json` is the only
 * thing that knows he has flown away — the journal's last Touchdown still names the planet long
 * after he has left it.
 */
const HERE = "Test Sector AB-C d1-2 B 4";
const HERE_NORM = normStatusBodyName(HERE)!;
const ELSEWHERE = "Test Sector AB-C d1-2 A 1";

function mark(latDeg: number, lonDeg: number, label: string, bodyName = HERE, bodyKey = "1:2") {
  return {
    bodyKey,
    bodyNameNorm: normStatusBodyName(bodyName)!,
    latDeg,
    lonDeg,
    label,
    atIso: "2026-09-11T10:00:00Z",
  };
}

function host(
  over: {
    lat?: number;
    lon?: number;
    heading?: number | null;
    marks?: ReturnType<typeof mark>[];
    ship?: ReturnType<typeof mark> | null;
    /** What `Status.json` says the commander is standing on; null while in flight. */
    bodyName?: string | null;
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
      bodyName: over.bodyName === undefined ? HERE : over.bodyName,
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
    const oneDegNorth = mark(1, 0, "North plant");
    const oneDegEast = mark(0, 1, "East plant");
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
      host({ marks: [mark(-1, -1, "Southwest")] }),
    )!.minimap!;
    expect(mm.marks[0]!.northM).toBeLessThan(0);
    expect(mm.marks[0]!.eastM).toBeLessThan(0);
  });

  it("takes the short way round the antimeridian", () => {
    // Standing at 179.9°, a plant at -179.9° is 0.2° away, not 359.8°.
    const mm = build(
      host({ lon: 179.9, marks: [mark(0, -179.9, "Over there")] }),
    )!.minimap!;
    expect(mm.marks[0]!.eastM).toBeCloseTo(0.2 * M_PER_DEG, 0);
    // And the reported distance agrees with the offset rather than wrapping the long way.
    expect(mm.marks[0]!.distanceM).toBeCloseTo(0.2 * M_PER_DEG, 0);
  });

  it("shrinks east-west distance near the pole, where a degree of longitude is short", () => {
    const atEquator = build(host({ lat: 0, marks: [mark(0, 1, "e")] }))!
      .minimap!.marks[0]!.eastM;
    const atSixty = build(host({ lat: 60, marks: [mark(60, 1, "e")] }))!
      .minimap!.marks[0]!.eastM;
    // cos(60°) = 0.5, so the same degree of longitude is half the distance.
    expect(atSixty).toBeCloseTo(atEquator * 0.5, 0);
  });

  it("carries the ship as its own kind, so the map can draw it differently", () => {
    const mm = build(
      host({
        marks: [mark(0.001, 0, "A plant")],
        ship: mark(0, 0.002, "Your ship"),
      }),
    )!.minimap!;
    expect(mm.marks.map((m) => m.kind).sort()).toEqual(["sample", "ship"]);
    expect(mm.marks.find((m) => m.kind === "ship")!.label).toBe("Your ship");
  });

  it("leaves out marks from another body — the map is this rock, not the last one", () => {
    const mm = build(
      host({
        marks: [mark(0.001, 0, "Elsewhere", ELSEWHERE, "9:9")],
        ship: mark(0, 0.002, "Your ship", ELSEWHERE, "9:9"),
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

  it("draws without a sample session, which is the state you land in", () => {
    /*
      The radar used to live inside the session payload, so a commander who had just touched down
      and not yet scanned anything saw nothing at all. Reported as "overlay does not have the
      radar".
    */
    const h = host({ ship: mark(0, 0.002, "Your ship") });
    h.exoOrganicTracker = null;
    expect(buildExoOrganicOverlayDto(h, prices)).toBeNull();

    const mm = buildExoMinimapDto(h, "1:2", 0)!;
    expect(mm.marks).toHaveLength(1);
    expect(mm.marks[0]!.kind).toBe("ship");
  });

  it("lets the live body name decide, not the last body the journal named", () => {
    /*
      The journal's last Touchdown goes on naming a planet long after the commander has flown away
      from it, so the body *key* cannot answer "am I still there". Status.json can, and does.
    */
    const h = host({ marks: [mark(0.001, 0, "Here")] });
    // Standing on it: shown, whatever stale key is passed alongside.
    expect(buildExoMinimapDto(h, "7:7", 0)!.marks).toHaveLength(1);
  });

  it("falls back to the body key when the live fix has no name for the surface", () => {
    const h = host({ bodyName: null, marks: [mark(0.001, 0, "Here")] });
    expect(buildExoMinimapDto(h, "1:2", 0)!.marks).toHaveLength(1);
    expect(buildExoMinimapDto(h, "7:7", 0)!.marks).toHaveLength(0);
  });
});

/**
 * The owner's rule, in his words: *"if I enter supercruise they get dropped until I go down on that
 * planet again"*.
 *
 * Nothing is deleted on leaving. The marks are filed under the body they belong to and stop
 * matching while he is somewhere else — which is what makes coming back free.
 */
describe("leaving and coming back", () => {
  it("drops the marks once the commander is on a different body", () => {
    const marks = [mark(0.001, 0, "A plant"), mark(0.002, 0, "Another")];
    expect(build(host({ marks }))!.minimap!.marks).toHaveLength(2);

    const away = build(host({ marks, bodyName: ELSEWHERE }))!.minimap!;
    expect(away.marks).toHaveLength(0);
  });

  it("brings them back on landing, because they were never thrown away", () => {
    const marks = [mark(0.001, 0, "A plant")];
    const away = host({ marks, bodyName: ELSEWHERE });
    expect(build(away)!.minimap!.marks).toHaveLength(0);
    // Same store, same marks, back on the original rock.
    expect(build(host({ marks }))!.minimap!.marks).toHaveLength(1);
  });

  it("keeps one body's marks off another body's map", () => {
    const here = mark(0.001, 0, "Here");
    const there = mark(0.001, 0, "There", ELSEWHERE, "9:9");
    const mm = build(host({ marks: [here, there] }))!.minimap!;
    expect(mm.marks.map((m) => m.label)).toEqual(["Here"]);
  });
});

/**
 * The radar's memory across a restart.
 *
 * Two sources know things: the marks file (plants, which nothing else can supply) and the journal
 * merge cache (the ship, which `Touchdown` carries). They arrive in a fixed order — file first,
 * cache on top — and a full cache hit skips the journal entirely, so the cache can be the *older*
 * answer while still being applied last.
 */
describe("what survives a restart", () => {
  const shipAt = (atIso: string, lat: number) => ({
    bodyKey: "1:2",
    bodyNameNorm: HERE_NORM,
    latDeg: lat,
    lonDeg: 0,
    label: "Your ship",
    atIso,
  });

  it("keeps the newer landing when the cache is older than the file", async () => {
    const { GameStateStore } = await import("../src/server/gameState.js");
    const store = new GameStateStore();
    // The marks file supplied a landing from today...
    store.surfaceShipMark = shipAt("2026-09-11T10:15:33Z", 1);
    // ...and a cache written before it must not overwrite that.
    const payload = new GameStateStore().serializeJournalMergePayload();
    payload.surfaceShipMark = shipAt("2020-01-01T00:00:00Z", 99);
    store.hydrateJournalMergePayload(payload);
    expect(store.surfaceShipMark!.latDeg).toBe(1);
  });

  it("takes the cache's landing when that is the newer one", async () => {
    const { GameStateStore } = await import("../src/server/gameState.js");
    const store = new GameStateStore();
    store.surfaceShipMark = shipAt("2020-01-01T00:00:00Z", 1);
    const payload = new GameStateStore().serializeJournalMergePayload();
    payload.surfaceShipMark = shipAt("2026-09-11T10:15:33Z", 99);
    store.hydrateJournalMergePayload(payload);
    expect(store.surfaceShipMark!.latDeg).toBe(99);
  });

  it("does not let an empty cache erase a landing the file knew about", async () => {
    const { GameStateStore } = await import("../src/server/gameState.js");
    const store = new GameStateStore();
    store.surfaceShipMark = shipAt("2026-09-11T10:15:33Z", 1);
    const payload = new GameStateStore().serializeJournalMergePayload();
    payload.surfaceShipMark = null;
    store.hydrateJournalMergePayload(payload);
    expect(store.surfaceShipMark).not.toBeNull();
  });
});
