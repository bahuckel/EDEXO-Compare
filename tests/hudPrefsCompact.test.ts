/**
 * The HUD settings the server keeps (GameState.setHudPrefs): unknown keys dropped, so a new setting
 * that is not listed never reaches a phone or the Electron overlays. Compact overlays (guild tester,
 * 2026-09-30) is the newest.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";

describe("HUD settings on the server", () => {
  it("keeps compact, drops what it does not know", () => {
    const s = new GameStateStore();
    expect(s.setHudPrefs({ compact: true, region: false, nonsense: 1 })).toEqual({ compact: true, region: false });
    expect(s.setHudPrefs({ compact: "yes" })).toEqual({});
  });

  it("keeps 'only when relevant' (2026-09-30)", () => {
    const s = new GameStateStore();
    expect(s.setHudPrefs({ relevant: true, compact: false })).toEqual({ relevant: true, compact: false });
    expect(s.setHudPrefs({ relevant: 1 })).toEqual({});
  });
});
