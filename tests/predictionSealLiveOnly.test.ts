/**
 * Prediction records are sealed by live departures only (plan 2.4, O-19). A replay walks years of
 * history through `apply`; sealing there closed a record the commander was still working on the
 * first time the history left that system on an older visit.
 */
import { describe, expect, it, vi } from "vitest";
import type { JournalLine } from "../src/shared/types.js";

const sealed: number[] = [];
vi.mock("../src/server/predictionAuditLog.js", async () => {
  const actual = await vi.importActual<typeof import("../src/server/predictionAuditLog.js")>(
    "../src/server/predictionAuditLog.js",
  );
  return { ...actual, finalisePredictionsForSystem: (addr: number) => (sealed.push(addr), 0) };
});
const { GameStateStore } = await import("../src/server/gameState.js");

const jump = (event: string, sys: string, addr: number) =>
  ({ timestamp: "2026-10-02T10:00:00Z", event, StarSystem: sys, SystemAddress: addr, StarPos: [addr, 0, 0] }) as unknown as JournalLine;

describe("sealing prediction records", () => {
  it("does not happen while history is replayed", () => {
    sealed.length = 0;
    const s = new GameStateStore();
    s.apply(jump("FSDJump", "Alpha", 11));
    s.apply(jump("FSDJump", "Beta", 22));
    s.apply(jump("Location", "Gamma", 33));
    expect(sealed).toEqual([]);
  });

  it("happens on a live jump, carrier jump or Location elsewhere, and not on a relog in place", () => {
    sealed.length = 0;
    const s = new GameStateStore();
    s.applyLive(jump("FSDJump", "Alpha", 11));
    s.applyLive(jump("CarrierJump", "Beta", 22));
    s.applyLive(jump("Location", "Beta", 22));
    s.applyLive(jump("Location", "Gamma", 33));
    expect(sealed).toEqual([11, 22]);
  });
});
