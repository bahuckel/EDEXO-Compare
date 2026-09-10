/**
 * The merge cache must not silently restore a stale shape.
 *
 * `mainStarWasDiscoveredBySystem` was added to the cache payload without bumping
 * JOURNAL_MERGE_CACHE_FORMAT. Every field on the payload is optional on decode, so nothing failed:
 * caches written before the field existed kept hitting, restored a store that never had it, and the
 * FIRST chip could not light for anyone holding one. Two fixes shipped invisible for a day.
 *
 * The failure had no symptom — a badge that does not render looks exactly like a badge with nothing
 * to say. So these tests assert the two things that would have spoken up.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore, JOURNAL_MERGE_CACHE_FORMAT } from "../src/server/gameState.js";
import type { JournalLine } from "../src/shared/types.js";

const TS = "2026-05-01T00:00:00Z";

function starScan(systemAddress: number, wasDiscovered: boolean): JournalLine {
  return {
    event: "Scan",
    ScanType: "AutoScan",
    timestamp: TS,
    StarSystem: "Test Sector AB-C d1-2",
    SystemAddress: systemAddress,
    BodyName: "Test Sector AB-C d1-2 A",
    BodyID: 0,
    StarType: "K",
    WasDiscovered: wasDiscovered,
    WasMapped: false,
  } as unknown as JournalLine;
}

describe("payload round-trip", () => {
  it("carries first-discovery flags through the cache", () => {
    // The regression itself: serialize a store that knows about a discovery, hydrate a fresh one,
    // and require the knowledge to survive. Before the fix this restored an empty map.
    const a = new GameStateStore();
    a.mergeExplorationScan(starScan(111, false), TS);
    a.mergeExplorationScan(starScan(222, true), TS);

    const b = new GameStateStore();
    expect(b.hydrateJournalMergePayload(a.serializeJournalMergePayload())).toBe(true);

    expect(b.mainStarWasDiscoveredBySystem.get(111)).toBe(false);
    expect(b.mainStarWasDiscoveredBySystem.get(222)).toBe(true);
  });

  it("stamps the payload with the current format", () => {
    expect(new GameStateStore().serializeJournalMergePayload().format).toBe(
      JOURNAL_MERGE_CACHE_FORMAT,
    );
  });
});

describe("the format constant", () => {
  it("only ever goes up, so an old cache can never be re-admitted", () => {
    // 3 retired caches written before `mainStarWasDiscoveredBySystem`; 4 before `systemPositions`;
    // 5 retired caches whose *derivation* was wrong even though the shape was right — footfall read
    // from Detailed scans only. Lowering it lets back in a cache the app would misread.
    expect(JOURNAL_MERGE_CACHE_FORMAT).toBeGreaterThanOrEqual(5);
  });

  it("covers every key the store serializes", () => {
    // The real guard. Adding a field to the payload changes this list; the snapshot then fails and
    // the next person has to decide, deliberately, whether the cache shape moved. That decision not
    // being forced is the whole bug.
    const keys = Object.keys(new GameStateStore().serializeJournalMergePayload()).sort();
    expect({ format: JOURNAL_MERGE_CACHE_FORMAT, keys }).toMatchSnapshot();
  });
});
