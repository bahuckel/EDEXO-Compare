/**
 * Leaving a body by jumping (plan 2.4, Fable S3). The HUD's sample tracker and the touchdown body are
 * wiped when the ship leaves the planet. The block that does it sat after `FSDJump` / `CarrierJump`
 * had already returned, so an FSD jump only wiped them thanks to the `StartJump` before it, and a
 * carrier jump never did: the radar stayed up for ground hundreds of light years away.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import type { JournalLine } from "../src/shared/types.js";

const line = (l: Record<string, unknown>) => l as unknown as JournalLine;
const carrierJump = line({
  timestamp: "2026-10-02T10:00:00Z",
  event: "CarrierJump",
  Docked: true,
  StarSystem: "Test Sector AB-C d1-2",
  SystemAddress: 1234567890123,
  StarPos: [1, 2, 3],
  Body: "Test Sector AB-C d1-2",
  BodyID: 0,
});
const fsdJump = line({ ...carrierJump, event: "FSDJump", Docked: undefined, JumpDist: 40, FuelUsed: 2 });

function midRun() {
  const s = new GameStateStore();
  s.exoOrganicTracker = { bodyKey: "9:9" } as unknown as GameStateStore["exoOrganicTracker"];
  s.overlayTouchdownBodyKey = "9:9";
  return s;
}

describe("a jump leaves the body", () => {
  for (const [name, l] of [
    ["carrier jump", carrierJump],
    ["FSD jump with no StartJump before it", fsdJump],
  ] as const) {
    it(`folds the tracker on a ${name}`, () => {
      const s = midRun();
      s.apply(l);
      expect(s.exoOrganicTracker).toBeNull();
      expect(s.overlayTouchdownBodyKey).toBeNull();
    });
  }
});
