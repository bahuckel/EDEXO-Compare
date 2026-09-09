/**
 * Placing the backlog on the galaxy map.
 *
 * Two things can go quietly wrong here and both put a wrong dot on a map the commander is planning
 * a route from. A system the journals never gave a `StarPos` has no position at all, and defaulting
 * it to zero would plant a marker on Sol; dropping it without a word would shrink the backlog every
 * time the map is opened. And a system with four unfinished bodies is one place, not four, so the
 * rollup has to sum rather than repeat — the minimum-value filter tests the system's total, because
 * "is this worth the detour" is a question about the trip, not about one rock.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { backlogMap, clearFirstDiscoveryBacklogCache } from "../src/server/firstDiscoveryBacklog.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import type { JournalLine } from "../src/shared/types.js";

const SYS = 6914570015099;
const TS = "2026-05-05T05:09:05Z";
const NAME = "Test Sector AB-C d1-2";
const j = (o: Record<string, unknown>) => o as unknown as JournalLine;

const jump = (withPos: boolean) =>
  j({
    timestamp: TS,
    event: "FSDJump",
    StarSystem: NAME,
    SystemAddress: SYS,
    ...(withPos ? { StarPos: [123.5, -45.25, 678.75] } : {}),
  });

const star = j({
  timestamp: TS,
  event: "Scan",
  ScanType: "AutoScan",
  BodyName: `${NAME} A`,
  BodyID: 0,
  StarSystem: NAME,
  SystemAddress: SYS,
  StarType: "G",
  WasDiscovered: false,
  WasMapped: false,
});

const planet = (bodyId: number) =>
  j({
    timestamp: TS,
    event: "Scan",
    ScanType: "Detailed",
    BodyName: `${NAME} ${bodyId}`,
    BodyID: bodyId,
    StarSystem: NAME,
    SystemAddress: SYS,
    PlanetClass: "High metal content body",
    AtmosphereType: "CarbonDioxide",
    SurfaceGravity: 3.2,
    SurfaceTemperature: 210,
    SurfacePressure: 1500,
    Landable: true,
    Volcanism: "",
    WasDiscovered: false,
    WasMapped: false,
    WasFootfalled: false,
  });

const bio = (bodyId: number) =>
  j({
    timestamp: TS,
    event: "FSSBodySignals",
    BodyName: `${NAME} ${bodyId}`,
    BodyID: bodyId,
    SystemAddress: SYS,
    Signals: [{ Type: "$SAA_SignalType_Biological;", Type_Localised: "Biological", Count: 3 }],
  });

function seeded(withPos: boolean, bodyIds: number[]): GameStateStore {
  const st = new GameStateStore();
  st.apply(jump(withPos));
  st.apply(star);
  for (const id of bodyIds) {
    st.apply(planet(id));
    st.apply(bio(id));
  }
  return st;
}

beforeEach(() => {
  loadSpeciesDatabase();
  clearFirstDiscoveryBacklogCache();
});

describe("placing a system", () => {
  it("uses the StarPos the journal actually carried", () => {
    const out = backlogMap(seeded(true, [3]));
    expect(out.systems).toHaveLength(1);
    expect(out.systems[0]).toMatchObject({ x: 123.5, y: -45.25, z: 678.75, starSystem: NAME });
    expect(out.unplaceable).toBe(0);
  });

  it("counts a system it cannot place instead of putting it at the origin", () => {
    // Zero is a real place. A backlog system drawn there is a marker on Sol that nothing explains.
    const out = backlogMap(seeded(false, [3]));
    expect(out.systems).toHaveLength(0);
    expect(out.unplaceable).toBe(1);
  });

  it("counts an unplaceable system once however many bodies it holds", () => {
    const out = backlogMap(seeded(false, [3, 4, 5]));
    expect(out.unplaceable).toBe(1);
  });
});

describe("rolling bodies up to their system", () => {
  it("is one dot carrying the summed floor", () => {
    const one = backlogMap(seeded(true, [3]));
    const three = backlogMap(seeded(true, [3, 4, 5]));
    expect(three.systems).toHaveLength(1);
    expect(three.systems[0]!.bodies).toBe(3);
    // The filter tests the trip, so the trip's total is what the row has to carry.
    expect(three.systems[0]!.floorCr).toBe(one.systems[0]!.floorCr * 3);
    expect(three.systems[0]!.ceilingCr).toBe(one.systems[0]!.ceilingCr * 3);
  });

  it("ranks the richest system first", () => {
    const out = backlogMap(seeded(true, [3, 4]));
    for (let i = 1; i < out.systems.length; i++) {
      expect(out.systems[i - 1]!.floorCr).toBeGreaterThanOrEqual(out.systems[i]!.floorCr);
    }
  });

  it("only calls a system verified when every body in it is", () => {
    // One unverified body makes the whole trip a gamble, so the system must not claim otherwise.
    const st = seeded(true, [3]);
    st.apply(
      j({
        timestamp: TS,
        event: "Scan",
        ScanType: "Detailed",
        BodyName: `${NAME} 9`,
        BodyID: 9,
        StarSystem: NAME,
        SystemAddress: SYS,
        PlanetClass: "High metal content body",
        AtmosphereType: "CarbonDioxide",
        SurfaceGravity: 3.2,
        SurfaceTemperature: 210,
        SurfacePressure: 1500,
        Landable: true,
        Volcanism: "",
        WasDiscovered: false,
        WasMapped: false,
        // No WasFootfalled: the pre-2025-09-29 shape, where nothing has ever reported.
      }),
    );
    st.apply(bio(9));
    const out = backlogMap(st);
    expect(out.systems[0]!.bodies).toBe(2);
    expect(out.systems[0]!.allVerified).toBe(false);
  });
});

describe("how far away it is", () => {
  it("measures from where the commander is now", () => {
    const st = seeded(true, [3]);
    // The seeded system sits at (123.5, -45.25, 678.75); put the ship 100 ly along x from it.
    st.apply(
      j({
        timestamp: TS,
        event: "FSDJump",
        StarSystem: "Somewhere Else",
        SystemAddress: 999,
        StarPos: [223.5, -45.25, 678.75],
      }),
    );
    const out = backlogMap(st);
    expect(out.systems[0]!.distanceLy).toBeCloseTo(100, 6);
  });

  it("is null when the system is placed but the commander is not", () => {
    // Zero would read as "you are already here", which is the most useful-looking wrong answer a
    // routing list can give.
    //
    // Not reachable by replaying events — the line that places a system is the line that places the
    // commander — so it is reached the way it actually could be: a cache restored with positions but
    // no last-known commander position.
    const source = seeded(true, [3]);
    const payload = { ...source.serializeJournalMergePayload(), commanderPos: null };
    const st = new GameStateStore();
    expect(st.hydrateJournalMergePayload(payload)).toBe(true);
    clearFirstDiscoveryBacklogCache();
    const out = backlogMap(st);
    expect(out.systems).toHaveLength(1);
    expect(out.systems[0]!.distanceLy).toBeNull();
  });

  it("is not frozen into the memoised backlog", () => {
    // The rows cost ~45 s to compute and are cached against the corpus; the commander moves without
    // the corpus changing. A distance baked into that cache would stay pinned to wherever they were
    // when the panel was first opened.
    const st = seeded(true, [3]);
    st.apply(
      j({ timestamp: TS, event: "FSDJump", StarSystem: "A", SystemAddress: 991, StarPos: [123.5, -45.25, 778.75] }),
    );
    const near = backlogMap(st).systems[0]!.distanceLy;
    st.apply(
      j({ timestamp: TS, event: "FSDJump", StarSystem: "B", SystemAddress: 992, StarPos: [123.5, -45.25, 1678.75] }),
    );
    const far = backlogMap(st).systems[0]!.distanceLy;
    expect(near).toBeCloseTo(100, 6);
    expect(far).toBeCloseTo(1000, 6);
  });
});
