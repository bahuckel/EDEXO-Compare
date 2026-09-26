/**
 * The unsold exploration total, after sales and deaths (Discord, 2026-09-25).
 *
 * The report: after selling, the main window still showed unsold exploration data while the Data
 * Value breakdown said 0. Two estimators counted different rows. Now there is one, the pill is the
 * sum of the breakdown, and what a sale or a death leaves behind is worth nothing:
 *
 *   - a body sold stays sold, even when it is scanned again on the next visit (owner: no);
 *   - a body only a nav beacon described was never sellable;
 *   - dying loses unsold data, but a body lost that way can be scanned and sold again.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import {
  estimateExplorationJournalDataCredits,
  explorationDataValueBreakdown,
} from "../src/server/explorationDataEstimate.js";
import type { JournalLine } from "../src/shared/types.js";

const SYS = 6914570015099;
const SYSNAME = "Eorgh Prou KN-A d14-201";
const j = (o: Record<string, unknown>) => o as unknown as JournalLine;

const star = (ts: string, scanType = "AutoScan") =>
  j({
    timestamp: ts,
    event: "Scan",
    ScanType: scanType,
    BodyName: SYSNAME,
    BodyID: 0,
    StarSystem: SYSNAME,
    SystemAddress: SYS,
    DistanceFromArrivalLS: 0,
    StarType: "K",
    Subclass: 3,
    StellarMass: 0.8,
    WasDiscovered: true,
  });

const planet = (ts: string, scanType = "Detailed", id = 3) =>
  j({
    timestamp: ts,
    event: "Scan",
    ScanType: scanType,
    BodyName: `${SYSNAME} ${id}`,
    BodyID: id,
    StarSystem: SYSNAME,
    SystemAddress: SYS,
    PlanetClass: "High metal content body",
    MassEM: 0.4,
    WasDiscovered: true,
    WasMapped: false,
  });

const sell = (ts: string) =>
  j({
    timestamp: ts,
    event: "SellExplorationData",
    Systems: [SYSNAME],
    Discovered: [],
    BaseValue: 1,
    Bonus: 0,
  });

function both(store: GameStateStore) {
  const b = explorationDataValueBreakdown(store);
  return { pill: estimateExplorationJournalDataCredits(store), ...b };
}

describe("unsold exploration value", () => {
  it("the pill is the sum of the breakdown, stars and signal-less planets included", () => {
    const s = new GameStateStore();
    s.apply(star("2026-09-25T10:00:00Z"));
    s.apply(planet("2026-09-25T10:01:00Z"));
    const v = both(s);
    expect(v.fssScanCount).toBe(2);
    expect(v.fssValueCredits).toBeGreaterThan(0);
    expect(v.pill).toBe(v.fssValueCredits + v.dssValueCredits);
  });

  it("is 0 in both after a sale", () => {
    const s = new GameStateStore();
    s.apply(star("2026-09-25T10:00:00Z"));
    s.apply(planet("2026-09-25T10:01:00Z"));
    s.apply(sell("2026-09-25T11:00:00Z"));
    expect(both(s)).toMatchObject({ pill: 0, fssScanCount: 0, dssScanCount: 0 });
  });

  it("stays 0 when a sold body is scanned again on the next visit", () => {
    const s = new GameStateStore();
    s.apply(star("2026-09-25T10:00:00Z"));
    s.apply(sell("2026-09-25T11:00:00Z"));
    s.apply(star("2026-09-26T09:00:00Z"));
    expect(both(s).pill).toBe(0);
    // The physics is still there for everything that reads it.
    expect(s.explorationScans.has(`${SYS}:0`)).toBe(true);
  });

  it("does not count a body only a nav beacon described, until it is scanned", () => {
    const s = new GameStateStore();
    s.apply(planet("2026-09-25T10:00:00Z", "NavBeaconDetail"));
    expect(both(s).pill).toBe(0);
    s.apply(planet("2026-09-25T10:05:00Z", "Detailed"));
    expect(both(s).pill).toBeGreaterThan(0);
    // A later beacon read does not take it away again.
    s.apply(planet("2026-09-25T10:06:00Z", "NavBeaconDetail"));
    expect(both(s).pill).toBeGreaterThan(0);
  });

  it("is 0 after dying, and a body lost that way counts again once re-scanned", () => {
    const s = new GameStateStore();
    s.apply(planet("2026-09-25T10:00:00Z"));
    s.apply(j({ timestamp: "2026-09-25T10:30:00Z", event: "Died" }));
    expect(both(s).pill).toBe(0);
    s.apply(planet("2026-09-25T12:00:00Z"));
    expect(both(s).pill).toBeGreaterThan(0);
  });

  it("keeps the sold marks through the merge cache", () => {
    const s = new GameStateStore();
    s.apply(star("2026-09-25T10:00:00Z"));
    s.apply(sell("2026-09-25T11:00:00Z"));
    const t = new GameStateStore();
    t.hydrateJournalMergePayload(JSON.parse(JSON.stringify(s.serializeJournalMergePayload())));
    t.apply(star("2026-09-26T09:00:00Z"));
    expect(both(t).pill).toBe(0);
  });
});
