/**
 * The spatial gates need the system's position (owner, 2026-10-07: Electricae radialem was shown on
 * Aishaist SA-G b39-0 C 5, 5,100 ly from any nebula, once he had jumped on — a system left behind had
 * no coordinates in its match context, so every position rule stood aside). A flown system keeps its
 * journal StarPos.
 */
import { describe, expect, it } from "vitest";
import { buildSpeciesMatchContext } from "../src/server/speciesMatchContext.js";
import { GameStateStore } from "../src/server/gameState.js";
import type { BodyExoState, JournalLine } from "../src/shared/types.js";

const jump = (name: string, addr: number, pos: [number, number, number]): JournalLine =>
  ({
    timestamp: "2026-10-06T19:48:13Z",
    event: "FSDJump",
    StarSystem: name,
    SystemAddress: addr,
    StarPos: pos,
  }) as unknown as JournalLine;

describe("a flown system's position", () => {
  it("stays in the match context after the commander jumps on", () => {
    const store = new GameStateStore();
    store.apply(jump("Aishaist SA-G b39-0", 859665292113, [14055.375, 212.21875, 34347.53125]));
    store.apply(jump("Phooe Chraei IT-O b34-0", 1001, [13987.9375, 181.09375, 34239]));
    const body = { systemAddress: 859665292113, bodyId: 16 } as unknown as BodyExoState;
    expect(buildSpeciesMatchContext(body, store).systemCoords).toEqual({
      x: 14055.375,
      y: 212.21875,
      z: 34347.53125,
    });
  });
});
