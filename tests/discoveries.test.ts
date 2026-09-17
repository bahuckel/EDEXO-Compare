/**
 * "My discoveries": every system, body and star the journals hold, not only the foot-confirmed ones.
 *
 * The panel used to show 373 species confirmed on the ground — the certain end of a record that also
 * contains 3,406 systems, 18,127 bodies and 5,196 stars with their physics already merged, none of
 * which was reachable from the app.
 *
 * Two things in here are easy to get wrong and are pinned because of it:
 *
 * - **A sold system keeps its bodies.** Selling cartographic data clears `explorationScans`, because
 *   everything the app says about payouts has to go with it. `soldExplorationScans` keeps the
 *   physics for exactly this reason, so history does not vanish when the commander cashes in.
 * - **Estimated and sold are different claims.** One is this app's model, the other is what the game
 *   actually paid. They are never summed into a single number and never silently swapped, because a
 *   column that switches between a measurement and a guess is a column nobody can reason about.
 */
import { describe, expect, it } from "vitest";
import { buildDiscoveries } from "../src/server/discoveries.js";
import { GameStateStore } from "../src/server/gameState.js";
import { getProjectRoot } from "../src/server/paths.js";
import type { ExplorationScanRecord } from "../src/shared/types.js";

const root = getProjectRoot();

function star(over: Partial<ExplorationScanRecord> = {}): ExplorationScanRecord {
  return {
    systemAddress: 1,
    bodyId: 0,
    bodyName: "Probe A",
    starSystem: "Probe",
    updatedAt: "2026-09-01T00:00:00Z",
    starType: "K",
    stellarMass: 0.8,
    radius: 500_000_000,
    surfaceTemperature: 4200,
    ...over,
  } as ExplorationScanRecord;
}

function planet(over: Partial<ExplorationScanRecord> = {}): ExplorationScanRecord {
  return {
    systemAddress: 1,
    bodyId: 1,
    bodyName: "Probe 1",
    starSystem: "Probe",
    updatedAt: "2026-09-02T00:00:00Z",
    planetClass: "High metal content body",
    landable: true,
    surfaceGravity: 3.5,
    surfaceTemperature: 240,
    massEM: 0.4,
    radius: 4_000_000,
    ...over,
  } as ExplorationScanRecord;
}

function storeWith(rows: [string, ExplorationScanRecord][], sold: [string, ExplorationScanRecord][] = []) {
  const store = new GameStateStore();
  for (const [k, r] of rows) store.explorationScans.set(k, r);
  for (const [k, r] of sold) store.soldExplorationScans.set(k, r);
  store.visitedSystems.set(1, "Probe");
  return store;
}

