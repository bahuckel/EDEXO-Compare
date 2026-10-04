/** Data value's "Selling at a fleet carrier (−25 %)" (owner, 2026-10-03): off by default, exploration x0.75. */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { buildSnapshot, loadSpeciesDatabase } from "../src/server/snapshot.js";
import type { ExplorationScanRecord } from "../src/shared/types.js";

describe("selling at a fleet carrier", () => {
  it("is off by default and takes 25 % off the unsold exploration value when on", () => {
    loadSpeciesDatabase();
    const store = new GameStateStore();
    store.explorationScans.set("1:3", {
      systemAddress: 1,
      bodyId: 3,
      bodyName: "Probe 3",
      starSystem: "Probe",
      updatedAt: "2026-10-03T00:00:00Z",
      planetClass: "Water world",
      massEM: 1,
    } as ExplorationScanRecord);
    expect(store.sellAtFleetCarrier).toBe(false);
    const full = buildSnapshot(store, null, "", "127.0.0.1", 0, [], 1);
    expect(full.explorationScanDataValueCredits).toBeGreaterThan(100_000);
    store.setSellAtFleetCarrier(true);
    const at = buildSnapshot(store, null, "", "127.0.0.1", 0, [], 1);
    expect(at.sellAtFleetCarrier).toBe(true);
    expect(at.explorationScanDataValueCredits).toBe(Math.round(full.explorationScanDataValueCredits! * 0.75));
  });
});

describe("at the commander's own carrier (owner, 2026-10-04)", () => {
  it("takes 15 %: 10 of the 25 % go into the carrier's bank, which he can take back", () => {
    loadSpeciesDatabase();
    const store = new GameStateStore();
    store.explorationScans.set("1:3", {
      systemAddress: 1,
      bodyId: 3,
      bodyName: "Probe 3",
      starSystem: "Probe",
      updatedAt: "2026-10-03T00:00:00Z",
      planetClass: "Water world",
      massEM: 1,
    } as ExplorationScanRecord);
    const full = buildSnapshot(store, null, "", "127.0.0.1", 0, [], 1).explorationScanDataValueCredits!;
    // On its own it changes nothing: it only says whose carrier the sale is at.
    store.setFleetCarrierIsOwn(true);
    expect(buildSnapshot(store, null, "", "127.0.0.1", 0, [], 1).explorationScanDataValueCredits).toBe(full);
    store.setSellAtFleetCarrier(true);
    const own = buildSnapshot(store, null, "", "127.0.0.1", 0, [], 1);
    expect(own.fleetCarrierIsOwn).toBe(true);
    expect(own.explorationScanDataValueCredits).toBe(Math.round(full * 0.85));
  });
});
