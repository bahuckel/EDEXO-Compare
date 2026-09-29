/**
 * The commander's own layer on the 3D map (galaxyMine.ts, G3): which of their systems is placed,
 * what each one's flags say, the detail panel's bodies, and this session's route.
 *
 * "Done" is his rule (2026-09-28): a DSS or plants scanned on foot. "Waiting" is the backlog — bio
 * bodies still unsampled — and it wins the colour, because it is the one that asks for a trip.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { backlogMap, clearFirstDiscoveryBacklogCache } from "../src/server/firstDiscoveryBacklog.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import {
  MINE_DSS,
  MINE_FIRST_DISCOVERY,
  MINE_ORGANIC,
  MINE_UNFINISHED,
  MINE_VISITED,
  mySystemDetail,
  mySystemsDto,
  sessionRouteDto,
} from "../src/server/galaxyMine.js";
import type { JournalLine } from "../src/shared/types.js";

const TS = "2026-05-05T05:09:05Z";
const j = (o: Record<string, unknown>) => o as unknown as JournalLine;

const A = { addr: 6914570015099, name: "Test Sector AB-C d1-2", pos: [123.5, -45.25, 678.75] };
const B = { addr: 1234567890, name: "Other Sector XY-Z a1", pos: [-500, 10, 900] };

const jump = (s: typeof A, withPos = true) =>
  j({ timestamp: TS, event: "FSDJump", StarSystem: s.name, SystemAddress: s.addr, ...(withPos ? { StarPos: s.pos } : {}) });
const star = (s: typeof A, wasDiscovered: boolean) =>
  j({
    timestamp: TS,
    event: "Scan",
    ScanType: "AutoScan",
    BodyName: `${s.name} A`,
    BodyID: 0,
    StarSystem: s.name,
    SystemAddress: s.addr,
    StarType: "G",
    WasDiscovered: wasDiscovered,
    WasMapped: false,
  });
const planet = (s: typeof A, id: number) =>
  j({
    timestamp: TS,
    event: "Scan",
    ScanType: "Detailed",
    BodyName: `${s.name} ${id}`,
    BodyID: id,
    StarSystem: s.name,
    SystemAddress: s.addr,
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
const bio = (s: typeof A, id: number) =>
  j({
    timestamp: TS,
    event: "FSSBodySignals",
    BodyName: `${s.name} ${id}`,
    BodyID: id,
    SystemAddress: s.addr,
    Signals: [{ Type: "$SAA_SignalType_Biological;", Type_Localised: "Biological", Count: 2 }],
  });
const dss = (s: typeof A, id: number) =>
  j({ timestamp: TS, event: "SAAScanComplete", BodyName: `${s.name} ${id}`, BodyID: id, SystemAddress: s.addr });

beforeEach(() => {
  loadSpeciesDatabase();
  clearFirstDiscoveryBacklogCache();
});

describe("the commander's systems", () => {
  it("flags a first-discovered system with bio still waiting, and a mapped one elsewhere as done", () => {
    const st = new GameStateStore();
    st.apply(jump(A));
    st.apply(star(A, false));
    st.apply(planet(A, 3));
    st.apply(bio(A, 3));
    st.apply(jump(B));
    st.apply(star(B, true));
    st.apply(planet(B, 2));
    st.apply(dss(B, 2));
    const dto = mySystemsDto(st, backlogMap(st));
    const a = dto.systems.find((s) => s.addr === A.addr)!;
    const b = dto.systems.find((s) => s.addr === B.addr)!;
    expect(a.name).toBe(A.name);
    expect([a.x, a.y, a.z]).toEqual(A.pos);
    expect(a.flags & MINE_VISITED).toBeTruthy();
    expect(a.flags & MINE_UNFINISHED).toBeTruthy();
    expect(a.flags & MINE_FIRST_DISCOVERY).toBeTruthy();
    expect(a.bioBodies).toBe(1);
    expect(a.unfinishedFloorCr).toBeGreaterThan(0);
    expect(b.flags & MINE_DSS).toBeTruthy();
    expect(b.flags & (MINE_UNFINISHED | MINE_ORGANIC | MINE_FIRST_DISCOVERY)).toBe(0);
  });

  it("counts a system with no StarPos as unplaceable instead of putting it on Sol", () => {
    const st = new GameStateStore();
    st.apply(jump(A, false));
    const dto = mySystemsDto(st, backlogMap(st));
    expect(dto.systems).toEqual([]);
    expect(dto.unplaceable).toBe(1);
  });

  it("lists a system's bio bodies for the panel, and refuses a system never visited", () => {
    const st = new GameStateStore();
    st.apply(jump(A));
    st.apply(planet(A, 3));
    st.apply(bio(A, 3));
    const d = mySystemDetail(st, A.addr, backlogMap(st), null)!;
    expect(d.name).toBe(A.name);
    expect(d.bodies).toEqual([{ name: `${A.name} 3`, signals: 2, dss: false, firstFootfall: false, species: [] }]);
    expect(d.indexOrdinal).toBeNull();
    expect(mySystemDetail(st, 42, backlogMap(st), null)).toBeNull();
  });

  it("draws this session's jumps where the journals placed them, skipping the unplaced", () => {
    const st = new GameStateStore();
    st.apply(jump(A));
    st.apply(jump(B));
    const r = sessionRouteDto(st, [
      { name: A.name, at: "t1" },
      { name: "Nowhere Known", at: "t2" },
      { name: B.name.toUpperCase(), at: "t3" },
    ]);
    expect(r.route.map((p) => p.name)).toEqual([A.name, B.name.toUpperCase()]);
    expect(r.route[1]).toMatchObject({ x: -500, y: 10, z: 900 });
    expect(r.position).toEqual({ x: -500, y: 10, z: 900 });
    expect(r.system).toBe(B.name);
  });
});
