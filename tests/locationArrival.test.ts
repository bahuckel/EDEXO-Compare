/**
 * `Location` in another system is an arrival (plan 2.4, Fable S9). A relog after a respawn, a
 * rescue or a carrier move puts the commander somewhere new with `Location`, not `FSDJump`; the app
 * kept the system it had been pointed at pinned, so the body tabs showed the old place.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import type { JournalLine } from "../src/shared/types.js";

const at = (event: string, sys: string, addr: number) =>
  ({ timestamp: "2026-10-02T10:00:00Z", event, StarSystem: sys, SystemAddress: addr, StarPos: [addr, 0, 0] }) as unknown as JournalLine;

describe("Location", () => {
  it("in another system lets go of the system the app was pointed at", () => {
    const s = new GameStateStore();
    s.apply(at("FSDJump", "Alpha", 11));
    s.setViewingSystemAddress(99);
    s.apply(at("Location", "Beta", 22));
    expect(s.currentSystemAddress).toBe(22);
    expect(s.viewingSystemAddress).toBeNull();
  });

  it("in the same system (a plain relog) leaves the choice alone", () => {
    const s = new GameStateStore();
    s.apply(at("FSDJump", "Alpha", 11));
    s.setViewingSystemAddress(99);
    s.apply(at("Location", "Alpha", 11));
    expect(s.viewingSystemAddress).toBe(99);
  });
});
