import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import type { JournalLine } from "../src/shared/types.js";

const T0 = Date.parse("2026-09-13T10:00:00Z");
const iso = (offsetS: number) => new Date(T0 + offsetS * 1000).toISOString();

function line(event: string, offsetS: number, extra: Record<string, unknown>): JournalLine {
  return { timestamp: iso(offsetS), event, ...extra } as unknown as JournalLine;
}

/** Arrive somewhere first, so the store has a current system. */
function arrivedAt(st: GameStateStore, name: string, addr: number, offsetS = 0): void {
  st.apply(line("FSDJump", offsetS, { StarSystem: name, SystemAddress: addr, StarPos: [0, 0, 0] }));
}

/**
 * The next-jump card's ladder: a jump in progress, then the arrival held for a minute, then the
 * nav-panel target, then the route's next hop — so the star class is on screen before the countdown.
 */
describe("nextJumpTarget", () => {
  it("names the route's next hop as soon as the route says so", () => {
    const st = new GameStateStore();
    arrivedAt(st, "A", 1);
    st.applyLiveNavRoute([
      { systemAddress: 1, starSystem: "A", starPos: [0, 0, 0], starClass: "G" },
      { systemAddress: 2, starSystem: "B", starPos: [10, 0, 0], starClass: "M" },
      { systemAddress: 3, starSystem: "C", starPos: [20, 0, 0], starClass: "K" },
    ]);
    const jt = st.nextJumpTarget();
    expect(jt).toMatchObject({ starSystem: "B", starClass: "M", source: "route", arrived: false });
  });

  it("prefers the nav-panel lock over the route hop", () => {
    const st = new GameStateStore();
    arrivedAt(st, "A", 1);
    st.applyLiveNavRoute([
      { systemAddress: 1, starSystem: "A", starPos: [0, 0, 0] },
      { systemAddress: 2, starSystem: "B", starPos: [10, 0, 0], starClass: "M" },
    ]);
    st.apply(line("FSDTarget", 5, { Name: "Blo Eurl YM-J b42-0", SystemAddress: 9, StarClass: "F" }));
    expect(st.nextJumpTarget()).toMatchObject({ starSystem: "Blo Eurl YM-J b42-0", starClass: "F", source: "target" });
  });

  it("shows the jump in progress, then the next lock the moment the jump ends", () => {
    const st = new GameStateStore();
    arrivedAt(st, "A", 1);
    st.apply(line("FSDTarget", 5, { Name: "B", SystemAddress: 2, StarClass: "M" }));
    st.apply(line("StartJump", 10, { JumpType: "Hyperspace", StarSystem: "B", SystemAddress: 2, StarClass: "M" }));
    expect(st.nextJumpTarget()).toMatchObject({ starSystem: "B", source: "jump", arrived: false });

    arrivedAt(st, "B", 2, 30);
    // nothing plotted yet: the arrival
    expect(st.nextJumpTarget()).toMatchObject({ starSystem: "B", source: "jump", arrived: true });
    st.apply(line("FSDTarget", 31, { Name: "C", SystemAddress: 3, StarClass: "K" }));
    // the next lock, at once
    expect(st.nextJumpTarget()).toMatchObject({ starSystem: "C", starClass: "K", source: "target" });
  });

  it("drops a spent lock on arrival and falls back to the route", () => {
    const st = new GameStateStore();
    arrivedAt(st, "A", 1);
    st.apply(line("FSDTarget", 5, { Name: "B", SystemAddress: 2, StarClass: "M" }));
    st.applyLiveNavRoute([
      { systemAddress: 1, starSystem: "A", starPos: [0, 0, 0] },
      { systemAddress: 2, starSystem: "B", starPos: [10, 0, 0] },
      { systemAddress: 3, starSystem: "C", starPos: [20, 0, 0], starClass: "A" },
    ]);
    arrivedAt(st, "B", 2, 30);
    expect(st.nextJumpTarget()).toMatchObject({ starSystem: "C", starClass: "A", source: "route" });
  });

  it("returns null with nothing plotted, targeted or in flight", () => {
    const st = new GameStateStore();
    expect(st.nextJumpTarget()).toBeNull();
  });
});
