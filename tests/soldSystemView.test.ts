/**
 * Selling exploration data must not take the system view with it.
 *
 * Reported by the owner 2026-09-07: *"see what happened to the in-app system view, we had it before,
 * not anymore"*. The store files sold rows under `soldExplorationScans`, and both
 * `buildSystemMapSnapshot` and the primary-star header read only `explorationScans` — so cashing in
 * at a station deleted the orbital view of the commander's own home system, and the map button
 * disappeared along with the star header it hangs off.
 *
 * Reproduced from the owner's logs: replaying up to 2026-05-15 leaves 42 records for
 * Swoilz KI-E b4-9 and a working map. Adding the next file, which carries a
 * `MultiSellExplorationData` for 38 of its bodies, leaves zero.
 *
 * `systemExplorationScanIndex` had already made this call for host-star resolution — *"selling the
 * data does not move the star"* — and it is just as true of the map.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { explorationRecordsForSystem } from "../src/server/systemMap.js";
import type { ExplorationScanRecord } from "../src/shared/types.js";

const ADDR = 20464042518049;

function rec(bodyId: number, o: Partial<ExplorationScanRecord> = {}): ExplorationScanRecord {
  return {
    systemAddress: ADDR,
    bodyId,
    bodyName: `Swoilz KI-E b4-9 ${bodyId}`,
    starSystem: "Swoilz KI-E b4-9",
    updatedAt: "2026-05-15T00:00:00Z",
    ...o,
  } as ExplorationScanRecord;
}

describe("records for a system", () => {
  it("returns sold rows when the live map has none", () => {
    const store = new GameStateStore();
    store.soldExplorationScans.set(`${ADDR}:0`, rec(0, { starType: "M" }));
    store.soldExplorationScans.set(`${ADDR}:9`, rec(9));
    expect(explorationRecordsForSystem(store, ADDR).map((r) => r.bodyId).sort()).toEqual([0, 9]);
  });

  it("prefers the live row when a body appears in both", () => {
    const store = new GameStateStore();
    store.soldExplorationScans.set(`${ADDR}:0`, rec(0, { starType: "M", luminosity: "stale" }));
    store.explorationScans.set(`${ADDR}:0`, rec(0, { starType: "M", luminosity: "Va" }));
    const out = explorationRecordsForSystem(store, ADDR);
    expect(out).toHaveLength(1);
    expect(out[0]!.luminosity).toBe("Va");
  });

  it("does not leak another system's rows", () => {
    const store = new GameStateStore();
    store.soldExplorationScans.set(`${ADDR}:0`, rec(0, { starType: "M" }));
    store.soldExplorationScans.set(`999:0`, { ...rec(0), systemAddress: 999 });
    expect(explorationRecordsForSystem(store, ADDR)).toHaveLength(1);
  });

  /**
   * EDSM is the last resort, not a peer: it fills in only when we hold nothing of our own, sold
   * included. Hydrated rows carry no `WasMapped` history and should never displace a real scan.
   */
  it("falls back to EDSM only when we hold nothing of our own", () => {
    const store = new GameStateStore();
    store.edsmExplorationByKey.set(`${ADDR}:0`, rec(0, { starType: "M", edsmHydrated: true }));
    expect(explorationRecordsForSystem(store, ADDR)[0]?.edsmHydrated).toBe(true);

    store.soldExplorationScans.set(`${ADDR}:0`, rec(0, { starType: "M" }));
    expect(explorationRecordsForSystem(store, ADDR)[0]?.edsmHydrated).toBeUndefined();
  });

  it("returns nothing for a system we have never seen", () => {
    expect(explorationRecordsForSystem(new GameStateStore(), 12345)).toEqual([]);
  });
});
