/**
 * A composition scan confirms a plant on a body, and says so.
 *
 * The owner's ask: *"Events like `CodexEntry` done by the composition scanner should also count as
 * confirmation, some plants are hard to land near. So just give them a [Comp Scan] badge."*
 *
 * The line carries both halves of the fact — what and where:
 *
 * ```
 * "event":"CodexEntry", "Name_Localised":"Fonticulua Fluctus - Amethyst",
 * "SystemAddress":11666607646129, "BodyID":13
 * ```
 *
 * so it resolves to the same `OrganicGenusLock` a `ScanOrganic` builds, carrying `source: "codex"`.
 * Everything already reading those locks — the matcher's narrowing, the worth-sampling count, the
 * chance floor's immunity, the discoveries tables — then treats it as the confirmation it is,
 * without any of them being taught about the codex.
 *
 * On his own 275 journals this adds **7** body+species pairs that no `ScanOrganic` covers. Small, and
 * the point is forward: it is the plants he cannot land near.
 *
 * The two traps this pins:
 *
 *  - **Category is not enough.** `$Codex_Category_Biology;` localises to "Biological and Geological",
 *    so reading the category alone lets a fumarole confirm a plant. The subcategory is the test.
 *  - **A genus is not a species.** "Bacterium" on its own would resolve to nothing useful, and a lock
 *    that vague is worse than none.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { codexOrganicLockFromLine } from "../src/shared/codexLog.js";
import type { JournalLine } from "../src/shared/types.js";

const SYS = 11_666_607_646_129;

function codex(over: Record<string, unknown> = {}): JournalLine {
  return {
    timestamp: "2026-09-20T00:00:00Z",
    event: "CodexEntry",
    EntryID: 2370507,
    Name: "$Codex_Ent_Fonticulus_05_M_Name;",
    Name_Localised: "Fonticulua Fluctus - Amethyst",
    SubCategory: "$Codex_SubCategory_Organic_Structures;",
    SubCategory_Localised: "Organic structures",
    Category: "$Codex_Category_Biology;",
    Category_Localised: "Biological and Geological",
    System: "Sesuang",
    SystemAddress: SYS,
    BodyID: 13,
    IsNewEntry: true,
    ...over,
  } as unknown as JournalLine;
}

const locksOn = (store: GameStateStore, bodyId = 13) =>
  store.bodies.get(`${SYS}:${bodyId}`)?.organicGenusLocks ?? [];

describe("reading the line", () => {
  it("names the genus, the species and the variant", () => {
    const lock = codexOrganicLockFromLine(codex() as never);
    expect(lock).toEqual({
      genusLocalised: "Fonticulua",
      genusSymbol: "",
      speciesLocalised: "Fonticulua Fluctus",
      speciesSymbol: "",
      variantLocalised: "Fonticulua Fluctus - Amethyst",
      source: "codex",
    });
  });

  it("refuses a geological entry", () => {
    /*
      The category says "Biological and Geological" for both, so this is the whole guard. A sulphur
      dioxide fumarole confirming a plant would be a confirmation the commander never made.
    */
    const lock = codexOrganicLockFromLine(
      codex({
        Name_Localised: "Sulphur Dioxide Fumarole",
        SubCategory: "$Codex_SubCategory_Geology_and_Anomalies;",
        SubCategory_Localised: "Geology and anomalies",
      }) as never,
    );
    expect(lock).toBeNull();
  });

  it("refuses a name with no species in it", () => {
    expect(codexOrganicLockFromLine(codex({ Name_Localised: "Bacterium" }) as never)).toBeNull();
  });

  it("refuses anything that is not a codex line", () => {
    expect(codexOrganicLockFromLine(codex({ event: "Scan" }) as never)).toBeNull();
  });
});

describe("what the store does with it", () => {
  it("confirms the species on the body the scanner named", () => {
    const store = new GameStateStore();
    store.apply(codex());
    const locks = locksOn(store);
    expect(locks).toHaveLength(1);
    expect(locks[0]!.speciesLocalised).toBe("Fonticulua Fluctus");
    expect(locks[0]!.source).toBe("codex");
    expect(store.bodies.get(`${SYS}:13`)?.confirmedVariants).toContain("Fonticulua Fluctus - Amethyst");
  });

  it("writes one row however many times the scanner fires", () => {
    // A comp scan writes a line on the new entry, again on the voucher, and again on a re-scan.
    const store = new GameStateStore();
    store.apply(codex());
    store.apply(codex({ IsNewEntry: undefined, VoucherAmount: 2500 }));
    store.apply(codex({ IsNewEntry: undefined }));
    expect(locksOn(store)).toHaveLength(1);
  });

  it("keeps the bodies apart", () => {
    const store = new GameStateStore();
    store.apply(codex({ BodyID: 13 }));
    store.apply(codex({ BodyID: 21, Name_Localised: "Bacterium Aurasus - Lime" }));
    expect(locksOn(store, 13).map((l) => l.speciesLocalised)).toEqual(["Fonticulua Fluctus"]);
    expect(locksOn(store, 21).map((l) => l.speciesLocalised)).toEqual(["Bacterium Aurasus"]);
  });

  it("ignores a line with no body on it", () => {
    // Some codex lines are written about a region rather than a body; they confirm nothing here.
    const store = new GameStateStore();
    store.apply(codex({ BodyID: undefined }));
    expect(store.bodies.size).toBe(0);
  });

  it("does not let a geological entry confirm a plant", () => {
    const store = new GameStateStore();
    store.apply(
      codex({
        Name_Localised: "Sulphur Dioxide Fumarole",
        SubCategory: "$Codex_SubCategory_Geology_and_Anomalies;",
      }),
    );
    expect(locksOn(store)).toHaveLength(0);
  });

  it("still fills the codex-hunter set, which is about the commander and not the body", () => {
    const store = new GameStateStore();
    store.apply(codex());
    expect(store.codexLoggedSpecies.has("fonticulua fluctus")).toBe(true);
  });

  it("leaves a foot scan of the same species as the one confirmation", () => {
    /*
      A `ScanOrganic` says everything the comp scan does and also that he could get down to it, so
      the badge is only for species with no foot scan. One row, and it is the foot one that was
      there first.
    */
    const store = new GameStateStore();
    store.apply({
      timestamp: "2026-09-20T00:00:00Z",
      event: "ScanOrganic",
      ScanType: "Log",
      Genus: "$Codex_Ent_Fonticulua_Genus_Name;",
      Genus_Localised: "Fonticulua",
      Species: "$Codex_Ent_Fonticulus_05_Name;",
      Species_Localised: "Fonticulua Fluctus",
      Variant: "$Codex_Ent_Fonticulus_05_M_Name;",
      Variant_Localised: "Fonticulua Fluctus - Amethyst",
      SystemAddress: SYS,
      Body: 13,
    } as unknown as JournalLine);
    store.apply(codex());
    const locks = locksOn(store);
    expect(locks).toHaveLength(1);
    expect(locks[0]!.source).toBeUndefined();
  });
});
