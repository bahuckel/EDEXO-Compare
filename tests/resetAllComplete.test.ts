/**
 * `resetAll` (a journal re-read, a rotation) leaves no journal state behind (plan 2.4, O-19). It
 * missed `commanderFid` and `lastJumpTarget`, so a re-read could keep a commander id or a jump
 * target from the history it had just thrown away. This compares every field against a fresh store,
 * so the next field someone adds and forgets is caught too.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GameStateStore } from "../src/server/gameState.js";
import type { JournalLine } from "../src/shared/types.js";

const fixture = readFileSync("tests/fixtures/journal-variety/Journal.2026-09-01T100000.01.log", "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => JSON.parse(l) as JournalLine);
const extra = [
  { timestamp: "2026-09-01T12:00:00Z", event: "FSDTarget", Name: "Tgt", SystemAddress: 5, StarClass: "K", RemainingJumpsInRoute: 3 },
  { timestamp: "2026-09-01T12:00:01Z", event: "StartJump", JumpType: "Hyperspace", StarSystem: "Tgt", SystemAddress: 5, StarClass: "K" },
  { timestamp: "2026-09-01T12:00:02Z", event: "Touchdown", SystemAddress: 5, Body: "Tgt 1", BodyID: 1, Latitude: 1, Longitude: 2 },
  { timestamp: "2026-09-01T12:00:03Z", event: "ScanOrganic", ScanType: "Log", Genus_Localised: "Osseus", Species_Localised: "Osseus Spiralis", SystemAddress: 5, Body: 1 },
  { timestamp: "2026-09-01T12:00:04Z", event: "CodexEntry", Name: "$Codex_Ent_Osseus_02_Name;", Region_Localised: "Inner Orion Spur", SystemAddress: 5, BodyID: 1, IsNewEntry: true },
  { timestamp: "2026-09-01T12:00:06Z", event: "Disembark", SRV: false, OnPlanet: true, SystemAddress: 5, BodyID: 1 },
] as unknown as JournalLine[];

/** Counters that move on so memos keyed on them are dropped, and those memos. Moving is the reset. */
const MOVES_ON = new Set(["explorationScansRevision", "orbitParentRevision", "confirmedVariantsRevision", "scanIndexMemo", "orbitParentMemo", "boxelsRevision"]);

const shape = (v: unknown): unknown =>
  v instanceof Map || v instanceof Set ? `size ${v.size}` : Array.isArray(v) ? `length ${v.length}` : v && typeof v === "object" ? "set" : v;

describe("resetAll", () => {
  it("leaves every field as a fresh store has it", () => {
    const fresh = new GameStateStore() as unknown as Record<string, unknown>;
    const s = new GameStateStore();
    for (const l of [...fixture, ...extra]) s.apply(l);
    s.resetAll();
    const after = s as unknown as Record<string, unknown>;
    const left = Object.keys(after).filter(
      (k) => !MOVES_ON.has(k) && typeof after[k] !== "function" && JSON.stringify(shape(after[k])) !== JSON.stringify(shape(fresh[k])),
    );
    expect(left.map((k) => `${k}: ${JSON.stringify(shape(after[k]))}`)).toEqual([]);
  });
});
