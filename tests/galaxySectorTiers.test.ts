/**
 * Combining the commander's own journal with everyone else's corpus, per sector.
 *
 * The half that matters is the one that stops the map discouraging its user: a sector they have
 * worked must not keep telling them somebody found a species there, and a sector they have half
 * worked must not tell them they are finished.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { commanderSectorFacts, sectorTiers } from "../src/server/galaxySectorTiers.js";
import { sectorCellFromCoords, sectorCellKey } from "../src/shared/sectorName.js";
import type { JournalLine } from "../src/shared/types.js";

const SYS = 6914570015099;
const POS = { x: 100, y: 20, z: 300 };
const KEY = sectorCellKey(sectorCellFromCoords(POS.x, POS.y, POS.z));
const TS = "2026-05-05T05:09:05Z";
const j = (o: Record<string, unknown>) => o as unknown as JournalLine;

const jump = () =>
  j({ timestamp: TS, event: "FSDJump", StarSystem: "Test", SystemAddress: SYS, StarPos: [POS.x, POS.y, POS.z] });

const planetWithBio = (bodyId: number) => [
  j({
    timestamp: TS,
    event: "Scan",
    ScanType: "Detailed",
    BodyName: `Test ${bodyId}`,
    BodyID: bodyId,
    StarSystem: "Test",
    SystemAddress: SYS,
    PlanetClass: "High metal content body",
    AtmosphereType: "CarbonDioxide",
    SurfaceGravity: 3.2,
    SurfaceTemperature: 210,
    Landable: true,
    WasDiscovered: false,
    WasMapped: false,
    WasFootfalled: false,
  }),
  j({
    timestamp: TS,
    event: "FSSBodySignals",
    BodyName: `Test ${bodyId}`,
    BodyID: bodyId,
    SystemAddress: SYS,
    Signals: [{ Type: "$SAA_SignalType_Biological;", Type_Localised: "Biological", Count: 2 }],
  }),
];

const scanOrganic = (bodyId: number) =>
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
    SystemAddress: SYS,
    Body: bodyId,
  });

let st: GameStateStore;
beforeEach(() => {
  st = new GameStateStore();
  st.apply(jump());
});

describe("reading the journal", () => {
  it("counts a body with biology you have not scanned as outstanding", () => {
    for (const line of planetWithBio(3)) st.apply(line);
    const f = commanderSectorFacts(st).get(KEY)!;
    expect(f.visited).toBe(true);
    expect(f.unscannedByYou).toBe(1);
    expect(f.scannedByYou).toBe(0);
  });

  it("moves it to scanned once you have been on foot", () => {
    for (const line of planetWithBio(3)) st.apply(line);
    st.apply(scanOrganic(3));
    const f = commanderSectorFacts(st).get(KEY)!;
    expect(f.scannedByYou).toBe(1);
    expect(f.unscannedByYou).toBe(0);
  });

  it("does not count a body with no biology as unfinished", () => {
    // An ordinary rock is not a chore. Only bodies the game says hold life count.
    st.apply(
      j({
        timestamp: TS,
        event: "Scan",
        ScanType: "Detailed",
        BodyName: "Test 9",
        BodyID: 9,
        StarSystem: "Test",
        SystemAddress: SYS,
        PlanetClass: "Icy body",
        SurfaceGravity: 1,
        SurfaceTemperature: 60,
        Landable: true,
      }),
    );
    const f = commanderSectorFacts(st).get(KEY)!;
    expect(f.unscannedByYou).toBe(0);
  });
});

describe("choosing what the sector says", () => {
  it("says you missed some when one of many is outstanding", () => {
    for (const id of [3, 4, 5]) for (const line of planetWithBio(id)) st.apply(line);
    st.apply(scanOrganic(3));
    st.apply(scanOrganic(4));
    const row = sectorTiers(st, new Map([[KEY, { confirmed: 90, genus: 0, signal: 0 }]])).find(
      (r) => r.key === KEY,
    )!;
    expect(row.facts.scannedByYou).toBe(2);
    expect(row.facts.unscannedByYou).toBe(1);
    expect(row.tier).toBe("missed");
  });

  it("stops shouting about other people's finds in a sector you have worked", () => {
    // The corpus does not know the commander logged it. Without this, a finished sector keeps
    // advertising itself forever.
    for (const line of planetWithBio(3)) st.apply(line);
    st.apply(scanOrganic(3));
    const row = sectorTiers(st, new Map([[KEY, { confirmed: 5, genus: 0, signal: 0 }]])).find(
      (r) => r.key === KEY,
    )!;
    expect(row.tier).toBe("done");
  });

  it("still points at somewhere you have never been", () => {
    const rows = sectorTiers(st, new Map([["99:99:99", { confirmed: 1, genus: 0, signal: 0 }]]));
    const far = rows.find((r) => r.key === "99:99:99")!;
    expect(far.facts.visited).toBe(false);
    expect(far.tier).toBe("confirmed");
  });

  it("keeps a visited but empty sector out of the actionable tiers", () => {
    const row = sectorTiers(st, new Map()).find((r) => r.key === KEY);
    expect(row?.tier).not.toBe("missed");
    expect(row?.tier).not.toBe("confirmed");
  });
});
