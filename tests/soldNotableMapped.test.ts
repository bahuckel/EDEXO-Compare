/**
 * A sold notable body keeps its "mapped" dot (2026-09-30).
 *
 * Selling clears the live mapping state (the unsold value must drop to 0), and the Notable card read
 * that same state, so every mapped Earth-like he had sold showed as unmapped: "0 / 5 mapped" on the
 * overlay for Prua Phoe YA-D c15, which he had mapped. The mapping now moves to an archive set that
 * only the sold rows read. Data lost on death is listed too, but it was not sold, so not marked so.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { notableBodiesForSystem } from "../src/server/snapshotSystemInfo.js";
import { estimateExplorationJournalDataCredits } from "../src/server/explorationDataEstimate.js";
import type { JournalLine } from "../src/shared/types.js";

const SYS = 4196484520706;
const SYSNAME = "Prua Phoe YA-D c15";
const j = (o: Record<string, unknown>) => o as unknown as JournalLine;

const world = (ts: string, id: number) =>
  j({
    timestamp: ts,
    event: "Scan",
    ScanType: "Detailed",
    BodyName: `${SYSNAME} A ${id}`,
    BodyID: id,
    StarSystem: SYSNAME,
    SystemAddress: SYS,
    PlanetClass: "Water world",
    MassEM: 0.6,
    WasDiscovered: true,
    WasMapped: false,
  });

const mapped = (ts: string, id: number) =>
  j({
    timestamp: ts,
    event: "SAAScanComplete",
    BodyName: `${SYSNAME} A ${id}`,
    BodyID: id,
    SystemAddress: SYS,
    ProbesUsed: 5,
    EfficiencyTarget: 7,
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

function flown(): GameStateStore {
  const s = new GameStateStore();
  s.apply(world("2026-05-10T10:00:00Z", 3));
  s.apply(world("2026-05-10T10:01:00Z", 4));
  s.apply(mapped("2026-05-10T10:05:00Z", 3));
  return s;
}

const card = (s: GameStateStore) =>
  Object.fromEntries(
    notableBodiesForSystem(s, SYS, SYSNAME).map((n) => [n.bodyId, { mapped: n.dssMapped, sold: !!n.sold }]),
  );

describe("sold notable bodies", () => {
  it("keep the mapping they had, marked sold", () => {
    const s = flown();
    s.apply(sell("2026-05-15T15:18:30Z"));
    expect(card(s)).toEqual({ 3: { mapped: true, sold: true }, 4: { mapped: false, sold: true } });
    // The value side is unchanged: nothing left to sell.
    expect(estimateExplorationJournalDataCredits(s)).toBe(0);
    expect(s.dssMappedBodyKeys.size).toBe(0);
  });

  it("are not called sold when the data was lost on death", () => {
    const s = flown();
    s.apply(j({ timestamp: "2026-05-15T15:00:00Z", event: "Died" }));
    expect(card(s)).toEqual({ 3: { mapped: true, sold: false }, 4: { mapped: false, sold: false } });
  });

  it("a live re-scan after the sale reads the live mapping, not the archive", () => {
    const s = flown();
    s.apply(sell("2026-05-15T15:18:30Z"));
    s.apply(world("2026-06-01T10:00:00Z", 3));
    expect(card(s)[3]).toEqual({ mapped: false, sold: false });
  });

  it("survives the merge cache", () => {
    const s = flown();
    s.apply(sell("2026-05-15T15:18:30Z"));
    const back = new GameStateStore();
    back.hydrateJournalMergePayload(JSON.parse(JSON.stringify(s.serializeJournalMergePayload())));
    expect(card(back)[3]).toEqual({ mapped: true, sold: true });
  });
});
