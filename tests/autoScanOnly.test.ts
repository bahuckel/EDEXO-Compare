/**
 * Landable bodies the ship only AutoScanned (owner, 2026-10-02): the game sends no FSSBodySignals for
 * an arrival AutoScan, so the app shows such a body as "AutoScanned only - FSS required" until the FSS
 * resolves it. Made-up system, the journal's shapes.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { autoScanOnlyBodies } from "../src/server/autoScanOnly.js";
import { GameStateStore } from "../src/server/gameState.js";
import { buildSnapshot, loadSpeciesDatabase } from "../src/server/snapshot.js";
import type { JournalLine } from "../src/shared/types.js";

const SA = 1234567890123;
const SYS = "Test Sector AB-C d1-2";
const jump = { timestamp: "2026-10-02T06:15:00Z", event: "FSDJump", StarSystem: SYS, SystemAddress: SA, StarPos: [0, 0, 0] };
const scan = (bodyId: number, type: string, extra: Record<string, unknown> = {}) => ({
  timestamp: "2026-10-02T06:15:59Z",
  event: "Scan",
  ScanType: type,
  BodyName: `${SYS} ${bodyId}`,
  BodyID: bodyId,
  Parents: [{ Star: 0 }],
  StarSystem: SYS,
  SystemAddress: SA,
  DistanceFromArrivalLS: 24.9,
  PlanetClass: "High metal content body",
  Atmosphere: "thin sulfur dioxide atmosphere",
  AtmosphereType: "SulphurDioxide",
  Volcanism: "",
  MassEM: 0.11,
  Radius: 3119845,
  SurfaceGravity: 4.55,
  SurfaceTemperature: 302,
  SurfacePressure: 317,
  Landable: true,
  ...extra,
});
const signals = (bodyId: number, bio: number) => ({
  timestamp: "2026-10-02T06:22:29Z",
  event: "FSSBodySignals",
  BodyName: `${SYS} ${bodyId}`,
  BodyID: bodyId,
  SystemAddress: SA,
  Signals: [{ Type: "$SAA_SignalType_Biological;", Type_Localised: "Biological", Count: bio }],
});

function storeWith(lines: Record<string, unknown>[]) {
  const s = new GameStateStore();
  for (const l of [jump, ...lines]) s.apply(l as unknown as JournalLine);
  return s;
}
const keys = (s: GameStateStore) => autoScanOnlyBodies(s, SA).map((b) => b.bodyId);

beforeAll(() => {
  loadSpeciesDatabase();
});

describe("a body the ship only AutoScanned", () => {
  it("is listed when landable, atmosphere or not, and not when it cannot be landed on", () => {
    const s = storeWith([
      scan(13, "AutoScan"),
      scan(14, "AutoScan", { Atmosphere: "", AtmosphereType: "None" }),
      scan(15, "AutoScan", { Landable: false }),
    ]);
    expect(keys(s)).toEqual([13, 14]);
    expect(autoScanOnlyBodies(s, SA)[0]!.autoScanOnly).toBe(true);
  });

  it("becomes an ordinary bio body once the FSS reports its signals", () => {
    const s = storeWith([scan(13, "AutoScan"), signals(13, 2)]);
    expect(keys(s)).toEqual([]);
    expect(s.bodies.get(`${SA}:13`)?.biologicalSignals).toBe(2);
  });

  it("leaves the list when the FSS resolves it with no life, and a later arrival AutoScan does not bring it back", () => {
    const s = storeWith([scan(13, "AutoScan"), scan(13, "Detailed"), scan(13, "AutoScan")]);
    expect(keys(s)).toEqual([]);
  });

  it("gets a tab in the snapshot, with its candidates and no signal count", () => {
    const s = storeWith([scan(13, "AutoScan")]);
    const snap = buildSnapshot(s, null, "", "127.0.0.1", 0, [], 1);
    const b = snap.bodies.find((x) => x.state.bodyId === 13)!;
    expect(b.state.autoScanOnly).toBe(true);
    expect(b.state.biologicalSignals).toBeNull();
  });

  it("is computed as if it had one signal, never shows that count, and gets no tab where nothing would grow", () => {
    const star = {
      timestamp: "2026-10-02T06:15:01Z",
      event: "Scan",
      ScanType: "AutoScan",
      BodyName: SYS,
      BodyID: 0,
      StarSystem: SYS,
      SystemAddress: SA,
      DistanceFromArrivalLS: 0,
      StarType: "K",
      Subclass: 4,
      StellarMass: 0.7,
      Radius: 500000000,
      AbsoluteMagnitude: 6.5,
      Luminosity: "Va",
      SurfaceTemperature: 4500,
    };
    const s = storeWith([
      star,
      scan(13, "AutoScan"),
      // A landable rock at 1,500 K with no atmosphere, under a K star: nothing in the database grows there.
      scan(16, "AutoScan", { PlanetClass: "Rocky body", Atmosphere: "", AtmosphereType: "None", SurfaceTemperature: 1500 }),
    ]);
    expect(keys(s)).toEqual([13, 16]);
    const snap = buildSnapshot(s, null, "", "127.0.0.1", 0, [], 1);
    expect(snap.bodies.some((x) => x.state.bodyId === 16)).toBe(false);
    const b = snap.bodies.find((x) => x.state.bodyId === 13)!;
    expect(b.matches.some((m) => !m.unlikely)).toBe(true);
    expect(b.state.biologicalSignals).toBeNull();
  });
});
