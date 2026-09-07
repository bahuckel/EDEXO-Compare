/**
 * INCLUDE-BODY-IDS Phase 3, wired end to end through `GameStateStore.apply`.
 *
 * The journal shapes below are taken verbatim from the owner's own logs
 * (`Journal.2026-05-05T050905.01.log`, Eorgh Prou KN-A d14-201 B 3), so this tests the events the
 * game actually emits rather than what the plan assumed it emits.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { targetRung } from "../src/shared/observedFlag.js";

const SYS = 6914570015099;
const BODY = 15;
/** `bodyKey` is module-private in gameState; the format is `${systemAddress}:${bodyId}`. */
const KEY = `${SYS}:${BODY}`;

/** The FSS honk: a count, and deliberately nothing about genera. */
const fssBodySignals = (ts: string) => ({
  timestamp: ts,
  event: "FSSBodySignals",
  BodyName: "Eorgh Prou KN-A d14-201 B 3",
  BodyID: BODY,
  SystemAddress: SYS,
  Signals: [{ Type: "$SAA_SignalType_Biological;", Type_Localised: "Biological", Count: 1 }],
});

/** A detailed scan, carrying the two flags this phase is about. */
const detailedScan = (ts: string, wasMapped: boolean, wasFootfalled: boolean) => ({
  timestamp: ts,
  event: "Scan",
  ScanType: "Detailed",
  BodyName: "Eorgh Prou KN-A d14-201 B 3",
  BodyID: BODY,
  StarSystem: "Eorgh Prou KN-A d14-201",
  SystemAddress: SYS,
  PlanetClass: "High metal content body",
  AtmosphereType: "CarbonDioxide",
  SurfaceGravity: 5.647542,
  SurfaceTemperature: 251.650421,
  Landable: true,
  WasDiscovered: false,
  WasMapped: wasMapped,
  WasFootfalled: wasFootfalled,
});

const saaScanComplete = (ts: string) => ({
  timestamp: ts,
  event: "SAAScanComplete",
  BodyName: "Eorgh Prou KN-A d14-201 B 3",
  BodyID: BODY,
  SystemAddress: SYS,
  ProbesUsed: 5,
  EfficiencyTarget: 7,
});

