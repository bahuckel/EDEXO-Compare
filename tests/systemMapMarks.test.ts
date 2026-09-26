/**
 * What the system map now says beyond the bodies themselves (Discord batch O-E2): where the ship is,
 * the star's belt, and a body's biological signal count — read from the journal, drawn by both the
 * System map window and the System card.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { buildSnapshot, loadSpeciesDatabase } from "../src/server/snapshot.js";
import type { JournalLine, SystemMapNodeDTO } from "../src/shared/types.js";

const SYS = "Flyai Flyuae UO-Z b0";
const ADDR = 911737315337;
const j = (o: Record<string, unknown>) =>
  ({ timestamp: "2026-09-25T21:40:00Z", ...o }) as unknown as JournalLine;

function store(): GameStateStore {
  const s = new GameStateStore();
  s.apply(
    j({
      event: "FSDJump",
      StarSystem: SYS,
      SystemAddress: ADDR,
      StarPos: [17936.1, -1175.8, 37355.9],
      Body: `${SYS} A`,
      BodyID: 1,
      BodyType: "Star",
      Population: 0,
    }),
  );
  s.apply(
    j({
      event: "Scan",
      ScanType: "AutoScan",
      BodyName: `${SYS} A`,
      BodyID: 1,
      Parents: [{ Null: 0 }],
      StarSystem: SYS,
      SystemAddress: ADDR,
      DistanceFromArrivalLS: 0,
      StarType: "M",
      Subclass: 9,
      StellarMass: 0.3,
      WasDiscovered: true,
    }),
  );
  s.apply(
    j({
      event: "Scan",
      ScanType: "Detailed",
      BodyName: `${SYS} A A Belt Cluster 1`,
      BodyID: 4,
      Parents: [{ Ring: 3 }, { Star: 1 }, { Null: 0 }],
      StarSystem: SYS,
      SystemAddress: ADDR,
      DistanceFromArrivalLS: 12,
      WasDiscovered: true,
    }),
  );
  s.apply(
    j({
      event: "Scan",
      ScanType: "Detailed",
      BodyName: `${SYS} A 8`,
      BodyID: 17,
      Parents: [{ Star: 1 }, { Null: 0 }],
      StarSystem: SYS,
      SystemAddress: ADDR,
      PlanetClass: "Icy body",
      AtmosphereType: "Argon",
      Atmosphere: "thin argon atmosphere",
      SurfaceGravity: 0.9,
      SurfaceTemperature: 60,
      SurfacePressure: 300,
      Landable: true,
      DistanceFromArrivalLS: 800,
      WasDiscovered: true,
      WasMapped: false,
      WasFootfalled: false,
    }),
  );
  s.apply(
    j({
      event: "FSSBodySignals",
      BodyName: `${SYS} A 8`,
      BodyID: 17,
      SystemAddress: ADDR,
      Signals: [{ Type: "$SAA_SignalType_Biological;", Count: 1 }],
    }),
  );
  return s;
}

function nodes(tree: SystemMapNodeDTO[]): SystemMapNodeDTO[] {
  return tree.flatMap((n) => [n, ...nodes(n.children)]);
}

describe("system map marks", () => {
  loadSpeciesDatabase();

  it("puts the ship at the arrival body after a jump, then at whatever it drops out at", () => {
    const s = store();
    expect(s.currentBodyKey).toBe(`${ADDR}:1`);
    let all = nodes(buildSnapshot(s, null, "", "127.0.0.1", 0, [], 1).systemMap!.tree);
    expect(all.find((n) => n.youAreHere)?.bodyId).toBe(1);

    s.apply(
      j({
        event: "SupercruiseExit",
        StarSystem: SYS,
        SystemAddress: ADDR,
        Body: `${SYS} A 8`,
        BodyID: 17,
        BodyType: "Planet",
      }),
    );
    all = nodes(buildSnapshot(s, null, "", "127.0.0.1", 0, [], 1).systemMap!.tree);
    expect(all.find((n) => n.youAreHere)?.bodyId).toBe(17);
  });

  it("counts the star's belt clusters and a body's biological signals", () => {
    const all = nodes(buildSnapshot(store(), null, "", "127.0.0.1", 0, [], 1).systemMap!.tree);
    expect(all.find((n) => n.bodyId === 1)?.beltClusters).toBe(1);
    expect(all.find((n) => n.bodyId === 17)?.bioSignals).toBe(1);
  });
});

describe("star cards", () => {
  it("marks a black hole apart from other unscoopable stars", async () => {
    const { buildPrimaryStarsHeader, loadStarRolesConfig } = await import("../src/server/systemMap.js");
    const { getProjectRoot } = await import("../src/server/paths.js");
    const cfg = loadStarRolesConfig(getProjectRoot());
    const rec = (bodyId: number, starType: string, dist: number) =>
      ({
        systemAddress: ADDR,
        bodyId,
        bodyName: `${SYS} ${String.fromCharCode(64 + bodyId)}`,
        starSystem: SYS,
        updatedAt: "2026-09-26T00:00:00Z",
        bodyType: "Star",
        starType,
        distanceFromArrivalLs: dist,
        parents: [{ Null: 0 }],
      }) as never;
    const h = buildPrimaryStarsHeader([rec(1, "H", 0), rec(2, "Y", 100), rec(3, "K", 200)], cfg)!;
    expect(h.stars.map((s) => [s.starRole, s.blackHole ?? false])).toEqual([
      ["useless", true],
      ["useless", false],
      ["fuel", false],
    ]);
  });
});

describe("ringed planets", () => {
  loadSpeciesDatabase();

  it("carries the planet's rings to the map, and never a star's belt", async () => {
    const { planetRingCount } = await import("../src/server/orbitUtils.js");
    expect(planetRingCount([{ Name: "X 2 A Ring" }, { Name: "X 2 B Ring" }])).toBe(2);
    expect(planetRingCount([{ Name: "X A Belt" }])).toBe(0);
    expect(planetRingCount(undefined)).toBeUndefined();

    const s = store();
    s.apply(
      j({
        event: "Scan",
        ScanType: "Detailed",
        BodyName: `${SYS} A 11`,
        BodyID: 30,
        Parents: [{ Star: 1 }, { Null: 0 }],
        StarSystem: SYS,
        SystemAddress: ADDR,
        PlanetClass: "Sudarsky class I gas giant",
        DistanceFromArrivalLS: 2400,
        Rings: [
          { Name: `${SYS} A 11 A Ring`, RingClass: "eRingClass_Icy" },
          { Name: `${SYS} A 11 B Ring`, RingClass: "eRingClass_Rocky" },
        ],
        WasDiscovered: true,
      }),
    );
    const all = nodes(buildSnapshot(s, null, "", "127.0.0.1", 0, [], 1).systemMap!.tree);
    expect(all.find((n) => n.bodyId === 30)?.rings).toBe(2);
    expect(all.find((n) => n.bodyId === 17)?.rings).toBeUndefined();
    expect(all.find((n) => n.bodyId === 1)?.rings).toBeUndefined();
  });
});
