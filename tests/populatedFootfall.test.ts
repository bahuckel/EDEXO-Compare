/**
 * No first-footfall bonus in populated or colonising systems (owner's bug report, 2026-09-25).
 *
 * Tewi C 5, in the Bubble, showed ×5 on 95M CR of organics and paid ×1. Planets in populated
 * systems never show a first footfall, whatever the scan's `WasFootfalled` says; the owner's sales
 * agree. His check order: skip everything if this commander discovered the system; otherwise
 * population, then security / government, then a controlling faction, and only then the list of
 * systems Frontier populated.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { setDeveloperPopulatedSystemsForTests } from "../src/server/developerPopulatedSystems.js";
import type { JournalLine } from "../src/shared/types.js";

const SA = 1733119984354;
const line = (o: Record<string, unknown>): JournalLine =>
  ({ timestamp: "2026-09-25T10:00:00Z", ...o }) as unknown as JournalLine;
const arrive = (extra: Record<string, unknown>) =>
  line({ event: "FSDJump", StarSystem: "Test", SystemAddress: SA, StarPos: [1, 2, 3], ...extra });
const scan = line({
  event: "Scan",
  ScanType: "Detailed",
  StarSystem: "Test",
  SystemAddress: SA,
  BodyName: "Test C 5",
  BodyID: 21,
  PlanetClass: "Rocky body",
  WasDiscovered: true,
  WasMapped: true,
  WasFootfalled: false,
});
const disembark = line({
  event: "Disembark",
  OnPlanet: true,
  OnStation: false,
  SystemAddress: SA,
  BodyID: 21,
  Body: "Test C 5",
});
const BK = `${SA}:21`;
const faction = { SystemFaction: { Name: "Some Architect's Faction" } };

beforeEach(() => setDeveloperPopulatedSystemsForTests([]));
afterEach(() => setDeveloperPopulatedSystemsForTests(null));

describe("system kind and the first-footfall bonus", () => {
  it("1. populated and on Frontier's list: bubble, walked, no ×5", () => {
    setDeveloperPopulatedSystemsForTests([SA]);
    const s = new GameStateStore();
    for (const l of [arrive({ Population: 396557 }), scan, disembark]) s.apply(l);
    expect(s.systemKind(SA)).toBe("bubble");
    expect(s.bodyDetailedFootfallState.get(BK)).toBe(true);
    expect(s.bodyFootfallFlag.get(BK)?.source).toBe("populated");
    expect(s.firstFootfallBodies.has(BK)).toBe(false);
  });

  it("1. populated and not on the list: colony, no ×5", () => {
    const s = new GameStateStore();
    for (const l of [arrive({ Population: 198062 }), scan, disembark]) s.apply(l);
    expect(s.systemKind(SA)).toBe("colony");
    expect(s.firstFootfallBodies.has(BK)).toBe(false);
  });

  it("2. no population but a controlling faction and no factions: colonising, no ×5", () => {
    const s = new GameStateStore();
    for (const l of [arrive({ Population: 0, ...faction }), scan, disembark]) s.apply(l);
    expect(s.systemKind(SA)).toBe("colonising");
    expect(s.firstFootfallBodies.has(BK)).toBe(false);
  });

  it("2. no people but a Prison government (a detention centre): facility, no ×5", () => {
    const s = new GameStateStore();
    for (const l of [
      arrive({ Population: 0, SystemGovernment: "$government_Prison;", ...faction }),
      scan,
      disembark,
    ])
      s.apply(l);
    expect(s.systemKind(SA)).toBe("facility");
    expect(s.firstFootfallBodies.has(BK)).toBe(false);
  });

  it("2. no people but real security: facility, no ×5", () => {
    const s = new GameStateStore();
    for (const l of [arrive({ Population: 0, SystemSecurity: "$SYSTEM_SECURITY_medium;" }), scan, disembark])
      s.apply(l);
    expect(s.systemKind(SA)).toBe("facility");
  });

  it("0. first in the system (WasDiscovered false on the arrival star): no checks, the scan decides", () => {
    setDeveloperPopulatedSystemsForTests([SA]); // even the file cannot override a first discovery
    const s = new GameStateStore();
    const star = line({
      event: "Scan",
      ScanType: "AutoScan",
      StarSystem: "Test",
      SystemAddress: SA,
      BodyName: "Test A",
      BodyID: 1,
      StarType: "K",
      DistanceFromArrivalLS: 0,
      WasDiscovered: false,
      WasMapped: false,
    });
    for (const l of [arrive({ Population: 0 }), star, scan, disembark]) s.apply(l);
    expect(s.noFirstFootfallInSystem(SA)).toBe(false);
    expect(s.firstFootfallBodies.has(BK)).toBe(true);
  });

  it("3. on Frontier's list without a visit: bubble, so a scan alone is not ×5", () => {
    setDeveloperPopulatedSystemsForTests([SA]);
    const s = new GameStateStore();
    s.apply(scan);
    expect(s.systemKind(SA)).toBe("bubble");
    expect(s.bodyDetailedFootfallState.get(BK)).toBe(true);
  });

  it("empty: the scan decides, and the bonus stays", () => {
    const s = new GameStateStore();
    for (const l of [
      arrive({
        Population: 0,
        SystemSecurity: "$GAlAXY_MAP_INFO_state_anarchy;",
        SystemGovernment: "$government_None;",
      }),
      scan,
      disembark,
    ])
      s.apply(l);
    expect(s.systemKind(SA)).toBe("empty");
    expect(s.firstFootfallBodies.has(BK)).toBe(true);
  });

  it("takes the bonus back when a later arrival shows the system is populated", () => {
    const s = new GameStateStore();
    s.apply(scan);
    expect(s.bodyDetailedFootfallState.get(BK)).toBe(false);
    s.apply(
      line({ event: "Location", StarSystem: "Test", SystemAddress: SA, StarPos: [1, 2, 3], Population: 12 }),
    );
    expect(s.bodyDetailedFootfallState.get(BK)).toBe(true);
  });

  it("survives the journal cache", () => {
    const s = new GameStateStore();
    s.apply(arrive({ Population: 0, ...faction }));
    const t = new GameStateStore();
    expect(t.hydrateJournalMergePayload(JSON.parse(JSON.stringify(s.serializeJournalMergePayload())))).toBe(
      true,
    );
    expect(t.systemKind(SA)).toBe("colonising");
  });
});
