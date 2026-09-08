/**
 * Which bodies belong in the backlog, and — more importantly — which do not.
 *
 * Every exclusion here is a way to waste the commander's time. Offering a body somebody has already
 * walked sends them across the galaxy for a 5x that is gone; offering one they stripped themselves
 * sends them to a bare rock. Both look identical to a correct row until you arrive.
 *
 * The inclusion cases are the mirror: a body dropped from this list is a body the commander never
 * hears about again, and a filter that is too eager fails silently — an empty list looks exactly
 * like a finished one.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import {
  computeFirstDiscoveryBacklog,
  clearFirstDiscoveryBacklogCache,
} from "../src/server/firstDiscoveryBacklog.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import type { JournalLine } from "../src/shared/types.js";

const SYS = 6914570015099;
const OTHER = 1234567890123;
const TS = "2026-05-05T05:09:05Z";
const j = (o: Record<string, unknown>) => o as unknown as JournalLine;

/** The main star, which is what decides whether the *system* is this commander's discovery. */
const star = (systemAddress: number, wasDiscovered: boolean, name: string) =>
  j({
    timestamp: TS,
    event: "Scan",
    ScanType: "AutoScan",
    BodyName: `${name} A`,
    BodyID: 0,
    StarSystem: name,
    SystemAddress: systemAddress,
    StarType: "G",
    WasDiscovered: wasDiscovered,
    WasMapped: false,
  });

/** A landable planet of the kind bacteria actually grow on. */
const planet = (systemAddress: number, bodyId: number, name: string, wasFootfalled = false) =>
  j({
    timestamp: TS,
    event: "Scan",
    ScanType: "Detailed",
    BodyName: `${name} ${bodyId}`,
    BodyID: bodyId,
    StarSystem: name,
    SystemAddress: systemAddress,
    PlanetClass: "High metal content body",
    AtmosphereType: "CarbonDioxide",
    SurfaceGravity: 3.2,
    SurfaceTemperature: 210,
    SurfacePressure: 1500,
    Landable: true,
    Volcanism: "",
    WasDiscovered: false,
    WasMapped: false,
    WasFootfalled: wasFootfalled,
  });

const bioSignals = (systemAddress: number, bodyId: number, name: string, count = 3) =>
  j({
    timestamp: TS,
    event: "FSSBodySignals",
    BodyName: `${name} ${bodyId}`,
    BodyID: bodyId,
    SystemAddress: systemAddress,
    Signals: [{ Type: "$SAA_SignalType_Biological;", Type_Localised: "Biological", Count: count }],
  });

const scanOrganic = (systemAddress: number, bodyId: number) =>
  j({
    timestamp: TS,
    event: "ScanOrganic",
    ScanType: "Analyse",
    Genus: "$Codex_Ent_Bacterial_Genus_Name;",
    Genus_Localised: "Bacterium",
    Species: "$Codex_Ent_Bacterial_01_Name;",
    Species_Localised: "Bacterium Aurasus",
    Variant: "$Codex_Ent_Bacterial_01_M_Name;",
    Variant_Localised: "Bacterium Aurasus - Teal",
    SystemAddress: systemAddress,
    Body: bodyId,
  });

/** A system this commander found, with one landable body carrying biology. */
function seeded(name = "Test Sector AB-C d1-2", systemAddress = SYS, discovered = false) {
  const st = new GameStateStore();
  st.apply(j({ timestamp: TS, event: "FSDJump", StarSystem: name, SystemAddress: systemAddress }));
  st.apply(star(systemAddress, discovered, name));
  st.apply(planet(systemAddress, 3, name));
  st.apply(bioSignals(systemAddress, 3, name));
  return st;
}

const keys = (st: GameStateStore) => computeFirstDiscoveryBacklog(st).rows.map((r) => r.bodyKey);

beforeEach(() => {
  loadSpeciesDatabase();
  clearFirstDiscoveryBacklogCache();
});

describe("what belongs in the list", () => {
  it("includes a body in a system this commander discovered", () => {
    expect(keys(seeded())).toContain(`${SYS}:3`);
  });

  it("carries the 5x on every row, since nobody has walked them", () => {
    const [row] = computeFirstDiscoveryBacklog(seeded()).rows;
    expect(row).toBeDefined();
    // The floor must be a real prediction, not a zero standing in for one.
    expect(row!.minCr).toBeGreaterThan(0);
    expect(row!.maxCr).toBeGreaterThanOrEqual(row!.minCr);
  });
});

