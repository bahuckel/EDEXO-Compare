/**
 * A candidate the model scored at 2.7 % does not belong beside one it scored at 100 %.
 *
 * Reported from the field on Blu Thua LJ-F c25-8 B 1 a — an icy moon under the second star, two
 * biological signals, and the panel offering Fonticulua upupam and a Fungoida under 5 % alongside a
 * Fonticulua campestris the model was certain of. Nothing was wrong with the numbers; the panel was
 * showing rows its own model had already judged.
 */
import { describe, expect, it } from "vitest";
import { GENUS_SHARE_FLOOR_PCT, PRESENCE_FLOOR_PCT, demoteBelowPresenceFloor } from "../src/server/snapshot.js";
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
    /*
      `genusDataDir` is what the app groups and folders by, and the post-DSS floor keeps one row per
      genus — leave it off and every row lands in the same nameless group, which is how the
      "never empties a genus" case first failed here.
    */
    entry: {
      id,
      displayName: id,
      genus: id.split("_")[0]!,
      genusDataDir: id.split("_")[0]!,
    } as SpeciesMatch["entry"],
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
   * longer "might any of this be here" but "which of this is it" — so the presence probability stops
   * being the right question and the share of its own genus becomes it.
   *
   * **This reverses an earlier reading of the same code**, and the reversal is the owner's, from the
   * field: *"I shouldn't be getting Tela as a suggestion for every single body with 1 bio signal."*
   * This function used to return early on any probed body, on the argument that a 2.3 % row beside a
   * 97 % one is a real answer, the only other thing it could be. Measured on his cache, that argument
   * was paying for itself in noise: **Bacterium tela sat on 546 of 574 probed bodies (95.1 %) at a
   * median 1.9 % of its own genus**, against 13.7 % on the never-probed bodies where the floor did
   * run. The structural reason is that tela's only condition is "any thin atmosphere", so on most
   * bodies the matcher narrows Bacterium to exactly two rows — the atmosphere's own species, and
   * tela. It was not a long tail. It was a permanent second row.
   *
   * The cost was measured on the same cache: across 609 species he has confirmed on probed bodies, a
   * 5 % floor would have hidden **two** beforehand, and both return the moment he samples them.
   */
  const withDss = (genus = "Fonticulua") =>
    body({
      genusHints: [{ Genus: `$Codex_Ent_${genus}_Genus_Name;`, Genus_Localised: genus }],
    });

  const share = (id: string, pct: number | null, over: Partial<SpeciesMatch> = {}) =>
    match(id, null, { genusSharePercent: pct, ...over });

  it("floors on the share of the genus, not on the chance of the body", () => {
    // The field case, reduced: one signal, Bacterium named, and tela as the permanent runner-up.
    const ms = [share("bacterium_aurasus", 98.1), share("bacterium_tela", 1.9)];
    demoteBelowPresenceFloor(ms, withDss("Bacterium"), db);
    expect(shownIds(ms)).toEqual(["bacterium_aurasus"]);
    expect(ms[1]!.unlikelyReasons?.[0]?.field).toBe("Share of its genus");
    expect(ms[1]!.unlikelyReasons?.[0]?.detail).toContain("1.9 %");
  });

  it("keeps a row that holds a real share of its genus", () => {
    // Both of the bodies where tela actually grew were 39.4 % and 98.0 % of Bacterium.
    const ms = [share("bacterium_aurasus", 60.6), share("bacterium_tela", 39.4)];
    demoteBelowPresenceFloor(ms, withDss("Bacterium"), db);
    expect(shownIds(ms)).toEqual(["bacterium_aurasus", "bacterium_tela"]);
  });

  it("never empties a genus, even when nothing in it clears", () => {
    /*
      Two genera on one body, one of them thin all the way down. The best row of each survives: the
      probe said that genus is present, so refusing to name any of its species would contradict the
      game rather than the model.
    */
    const ms = [
      share("fonticulua_campestris", 97),
      share("fonticulua_upupam", 3),
      share("bacterium_aurasus", 4),
      share("bacterium_tela", 1),
    ];
    demoteBelowPresenceFloor(ms, withDss(), db);
    expect(shownIds(ms)).toEqual(["fonticulua_campestris", "bacterium_aurasus"]);
  });

  it("leaves a row the model never scored", () => {
    const ms = [share("fonticulua_campestris", 97), share("fonticulua_upupam", null)];
    demoteBelowPresenceFloor(ms, withDss(), db);
    expect(shownIds(ms)).toEqual(["fonticulua_campestris", "fonticulua_upupam"]);
  });

  it("never argues with the commander's own boots", () => {
    const ms = [
      share("fonticulua_campestris", 97),
      share("fonticulua_upupam", 1, { organicAnalysisComplete: true }),
      share("fonticulua_fluctus", 1, { approximateMatch: true }),
    ];
    demoteBelowPresenceFloor(ms, withDss(), db);
    expect(shownIds(ms)).toEqual(["fonticulua_campestris", "fonticulua_upupam", "fonticulua_fluctus"]);
  });

  it("keeps a row exactly at the floor", () => {
    const ms = [share("a_one", 95), share("a_two", GENUS_SHARE_FLOOR_PCT)];
    demoteBelowPresenceFloor(ms, withDss(), db);
    expect(shownIds(ms)).toEqual(["a_one", "a_two"]);
  });

  it("reads the share and not the chance, which on a probed body says something else", () => {
    /*
      The sabotage check for the change: these rows would both survive a presence floor — 40 % and
      20 % are well clear of 5 % — and the second is still only 4 % of its genus. If this function
      ever goes back to reading `presenceProbabilityPercent` here, this is the test that says so.
    */
    const ms = [
      match("a_one", 40, { genusSharePercent: 96 }),
      match("a_two", 20, { genusSharePercent: 4 }),
    ];
    demoteBelowPresenceFloor(ms, withDss(), db);
    expect(shownIds(ms)).toEqual(["a_one"]);
  });

  it("still applies the chance floor when the genera are not named", () => {
    const ms = [match("fonticulua_campestris", 97), match("fonticulua_upupam", 2.3)];
    demoteBelowPresenceFloor(ms, body({ genusHints: null }), db);
    expect(shownIds(ms)).toEqual(["fonticulua_campestris"]);
  });
});
