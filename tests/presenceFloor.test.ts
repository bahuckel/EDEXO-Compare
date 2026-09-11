/**
 * A candidate the model scored at 2.7 % does not belong beside one it scored at 100 %.
 *
 * Reported from the field on Blu Thua LJ-F c25-8 B 1 a — an icy moon under the second star, two
 * biological signals, and the panel offering Fonticulua upupam and a Fungoida under 5 % alongside a
 * Fonticulua campestris the model was certain of. Nothing was wrong with the numbers; the panel was
 * showing rows its own model had already judged.
 */
import { describe, expect, it } from "vitest";
import { PRESENCE_FLOOR_PCT, demoteBelowPresenceFloor } from "../src/server/snapshot.js";
import type { BodyExoState, SpeciesDatabase, SpeciesMatch } from "../src/shared/types.js";

const db: SpeciesDatabase = { species: [] };

function body(over: Partial<BodyExoState> = {}): BodyExoState {
  return {
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
  };
}

function match(id: string, pct: number | null, over: Partial<SpeciesMatch> = {}): SpeciesMatch {
  return {
    entry: { id, displayName: id, genus: id.split("_")[0]! } as SpeciesMatch["entry"],
    reasons: [],
    photoUrl: "",
    photoNote: null,
    priceCredits: null,
    presenceProbabilityPercent: pct,
    ...over,
  } as SpeciesMatch;
}

const shownIds = (ms: SpeciesMatch[]) => ms.filter((m) => !m.unlikely).map((m) => m.entry.id);

describe("the chance floor", () => {
  it("demotes the long shots and keeps the rest", () => {
    // The real row from the field: campestris certain, upupam 4.7, bullarum 2.7.
    const ms = [
      match("fonticulua_campestris", 100),
      match("fonticulua_upupam", 4.7),
      match("fungoida_bullarum", 2.7),
    ];
    demoteBelowPresenceFloor(ms, body(), db);
    expect(shownIds(ms)).toEqual(["fonticulua_campestris"]);
    expect(ms[1]!.unlikelyReasons?.[0]?.detail).toContain("4.7 %");
  });

  it("keeps the best row rather than emptying the panel", () => {
    const ms = [match("a", 4), match("b", 3), match("c", 1)];
    demoteBelowPresenceFloor(ms, body(), db);
    // One row, and the right one — not two, however many signals the game reported.
    expect(shownIds(ms)).toEqual(["a"]);
  });

  it("leaves an unmeasured row alone", () => {
    // Null is "the model has no opinion", never "unlikely".
    const ms = [match("a", 90), match("b", null)];
    demoteBelowPresenceFloor(ms, body(), db);
    expect(shownIds(ms)).toEqual(["a", "b"]);
  });

  it("never argues with the commander's own boots", () => {
    const ms = [
      match("a", 90),
      match("b", 1, { organicAnalysisComplete: true }),
      match("c", 1, { approximateMatch: true }),
    ];
    demoteBelowPresenceFloor(ms, body(), db);
    expect(shownIds(ms)).toEqual(["a", "b", "c"]);
  });

  it("does not touch a row already behind the unlikely tier", () => {
    const ms = [match("a", 90), match("b", 2, { unlikely: true, unlikelyReasons: [] })];
    demoteBelowPresenceFloor(ms, body(), db);
    expect(ms[1]!.unlikelyReasons).toEqual([]);
  });

  it("keeps a row exactly at the floor", () => {
    const ms = [match("a", 90), match("b", PRESENCE_FLOOR_PCT)];
    demoteBelowPresenceFloor(ms, body(), db);
    expect(shownIds(ms)).toEqual(["a", "b"]);
  });
});

describe("after a DSS", () => {
  /**
   * Probes name the genera, and the matcher drops every candidate outside them. What is left is no
   * longer "might any of this be here" but "which of this is it", and a 2.3 % row beside a 97 % one
   * is then a real answer — the only other thing it could be. Measured across the owner's journals:
   * five rows on DSS-mapped bodies were being hidden this way, all of them Fonticulua upupam.
   */
  const withDss = () =>
    body({
      genusHints: [{ Genus: "$Codex_Ent_Fonticulua_Genus_Name;", Genus_Localised: "Fonticulua" }],
    });

  it("puts the genus back on the list", () => {
    const ms = [match("fonticulua_campestris", 97), match("fonticulua_upupam", 2.3)];
    demoteBelowPresenceFloor(ms, withDss(), db);
    expect(shownIds(ms)).toEqual(["fonticulua_campestris", "fonticulua_upupam"]);
  });

  it("still applies the floor when the genera are not named", () => {
    const ms = [match("fonticulua_campestris", 97), match("fonticulua_upupam", 2.3)];
    demoteBelowPresenceFloor(ms, body({ genusHints: null }), db);
    expect(shownIds(ms)).toEqual(["fonticulua_campestris"]);
  });
});
