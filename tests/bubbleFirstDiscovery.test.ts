/**
 * Flying through the Bubble listed planets as the commander's own first discoveries (Discord,
 * 2026-09-25). Bubble scans say `WasDiscovered: false` surprisingly often — 145 of 487 planet scans in
 * the owner's journals, and the arrival stars of Barnard's Star, Alpha Centauri, Ross 775 and Procyon
 * — but nobody discovers a system Frontier populated. On that list the flag no longer makes a first
 * discovery, and the first-discoverer bonus leaves the value estimates there too.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDiscoveries } from "../src/server/discoveries.js";
import { setDeveloperPopulatedSystemsForTests } from "../src/server/developerPopulatedSystems.js";
import { estimateExplorationJournalDataCredits } from "../src/server/explorationDataEstimate.js";
import { GameStateStore } from "../src/server/gameState.js";
import { getProjectRoot } from "../src/server/paths.js";
import type { JournalLine } from "../src/shared/types.js";

const BUBBLE = 1733119984354;
const j = (o: Record<string, unknown>) => o as unknown as JournalLine;

function visit(store: GameStateStore, addr: number) {
  const name = `Sys ${addr}`;
  store.apply(
    j({
      timestamp: "2026-09-25T10:00:00Z",
      event: "Scan",
      ScanType: "AutoScan",
      BodyName: name,
      BodyID: 0,
      StarSystem: name,
      SystemAddress: addr,
      DistanceFromArrivalLS: 0,
      StarType: "K",
      StellarMass: 0.8,
      WasDiscovered: false,
    }),
  );
  store.apply(
    j({
      timestamp: "2026-09-25T10:01:00Z",
      event: "Scan",
      ScanType: "Detailed",
      BodyName: `${name} 1`,
      BodyID: 1,
      StarSystem: name,
      SystemAddress: addr,
      PlanetClass: "High metal content body",
      MassEM: 0.4,
      WasDiscovered: false,
      WasMapped: false,
    }),
  );
}

beforeEach(() => setDeveloperPopulatedSystemsForTests([BUBBLE]));
afterEach(() => setDeveloperPopulatedSystemsForTests(null));

describe("first discoveries in the Bubble", () => {
  it("a Bubble system and its bodies are not the commander's discoveries", () => {
    const s = new GameStateStore();
    visit(s, BUBBLE);
    const d = buildDiscoveries(s, getProjectRoot());
    const sys = d.systems.find((r) => r.systemAddress === BUBBLE)!;
    expect(sys.firstDiscoveredSystem).toBe(false);
    expect(sys.firstDiscoveries).toBe(0);
    expect(d.bodies.every((b) => b.systemAddress !== BUBBLE || !b.firstDiscoverer)).toBe(true);
    expect(s.commanderDiscoveredSystem(BUBBLE)).toBe(false);
  });

  it("the same scans outside the Bubble are still first discoveries", () => {
    const s = new GameStateStore();
    visit(s, 42);
    const d = buildDiscoveries(s, getProjectRoot());
    expect(d.systems.find((r) => r.systemAddress === 42)!.firstDiscoveredSystem).toBe(true);
    expect(s.commanderDiscoveredSystem(42)).toBe(true);
  });

  it("values a Bubble body lower than the same body discovered first", () => {
    const bubble = new GameStateStore();
    visit(bubble, BUBBLE);
    const fresh = new GameStateStore();
    visit(fresh, 42);
    expect(estimateExplorationJournalDataCredits(bubble)).toBeLessThan(
      estimateExplorationJournalDataCredits(fresh),
    );
  });
});
