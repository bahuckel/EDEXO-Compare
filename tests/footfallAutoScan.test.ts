/**
 * A body somebody else has walked must never be offered as an unclaimed 5x.
 *
 * Found in the field on Aucoks OG-E b18-3 A 1, 2026-09-09. The game wrote two scans for it:
 *
 *   11:55:05  AutoScan   WasMapped true   WasFootfalled true
 *   11:56:10  Detailed   WasMapped false  WasFootfalled false
 *
 * The detailed one lands right after the commander's own SAAScanComplete and contradicts the first.
 * The reads for those flags sat below a `ScanType !== "Detailed"` return, so the honest `true` was
 * discarded unseen and the app promised a first footfall that had already been taken.
 *
 * This is the expensive kind of wrong: the commander flies there, lands, and finds out on the ground.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import type { JournalLine } from "../src/shared/types.js";

const SYS = 7269903116441;
const BODY = 9;
const KEY = `${SYS}:${BODY}`;
const NAME = "Aucoks OG-E b18-3 A 1";
const j = (o: Record<string, unknown>) => o as unknown as JournalLine;

/** Shapes copied from the owner's journal, trimmed to the fields that decide this. */
const scan = (ts: string, scanType: string, wasFootfalled: boolean, wasMapped: boolean) =>
  j({
    timestamp: ts,
    event: "Scan",
    ScanType: scanType,
    BodyName: NAME,
    BodyID: BODY,
    StarSystem: "Aucoks OG-E b18-3",
    SystemAddress: SYS,
    PlanetClass: "High metal content body",
    Landable: true,
    WasDiscovered: true,
    WasMapped: wasMapped,
    WasFootfalled: wasFootfalled,
  });

const disembark = (ts: string) =>
  j({
    timestamp: ts,
    event: "Disembark",
    OnPlanet: true,
    OnStation: false,
    BodyID: BODY,
    Body: NAME,
    StarSystem: "Aucoks OG-E b18-3",
    SystemAddress: SYS,
  });

function seeded(): GameStateStore {
  const st = new GameStateStore();
  st.apply(j({ timestamp: "2026-09-09T11:54:00Z", event: "FSDJump", StarSystem: "Aucoks OG-E b18-3", SystemAddress: SYS }));
  return st;
}

describe("an auto scan that says somebody has been here", () => {
  it("is recorded, even though it is not a detailed scan", () => {
    const st = seeded();
    st.apply(scan("2026-09-09T11:55:05Z", "AutoScan", true, true));
    expect(st.bodyFootfallFlag.get(KEY)?.value).toBe(true);
  });

  it("is not undone by a later detailed scan saying otherwise", () => {
    // The exact sequence from the journal. Footfall does not un-happen.
    const st = seeded();
    st.apply(scan("2026-09-09T11:55:05Z", "AutoScan", true, true));
    st.apply(scan("2026-09-09T11:56:10Z", "Detailed", false, false));
    expect(st.bodyFootfallFlag.get(KEY)?.value).toBe(true);
    expect(st.bodyDetailedFootfallState.get(KEY)).toBe(true);
  });

  it("stops the body being claimed as a first footfall", () => {
    // The bug as the commander met it: land, and the app says the 5x is yours. It was not.
    const st = seeded();
    st.apply(scan("2026-09-09T11:55:05Z", "AutoScan", true, true));
    st.apply(scan("2026-09-09T11:56:10Z", "Detailed", false, false));
    st.apply(disembark("2026-09-09T12:10:00Z"));
    expect(st.firstFootfallBodies.has(KEY)).toBe(false);
  });

  it("survives the scans arriving in the other order", () => {
    // Journal replay does not guarantee order across files, and the merge is meant to be
    // order-independent. If this ever diverges from the case above, the sticky rule has broken.
    const st = seeded();
    st.apply(scan("2026-09-09T11:56:10Z", "Detailed", false, false));
    st.apply(scan("2026-09-09T11:55:05Z", "AutoScan", true, true));
    st.apply(disembark("2026-09-09T12:10:00Z"));
    expect(st.firstFootfallBodies.has(KEY)).toBe(false);
  });
});

describe("a body nobody has walked", () => {
  it("is still claimed, so the fix did not simply switch the feature off", () => {
    const st = seeded();
    st.apply(scan("2026-09-09T11:55:05Z", "AutoScan", false, false));
    st.apply(scan("2026-09-09T11:56:10Z", "Detailed", false, false));
    st.apply(disembark("2026-09-09T12:10:00Z"));
    expect(st.firstFootfallBodies.has(KEY)).toBe(true);
  });

  it("is claimed when only an auto scan ever reported it", () => {
    const st = seeded();
    st.apply(scan("2026-09-09T11:55:05Z", "AutoScan", false, false));
    st.apply(disembark("2026-09-09T12:10:00Z"));
    expect(st.firstFootfallBodies.has(KEY)).toBe(true);
  });
});
