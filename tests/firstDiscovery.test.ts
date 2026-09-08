/**
 * The FIRST chip — first discovery of a system.
 *
 * This exists because the feature shipped broken and silent. It read `WasDiscovered` from `FSDJump`
 * and `CarrierJump`, which never carry that field: across this commander's 244 journals it appears on
 * **0 of 6,549** such events. The map was permanently empty, the chip never once rendered, and
 * nothing anywhere reported a problem — the failure of a badge is that you do not see it.
 *
 * So the first test is the one that would have caught it: feed the events the game actually writes
 * and assert the chip can light at all.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import type { JournalLine } from "../src/shared/types.js";

const SYS = 1234567890;
const TS = "2026-05-01T00:00:00Z";

function store(): GameStateStore {
  return new GameStateStore();
}

/** A main-star scan as the journal writes it. */
function starScan(systemAddress: number, wasDiscovered: boolean, bodyId = 0): JournalLine {
  return {
    event: "Scan",
    ScanType: "AutoScan",
    timestamp: TS,
    StarSystem: "Test Sector AB-C d1-2",
    SystemAddress: systemAddress,
    BodyName: "Test Sector AB-C d1-2 A",
    BodyID: bodyId,
    StarType: "K",
    WasDiscovered: wasDiscovered,
    WasMapped: false,
  } as unknown as JournalLine;
}

describe("the event that actually carries WasDiscovered", () => {
  let st: GameStateStore;
  beforeEach(() => {
    st = store();
  });

  it("records an undiscovered main star", () => {
    st.mergeExplorationScan(starScan(SYS, false), TS);
    expect(st.mainStarWasDiscoveredBySystem.get(SYS)).toBe(false);
  });

  it("records a main star somebody else found first", () => {
    st.mergeExplorationScan(starScan(SYS, true), TS);
    expect(st.mainStarWasDiscoveredBySystem.get(SYS)).toBe(true);
  });

  it("is not fooled by a jump event, which never carries the field", () => {
    // The original bug, pinned: if this ever starts passing by way of FSDJump, the game changed.
    st.apply({
      event: "FSDJump",
      timestamp: TS,
      StarSystem: "Test",
      SystemAddress: SYS,
      // Included deliberately, even though the real game never writes it here: the point is that
      // this path must not read it even if something upstream invents it.
      WasDiscovered: false,
    } as unknown as JournalLine);
    expect(st.mainStarWasDiscoveredBySystem.has(SYS)).toBe(false);
  });
});

describe("what counts as the system", () => {
  it("ignores bodies that are not the main star", () => {
    // 672 of this commander's 1,159 first-scanned systems had a primary somebody else had found.
    // Counting any undiscovered body as a system discovery would inflate the chip nearly threefold.
    const st = store();
    st.mergeExplorationScan(starScan(SYS, false, 7), TS);
    expect(st.mainStarWasDiscoveredBySystem.has(SYS)).toBe(false);
  });

  it("keeps the first answer when the same star is scanned again", () => {
    // A later visit reports the system as discovered — by this commander. Overwriting would erase
    // the discovery on the second look at your own find.
    const st = store();
    st.mergeExplorationScan(starScan(SYS, false), TS);
    st.mergeExplorationScan(starScan(SYS, true), "2026-06-01T00:00:00Z");
    expect(st.mainStarWasDiscoveredBySystem.get(SYS)).toBe(false);
  });

  it("says nothing about a system whose star has not been scanned", () => {
    // 1,417 of 2,847 visited systems have no BodyID 0 scan. Absent must not read as "already found".
    const st = store();
    expect(st.mainStarWasDiscoveredBySystem.has(SYS)).toBe(false);
    expect(st.mainStarWasDiscoveredBySystem.get(SYS)).toBeUndefined();
  });
});
