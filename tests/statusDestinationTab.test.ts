/**
 * Following the in-game target to its Body tab (owner, 2026-09-24): once per change of target, same
 * system only, and only a body the app has a tab for — so a click on another tab is never undone.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import type { JournalLine } from "../src/shared/types.js";

const SYS = 323523254163;
const OTHER = 999;

function storeWithTabs(): GameStateStore {
  const store = new GameStateStore();
  const at = (o: Record<string, unknown>) => store.apply({ timestamp: "2026-09-24T00:00:00Z", ...o } as JournalLine);
  at({ event: "FSDJump", StarSystem: "Tegnae DG-X d1-9", SystemAddress: SYS, StarPos: [0, 0, 0] });
  for (const [id, name] of [[17, "Tegnae DG-X d1-9 2 c"], [18, "Tegnae DG-X d1-9 2 d"]] as const) {
    at({
      event: "FSSBodySignals",
      SystemAddress: SYS,
      BodyID: id,
      BodyName: name,
      Signals: [{ Type: "$SAA_SignalType_Biological;", Type_Localised: "Biological", Count: 2 }],
    });
  }
  store.clearPendingUiAutoSelectBodyKey();
  return store;
}
const dest = (systemAddress: number, bodyId: number, name: string) => ({ systemAddress, bodyId, name });

describe("the targeted body's tab", () => {
  it("is selected once when a tabbed body in this system becomes the target", () => {
    const store = storeWithTabs();
    expect(store.applyStatusDestination(dest(SYS, 17, "Tegnae DG-X d1-9 2 c"))).toBe(true);
    const key = store.peekPendingUiAutoSelectBodyKey();
    expect(key).not.toBeNull();
    expect(key).toContain("17");
  });

  it("is not requested again while the same target stays set", () => {
    const store = storeWithTabs();
    store.applyStatusDestination(dest(SYS, 17, "Tegnae DG-X d1-9 2 c"));
    store.clearPendingUiAutoSelectBodyKey(); // the broadcast consumed it; he clicks another tab
    expect(store.applyStatusDestination(dest(SYS, 17, "Tegnae DG-X d1-9 2 c"))).toBe(false);
    expect(store.peekPendingUiAutoSelectBodyKey()).toBeNull();
  });

  it("fires again for a new target, and for the old one after something else", () => {
    const store = storeWithTabs();
    store.applyStatusDestination(dest(SYS, 17, "Tegnae DG-X d1-9 2 c"));
    store.clearPendingUiAutoSelectBodyKey();
    store.applyStatusDestination(dest(SYS, 18, "Tegnae DG-X d1-9 2 d"));
    expect(store.peekPendingUiAutoSelectBodyKey()).toContain("18");
    store.clearPendingUiAutoSelectBodyKey();
    store.applyStatusDestination(null);
    store.applyStatusDestination(dest(SYS, 17, "Tegnae DG-X d1-9 2 c"));
    expect(store.peekPendingUiAutoSelectBodyKey()).toContain("17");
  });

  it("does nothing for a body without a tab, or in another system", () => {
    const store = storeWithTabs();
    expect(store.applyStatusDestination(dest(SYS, 3, "Tegnae DG-X d1-9 A"))).toBe(true); // still a change, for the HUD
    expect(store.peekPendingUiAutoSelectBodyKey()).toBeNull();
    store.applyStatusDestination(dest(OTHER, 17, "Elsewhere 2 c"));
    expect(store.peekPendingUiAutoSelectBodyKey()).toBeNull();
  });
});