describe("what must never appear", () => {
  it("drops a system somebody else discovered", () => {
    // The whole premise is that this commander got there first.
    expect(keys(seeded("Somebody Elses AB-C d1-2", OTHER, true))).toHaveLength(0);
  });

  it("drops a system whose main star was never scanned", () => {
    // Absent is not the same as undiscovered — 1,417 of this commander's visited systems have no
    // BodyID 0 scan, and treating silence as a discovery would invent a backlog out of nothing.
    const st = new GameStateStore();
    st.apply(j({ timestamp: TS, event: "FSDJump", StarSystem: "Unhonked", SystemAddress: SYS }));
    st.apply(planet(SYS, 3, "Unhonked"));
    st.apply(bioSignals(SYS, 3, "Unhonked"));
    expect(keys(st)).toHaveLength(0);
  });

  it("drops a body the commander has already sampled", () => {
    const st = seeded();
    st.apply(scanOrganic(SYS, 3));
    expect(keys(st)).toHaveLength(0);
  });

  it("keeps it dropped after the samples are sold", () => {
    // SellOrganicData empties the unsold ledger but leaves organicGenusLocks alone, which is what
    // stops a stripped body being offered again the moment the commander cashes in.
    const st = seeded();
    st.apply(scanOrganic(SYS, 3));
    st.apply(
      j({
        timestamp: TS,
        event: "SellOrganicData",
        MarketID: 1,
        BioData: [
          {
            Genus: "$Codex_Ent_Bacterial_Genus_Name;",
            Species: "$Codex_Ent_Bacterial_01_Name;",
            Variant: "$Codex_Ent_Bacterial_01_M_Name;",
            Value: 1_000_000,
            Bonus: 0,
          },
        ],
      }),
    );
    expect(keys(st)).toHaveLength(0);
  });

  it("drops a body somebody else has already walked on", () => {
    // The 5x is gone, so the row would promise a bonus that no longer exists.
    const st = new GameStateStore();
    const name = "Walked AB-C d1-2";
    st.apply(j({ timestamp: TS, event: "FSDJump", StarSystem: name, SystemAddress: SYS }));
    st.apply(star(SYS, false, name));
    st.apply(planet(SYS, 3, name, true));
    st.apply(bioSignals(SYS, 3, name));
    expect(keys(st)).toHaveLength(0);
  });

  it("drops a body with no biological signal", () => {
    const st = new GameStateStore();
    const name = "Barren AB-C d1-2";
    st.apply(j({ timestamp: TS, event: "FSDJump", StarSystem: name, SystemAddress: SYS }));
    st.apply(star(SYS, false, name));
    st.apply(planet(SYS, 3, name));
    expect(keys(st)).toHaveLength(0);
  });
});

describe("surviving a cartographic sale", () => {
  it("still lists the body after the system's data is sold", () => {
    // Selling the map is not collecting the plants. The physics moves to soldExplorationScans and
    // `bodies` is untouched, so the row has to survive — otherwise cashing in at a station silently
    // erases the commander's own backlog. See tests/sellKeepsBiology.test.ts.
    const st = seeded();
    expect(keys(st)).toContain(`${SYS}:3`);
    st.apply(
      j({
        timestamp: TS,
        event: "MultiSellExplorationData",
        Discovered: [{ SystemName: "Test Sector AB-C d1-2", NumBodies: 4 }],
        BaseValue: 1_000_000,
        Bonus: 0,
        TotalEarnings: 1_000_000,
      }),
    );
    expect(keys(st)).toContain(`${SYS}:3`);
  });
});

describe("the summary", () => {
  it("counts systems rather than bodies", () => {
    const st = seeded();
    st.apply(planet(SYS, 4, "Test Sector AB-C d1-2"));
    st.apply(bioSignals(SYS, 4, "Test Sector AB-C d1-2"));
    const out = computeFirstDiscoveryBacklog(st);
    expect(out.rows.length).toBe(2);
    expect(out.systemCount).toBe(1);
    expect(out.totalMinCr).toBe(out.rows.reduce((a, r) => a + r.minCr, 0));
  });

  it("ranks by the floor, which is the number a route is planned on", () => {
    const st = seeded();
    st.apply(planet(SYS, 4, "Test Sector AB-C d1-2"));
    st.apply(bioSignals(SYS, 4, "Test Sector AB-C d1-2", 1));
    const rows = computeFirstDiscoveryBacklog(st).rows;
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.minCr).toBeGreaterThanOrEqual(rows[i]!.minCr);
    }
  });
});
