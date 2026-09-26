/**
 * A logged variant is about the moon it was logged on (owner, 2026-09-26).
 *
 * `propagateExoAmongSimilarMoons` copied `confirmedVariants` to sibling moons along with the genus
 * hints, so one Osseus discus logged Red on a 76 Leonis 6 moon showed as "logged Red" on moons a, d,
 * f and g: it overrode their own material prediction and went in the outliers file as a colour miss
 * on four moons nobody had set foot on. All 19 colour "misses" in the owner's journals were these.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync, rmSync, existsSync } from "node:fs";
import type { JournalLine } from "../src/shared/types.js";

const SYS = 458177514787;
const T = "2026-09-14T02:00:00Z";

function moonScan(bodyId: number, name: string, materials: { Name: string; Percent: number }[]): JournalLine {
  return {
    timestamp: T,
    event: "Scan",
    ScanType: "Detailed",
    BodyName: name,
    BodyID: bodyId,
    Parents: [{ Planet: 16 }, { Star: 0 }],
    StarSystem: "Plio Aip NM-U d3-13",
    SystemAddress: SYS,
    PlanetClass: "Icy body",
    Atmosphere: "thin neon atmosphere",
    AtmosphereType: "Neon",
    AtmosphereComposition: [{ Name: "Neon", Percent: 100 }],
    Landable: true,
    SurfaceTemperature: 50,
    SurfaceGravity: 1.2,
    SurfacePressure: 300,
    Radius: 724824.375,
    MassEM: 0.001094,
    Composition: { Ice: 0.7, Rock: 0.2, Metal: 0.1 },
    Materials: materials,
  } as unknown as JournalLine;
}

const logAcies = (bodyId: number, material: string, colour: string): JournalLine =>
  ({
    timestamp: "2026-09-14T02:10:00Z",
    event: "ScanOrganic",
    ScanType: "Log",
    Genus: "$Codex_Ent_Bacterial_Genus_Name;",
    Genus_Localised: "Bacterium",
    Species: "$Codex_Ent_Bacterial_04_Name;",
    Species_Localised: "Bacterium Acies",
    Variant: `$Codex_Ent_Bacterial_04_${material}_Name;`,
    Variant_Localised: `Bacterium Acies - ${colour}`,
    SystemAddress: SYS,
    Body: bodyId,
  }) as unknown as JournalLine;

const jump = {
  timestamp: T,
  event: "FSDJump",
  StarSystem: "Plio Aip NM-U d3-13",
  SystemAddress: SYS,
  StarPos: [4824.875, 674.71875, 9529.875],
} as unknown as JournalLine;

let store: InstanceType<Awaited<typeof import("../src/server/gameState.js")>["GameStateStore"]>;

beforeEach(async () => {
  const { GameStateStore } = await import("../src/server/gameState.js");
  store = new GameStateStore();
  store.apply(jump);
  store.apply(moonScan(18, "Plio Aip NM-U d3-13 4 b", [{ Name: "ruthenium", Percent: 1 }]));
  store.apply(moonScan(20, "Plio Aip NM-U d3-13 4 c", [{ Name: "antimony", Percent: 1 }]));
});

describe("logged variants stay on their moon", () => {
  it("a Log on one moon gives its sibling no logged colour", () => {
    store.apply(logAcies(18, "Ruthenium", "Cobalt"));
    expect(store.bodies.get(`${SYS}:18`)?.confirmedVariants).toEqual(["Bacterium Acies - Cobalt"]);
    // The propagation did run — the sibling got the hint — it just carried no colour with it.
    expect(store.bodies.get(`${SYS}:20`)?.organicGenusLocks.some((l) => l.fromSibling)).toBe(true);
    expect(store.bodies.get(`${SYS}:20`)?.confirmedVariants ?? []).toEqual([]);
  });
});

describe("colour sweep over the journals", () => {
  it("records a logged colour the app did not predict, once", async () => {
    const snap = await import("../src/server/snapshot.js");
    const { resolveExoOutlierLogPath } = await import("../src/server/paths.js");
    const { resetExoOutlierLogCacheForTests } = await import("../src/server/exoOutlierLog.js");
    rmSync(resolveExoOutlierLogPath(), { force: true });
    resetExoOutlierLogCacheForTests();
    snap.resetColourSweepForTests();
    // 4 c carries antimony (Cyan), but the game says Cobalt: a miss. 4 b's Cobalt matches its ruthenium.
    store.apply(logAcies(18, "Ruthenium", "Cobalt"));
    store.apply(logAcies(20, "Ruthenium", "Cobalt"));
    const db = snap.loadSpeciesDatabase();
    expect(snap.sweepColourOutliers(store, db)).toBe(1);
    expect(snap.sweepColourOutliers(store, db)).toBe(0);
    expect(existsSync(resolveExoOutlierLogPath())).toBe(true);
    const rec = JSON.parse(readFileSync(resolveExoOutlierLogPath(), "utf8").trim());
    expect(rec).toMatchObject({
      severity: "colour",
      bodyName: "Plio Aip NM-U d3-13 4 c",
      predictedColour: "Cyan",
      loggedColour: "Cobalt",
    });
  });
});
