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
