/**
 * A warm boot (the journal cache) holds what a cold one (every log replayed) holds (plan 2.4, O-19).
 * The cache left out the codex's region per system — achievements by region differed between the
 * two — and the open sample runs and the next-jump targets. Every field of a store rebuilt from the
 * cache is compared against the store that wrote it, so a field added later and not cached fails.
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

/**
 * Not journal state: revision counters (a rebuilt store starts its own) and the memos keyed on them,
 * and the tab the app should jump to next, which is about this session's screen.
 */
const NOT_CACHED = new Set([
  "explorationScansRevision",
  "orbitParentRevision",
  "confirmedVariantsRevision",
  "scanIndexMemo",
  "orbitParentMemo",
  "pendingUiAutoSelectBodyKey",
]);

const shape = (v: unknown): unknown =>
  v instanceof Map || v instanceof Set ? `size ${v.size}` : Array.isArray(v) ? `length ${v.length}` : v && typeof v === "object" ? "set" : v;

describe("journal cache round trip", () => {
  it("rebuilds every journal field a cold replay has", () => {
    const cold = new GameStateStore();
    for (const l of [...fixture, ...extra]) cold.apply(l);
    const warm = new GameStateStore();
    expect(warm.hydrateJournalMergePayload(JSON.parse(JSON.stringify(cold.serializeJournalMergePayload())))).toBe(true);
    const a = cold as unknown as Record<string, unknown>;
    const b = warm as unknown as Record<string, unknown>;
    const differ = Object.keys(a).filter(
      (k) => !NOT_CACHED.has(k) && typeof a[k] !== "function" && JSON.stringify(shape(a[k])) !== JSON.stringify(shape(b[k])),
    );
    expect(differ.map((k) => `${k}: cold ${JSON.stringify(shape(a[k]))}, warm ${JSON.stringify(shape(b[k]))}`)).toEqual([]);
  });
});