const disembark = (ts: string) => ({
  timestamp: ts,
  event: "Disembark",
  OnPlanet: true,
  OnStation: false,
  BodyID: BODY,
  SystemAddress: SYS,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const feed = (store: GameStateStore, lines: object[]) => lines.forEach((l) => store.apply(l as any));

describe("Phase 3 through the real journal events", () => {
  it("an FSS honk alone leaves both flags unknown — a count is not a map", () => {
    const s = new GameStateStore();
    feed(s, [fssBodySignals("2026-05-05T07:20:19Z")]);
    expect(s.bodyFootfallFlag.get(KEY)).toBeUndefined();
    expect(s.bodyMappedFlag.get(KEY)).toBeUndefined();
  });

  it("a detailed scan records both flags with the line's own timestamp", () => {
    const s = new GameStateStore();
    feed(s, [detailedScan("2026-05-05T07:20:19Z", false, false)]);
    expect(s.bodyFootfallFlag.get(KEY)).toEqual({
      value: false,
      source: "journal",
      seenAt: "2026-05-05T07:20:19Z",
    });
    expect(s.bodyMappedFlag.get(KEY)?.value).toBe(false);
    expect(targetRung(s.bodyFootfallFlag.get(KEY)!, s.bodyMappedFlag.get(KEY)!)).toBe("unopened");
  });

  it("our own DSS marks it mapped from that moment", () => {
    const s = new GameStateStore();
    feed(s, [detailedScan("2026-05-05T07:20:19Z", false, false), saaScanComplete("2026-05-05T07:31:00Z")]);
    const m = s.bodyMappedFlag.get(KEY)!;
    expect(m.value).toBe(true);
    expect(m.seenAt).toBe("2026-05-05T07:31:00Z");
    expect(targetRung(s.bodyFootfallFlag.get(KEY)!, m)).toBe("mapped-not-walked");
  });

  it("disembarking makes it walked, and does not cost us the bonus we had already earned", () => {
    const s = new GameStateStore();
    feed(s, [detailedScan("2026-05-05T07:20:19Z", false, false), disembark("2026-05-05T07:45:00Z")]);
    // The ×5 is ours: the scan said unfootfalled before we landed.
    expect(s.firstFootfallBodies.has(KEY)).toBe(true);
    expect(s.bodyFootfallFlag.get(KEY)?.value).toBe(true);
    expect(targetRung(s.bodyFootfallFlag.get(KEY)!, s.bodyMappedFlag.get(KEY)!)).toBe("walked");
  });

  /**
   * The trap the plan warns about: our own DSS makes *later* scans report `WasMapped: true`. For
   * "has anyone mapped it" that is simply correct, and the separate first-mapper question stays
   * frozen at SAAScanComplete — so both answers survive.
   */
  it("a later scan reporting WasMapped after our own DSS does not corrupt first-mapper eligibility", () => {
    const s = new GameStateStore();
    feed(s, [
      detailedScan("2026-05-05T07:20:19Z", false, false),
      saaScanComplete("2026-05-05T07:31:00Z"),
      detailedScan("2026-05-05T08:00:00Z", true, false),
    ]);
    expect(s.dssFirstMapperEligibleByBodyKey.get(KEY)).toBe(true); // we mapped it first
    expect(s.bodyMappedFlag.get(KEY)?.value).toBe(true);
  });

  it("a stale false never clears a true, even arriving later", () => {
    const s = new GameStateStore();
    feed(s, [
      detailedScan("2026-05-05T07:20:19Z", false, true), // somebody had walked it
      detailedScan("2026-05-06T07:20:19Z", false, false), // a later line disagrees
    ]);
    expect(s.bodyFootfallFlag.get(KEY)?.value).toBe(true);
    // And the projection the payout path reads agrees, which is the point of the single write path.
    expect(s.bodyDetailedFootfallState.get(KEY)).toBe(true);
  });

  it("survives a save/load round trip with its ages intact", () => {
    const s = new GameStateStore();
    feed(s, [detailedScan("2026-05-05T07:20:19Z", false, false), saaScanComplete("2026-05-05T07:31:00Z")]);
    const payload = s.serializeJournalMergePayload();

    const t = new GameStateStore();
    t.hydrateJournalMergePayload(payload);
    expect(t.bodyFootfallFlag.get(KEY)?.seenAt).toBe("2026-05-05T07:20:19Z");
    expect(t.bodyMappedFlag.get(KEY)?.seenAt).toBe("2026-05-05T07:31:00Z");
  });

  it("a cache written before Phase 3 still loads, and reads as unknown rather than false", () => {
    const s = new GameStateStore();
    feed(s, [detailedScan("2026-05-05T07:20:19Z", false, false)]);
    const payload = s.serializeJournalMergePayload();
    delete (payload as { bodyFootfallFlag?: unknown }).bodyFootfallFlag;
    delete (payload as { bodyMappedFlag?: unknown }).bodyMappedFlag;

    const t = new GameStateStore();
    t.hydrateJournalMergePayload(payload);
    expect(t.bodyFootfallFlag.get(KEY)).toBeUndefined();
    expect(t.bodyMappedFlag.get(KEY)).toBeUndefined();
  });
});

describe("the commander's own position (§10.3)", () => {
  const jump = (ts: string, sys: string, addr: number, pos: unknown, event = "FSDJump") => ({
    timestamp: ts,
    event,
    StarSystem: sys,
    SystemAddress: addr,
    StarPos: pos,
  });

  it("captures StarPos from a jump", () => {
    const s = new GameStateStore();
    feed(s, [jump("2026-09-07T01:00:00Z", "Swoilz KI-E b4-9", 1, [137, -88.84375, 298.09375])]);
    expect(s.commanderPos).toEqual({ x: 137, y: -88.84375, z: 298.09375 });
    expect(s.currentSystem).toBe("Swoilz KI-E b4-9");
  });

  it("takes it from Location and CarrierJump too — all three carry StarPos", () => {
    for (const event of ["Location", "CarrierJump"]) {
      const s = new GameStateStore();
      feed(s, [jump("2026-09-07T01:00:00Z", "Sol", 10477373803, [0, 0, 0], event)]);
      expect(s.commanderPos, event).toEqual({ x: 0, y: 0, z: 0 });
    }
  });

  it("moves with the commander", () => {
    const s = new GameStateStore();
    feed(s, [
      jump("2026-09-07T01:00:00Z", "A", 1, [1, 2, 3]),
      jump("2026-09-07T02:00:00Z", "B", 2, [10, 20, 30]),
    ]);
    expect(s.commanderPos).toEqual({ x: 10, y: 20, z: 30 });
  });

  /** A jump line without usable coordinates must not move the ship to the origin. */
  it("ignores a malformed StarPos rather than jumping to 0,0,0", () => {
    const s = new GameStateStore();
    feed(s, [jump("2026-09-07T01:00:00Z", "A", 1, [1, 2, 3])]);
    feed(s, [
      jump("2026-09-07T02:00:00Z", "B", 2, ["x", 2, 3]),
      jump("2026-09-07T03:00:00Z", "C", 3, [1, 2]),
      jump("2026-09-07T04:00:00Z", "D", 4, undefined),
    ]);
    expect(s.commanderPos).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("survives the cache, and an older cache simply has no position", () => {
    const s = new GameStateStore();
    feed(s, [jump("2026-09-07T01:00:00Z", "A", 1, [1, 2, 3])]);
    const payload = s.serializeJournalMergePayload();

    const t = new GameStateStore();
    t.hydrateJournalMergePayload(payload);
    expect(t.commanderPos).toEqual({ x: 1, y: 2, z: 3 });

    // A cache written before §10.3 loads and reports null — the map draws nothing rather than
    // guessing, and the next jump fills it in.
    delete (payload as { commanderPos?: unknown }).commanderPos;
    const u = new GameStateStore();
    u.hydrateJournalMergePayload(payload);
    expect(u.commanderPos).toBeNull();
  });
});