describe("the discoveries tables", () => {
  it("splits stars from bodies and counts both onto the system", () => {
    const d = buildDiscoveries(storeWith([["1:0", star()], ["1:1", planet()]]), root);
    expect(d.stars).toHaveLength(1);
    expect(d.bodies).toHaveLength(1);
    const sys = d.systems.find((s) => s.systemAddress === 1)!;
    expect(sys.stars).toBe(1);
    expect(sys.bodies).toBe(1);
    expect(sys.landables).toBe(1);
    expect(sys.primaryStarType).toBe("K");
  });

  it("lists a system he visited and never scanned", () => {
    /*
      Absence is an answer. "Where have I been and not looked" is one of the questions this table
      exists to answer, so a system with no scan rows still gets a row of zeroes.
    */
    const d = buildDiscoveries(storeWith([]), root);
    const sys = d.systems.find((s) => s.systemAddress === 1);
    expect(sys, "a visited system must appear").toBeTruthy();
    expect(sys!.bodies).toBe(0);
    expect(sys!.stars).toBe(0);
  });

  it("keeps the bodies of a system whose data has been sold", () => {
    // The physics map, not the value map. This is the row that would silently disappear from a
    // commander's history the moment he cashed in — and he sells almost everything.
    const d = buildDiscoveries(storeWith([], [["1:1", planet()]]), root);
    expect(d.bodies).toHaveLength(1);
    expect(d.bodies[0]!.bodyName).toBe("Probe 1");
  });

  it("reports gravity in g and radius against the Earth, never in kilometres", () => {
    /*
      The journal writes m/s² and metres, which is a table nobody can read. Kilometres carry a second
      problem the commander named: Elite has a km/miles setting, so a column in kilometres is one he
      has to convert in his head depending on how his game is configured. A ratio has no setting.
    */
    const d = buildDiscoveries(storeWith([["1:1", planet()]]), root);
    const b = d.bodies[0]!;
    expect(b.gravityG).toBeCloseTo(3.5 / 9.80665, 4);
    expect(b.radiusEarth).toBeCloseTo(4_000_000 / 6_371_000, 5);
  });

  it("reports a star's radius against the Sun, as the game does", () => {
    const d = buildDiscoveries(storeWith([["1:0", star()]]), root);
    expect(d.stars[0]!.radiusSolar).toBeCloseTo(500_000_000 / 695_700_000, 5);
  });

  it("reports sold credits separately from the estimate, and only where a sale happened", () => {
    const store = storeWith([["1:0", star()], ["1:1", planet()]]);
    let d = buildDiscoveries(store, root);
    let sys = d.systems.find((s) => s.systemAddress === 1)!;
    expect(sys.estimatedCredits).toBeGreaterThan(0);
    expect(sys.soldExplorationCredits, "nothing sold yet").toBeNull();
    expect(sys.soldExobiologyCredits).toBeNull();

    store.soldExplorationBySystem.set(1, { credits: 1_234_567, items: 2, sales: 1, lastAt: "" });
    store.soldOrganicBySystem.set(1, { credits: 19_010_800, items: 3, sales: 1, lastAt: "" });
    d = buildDiscoveries(store, root);
    sys = d.systems.find((s) => s.systemAddress === 1)!;
    expect(sys.soldExplorationCredits).toBe(1_234_567);
    expect(sys.soldExobiologyCredits).toBe(19_010_800);
    // The estimate is untouched by the sale: it answers a different question and the panel shows both.
    expect(sys.estimatedCredits).toBeGreaterThan(0);
  });

  it("names Earth-likes the way a commander would search for them", () => {
    const d = buildDiscoveries(storeWith([["1:1", planet({ planetClass: "Earthlike body" })]]), root);
    expect(d.bodies[0]!.planetClass).toBe("Earth-like world");
  });

  it("counts the world types a system is worth flying to", () => {
    const d = buildDiscoveries(
      storeWith([
        ["1:1", planet({ bodyId: 1, planetClass: "Earthlike body" })],
        ["1:2", planet({ bodyId: 2, bodyName: "Probe 2", planetClass: "Water world" })],
        ["1:3", planet({ bodyId: 3, bodyName: "Probe 3", planetClass: "Ammonia world" })],
        ["1:4", planet({ bodyId: 4, bodyName: "Probe 4", terraformState: "Terraformable" })],
      ]),
      root,
    );
    const sys = d.systems.find((s) => s.systemAddress === 1)!;
    expect(sys.earthLikes).toBe(1);
    expect(sys.waterWorlds).toBe(1);
    expect(sys.ammoniaWorlds).toBe(1);
    expect(sys.terraformables).toBe(1);
  });

  it("treats an unstated landable flag as unknown, not as no", () => {
    // Tri-state on purpose: a gas giant that never carried the flag is not a body he was refused.
    const d = buildDiscoveries(
      storeWith([["1:1", planet({ landable: undefined, planetClass: "Sudarsky class I gas giant" })]]),
      root,
    );
    expect(d.bodies[0]!.landable).toBeNull();
    expect(d.systems.find((s) => s.systemAddress === 1)!.landables).toBe(0);
  });

  it("marks a first discovery from the journal's own flag", () => {
    /*
      `wasDiscovered === false` is the game saying nobody had been here. Undefined is not the same
      claim — an older scan row simply never said — so only an explicit false counts.
    */
    const d = buildDiscoveries(
      storeWith([
        ["1:1", planet({ wasDiscovered: false })],
        ["1:2", planet({ bodyId: 2, bodyName: "Probe 2", wasDiscovered: undefined })],
      ]),
      root,
    );
    expect(d.bodies.find((b) => b.bodyName === "Probe 1")!.firstDiscoverer).toBe(true);
    expect(d.bodies.find((b) => b.bodyName === "Probe 2")!.firstDiscoverer).toBe(false);
    expect(d.systems.find((s) => s.systemAddress === 1)!.firstDiscoveries).toBe(1);
  });
});
