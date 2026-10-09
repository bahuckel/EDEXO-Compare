/**
 * A [CODEX FIRST] row in the list at 1 % or less (owner, 2026-10-09): a red tint and a [?] that says
 * which rule kept it, and an Options switch that sends it to the unlikely list instead.
 */
import { afterEach, describe, expect, it } from "vitest";
import { demoteBelowPresenceFloor, explainLowChanceCodexFirst, setCodexFirstLowChanceKept } from "../src/server/snapshot.js";
import { floorKeptReason } from "../src/server/presenceFloors.js";
import { DEFAULT_NOTIFY_PREFS, mergeNotifyPrefs } from "../src/shared/notices.js";
import type { BodyExoState, SpeciesDatabase, SpeciesMatch } from "../src/shared/types.js";

const db: SpeciesDatabase = { species: [] };
const body = (over: Partial<BodyExoState> = {}): BodyExoState =>
  ({
    key: "1:2",
    bodyName: "Test 1 a",
    bodyId: 2,
    systemAddress: 1,
    starSystem: "Test",
    biologicalSignals: 2,
    genusHints: null,
    dssComplete: false,
    scan: null,
    organicGenusLocks: [],
    confirmedVariants: [],
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  }) as BodyExoState;
const match = (id: string, pct: number | null, over: Partial<SpeciesMatch> = {}): SpeciesMatch =>
  ({
    entry: { id, displayName: id, genus: id.split("_")[0]!, genusDataDir: id.split("_")[0]! },
    reasons: [],
    photoUrl: "",
    photoNote: null,
    priceCredits: null,
    presenceProbabilityPercent: pct,
    ...over,
  }) as SpeciesMatch;
const first = { codexNew: true, codexFirst: true };

afterEach(() => setCodexFirstLowChanceKept(() => true));

describe("why a low row stands in the list", () => {
  it("the floor records the rule that kept each row", () => {
    const ms = [match("a", 0.8), match("b", 0.6), match("c", 0.4, { organicAnalysisComplete: true }), match("d", 0.3, { approximateMatch: true }), match("e", 5)];
    demoteBelowPresenceFloor(ms, body(), db);
    expect(floorKeptReason(ms[4]!)?.why).toBe("passed");
    expect(floorKeptReason(ms[0]!)).toBeNull(); // "e" took the one best-row place: "a" went to unlikely
    expect(floorKeptReason(ms[2]!)?.why).toBe("sampled");
    expect(floorKeptReason(ms[3]!)?.why).toBe("approximate");
    const lone = [match("x", 0.7), match("y", 0.2)];
    demoteBelowPresenceFloor(lone, body(), db);
    expect(floorKeptReason(lone[0]!)?.why).toBe("best");
  });

  it("after a DSS, the share of the genus", () => {
    const ms = [match("bacterium_tela", 0.4, { genusSharePercent: 1.9 }), match("bacterium_cerbrus", 30, { genusSharePercent: 98.1 })];
    demoteBelowPresenceFloor(ms, body({ genusHints: [{ genus: "$Codex_Ent_Bacterial_Genus_Name;" }] } as unknown as Partial<BodyExoState>), db);
    expect(floorKeptReason(ms[0]!)).toEqual({ why: "genusShare", pct: 1.9 });
  });
});

describe("[CODEX FIRST] at 1 % or less", () => {
  it("is explained, with the rule that kept it", () => {
    const ms = [match("a", 0.6, first), match("b", 0.2)];
    demoteBelowPresenceFloor(ms, body(), db);
    explainLowChanceCodexFirst(ms);
    expect(ms[0]!.unlikely).toBeFalsy();
    expect(ms[0]!.lowChanceWhy).toMatch(/^Shown at 0\.6 %: Every candidate on this body is under 1 %/);
    expect(ms[0]!.lowChanceWhy).toMatch(/CODEX FIRST/);
  });

  it("leaves rows over 1 %, and rows that are not firsts, alone", () => {
    const ms = [match("a", 1.6, first), match("b", 0.9, { codexNew: true })];
    demoteBelowPresenceFloor(ms, body(), db);
    explainLowChanceCodexFirst(ms);
    expect(ms.map((m) => m.lowChanceWhy)).toEqual([undefined, undefined]);
  });

  it("goes to the unlikely list with the switch off, unless sampled here", () => {
    setCodexFirstLowChanceKept(() => false);
    const ms = [match("a", 0.6, first), match("s", 0.5, { ...first, organicAnalysisComplete: true })];
    demoteBelowPresenceFloor(ms, body(), db);
    explainLowChanceCodexFirst(ms);
    expect(ms[0]!.unlikely).toBe(true);
    expect(ms[0]!.unlikelyReasons?.at(-1)?.detail).toMatch(/Options → Notify me/);
    expect(ms[1]!.unlikely).toBeFalsy();
    expect(ms[1]!.lowChanceWhy).toMatch(/You have sampled it on this body/);
  });

  it("the setting is on by default and merges like the others", () => {
    expect(DEFAULT_NOTIFY_PREFS.codexFirstLowChance).toBe(true);
    expect(mergeNotifyPrefs(DEFAULT_NOTIFY_PREFS, { codexFirstLowChance: false }).codexFirstLowChance).toBe(false);
    expect(mergeNotifyPrefs(DEFAULT_NOTIFY_PREFS, { codexFirstLowChance: "no" }).codexFirstLowChance).toBe(true);
  });
});
