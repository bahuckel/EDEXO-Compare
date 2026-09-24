/**
 * The per-genus progress the guild asked for: `Genus [CS]`, `Genus [SEEN]`, `Genus [1/3]`…`[3/3]`,
 * and one on-foot line per species instead of one per ScanOrganic.
 */
import { describe, expect, it } from "vitest";
import { bodyGenusProgress, genusProgressTag } from "../src/shared/genusProgress.js";
import { GameStateStore, upsertFootOrganicLock } from "../src/server/gameState.js";
import type { GenusHint, JournalLine, OrganicGenusLock } from "../src/shared/types.js";

const SA = 123456789;
const BODY = 7;

const organic = (scanType: string, species: string, genus: string, colour = "Green"): JournalLine =>
  ({
    timestamp: "2026-09-24T12:00:00Z",
    event: "ScanOrganic",
    ScanType: scanType,
    Genus: `$Codex_Ent_${genus}_Genus_Name;`,
    Genus_Localised: genus,
    Species: `$Codex_Ent_${genus}_01_Name;`,
    Species_Localised: `${genus} ${species}`,
    Variant: `$Codex_Ent_${genus}_01_${colour}_Name;`,
    Variant_Localised: `${genus} ${species} - ${colour}`,
    SystemAddress: SA,
    Body: BODY,
  }) as unknown as JournalLine;

const hint = (genus: string): GenusHint =>
  ({ Genus: `$Codex_Ent_${genus}_Genus_Name;`, Genus_Localised: genus }) as GenusHint;

function footLock(genus: string, species: string, over: Partial<OrganicGenusLock> = {}): OrganicGenusLock {
  return {
    genusLocalised: genus,
    genusSymbol: `$Codex_Ent_${genus}_Genus_Name;`,
    speciesLocalised: `${genus} ${species}`,
    speciesSymbol: "",
    variantLocalised: `${genus} ${species} - Green`,
    ...over,
  };
}

describe("one lock per species, carrying its samples", () => {
  it("counts Log, Sample, Sample, Analyse as 1, 2, 3 and analysed — on one lock", () => {
    const locks: OrganicGenusLock[] = [];
    const seen: number[] = [];
    for (const t of ["Log", "Sample", "Sample"]) {
      upsertFootOrganicLock(locks, footLock("Stratum", "Limaxus"), t);
      seen.push(locks[0]!.samples!);
    }
    expect(seen).toEqual([1, 2, 3]);
    expect(locks[0]!.analysed).toBeUndefined();
    upsertFootOrganicLock(locks, footLock("Stratum", "Limaxus"), "Analyse");
    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatchObject({ samples: 3, analysed: true });
  });

  it("replaces a comp-scan lock for the same species with the foot scan", () => {
    const locks: OrganicGenusLock[] = [
      {
        ...footLock("Stratum", "Limaxus"),
        genusSymbol: "",
        source: "codex",
        variantLocalised: "Stratum Limaxus - Green",
      },
    ];
    upsertFootOrganicLock(locks, footLock("Stratum", "Limaxus"), "Log");
    expect(locks).toHaveLength(1);
    expect(locks[0]!.source).toBeUndefined();
    expect(locks[0]!.samples).toBe(1);
  });

  it("the guild's body: Stratum twice becomes once, through the store", () => {
    const store = new GameStateStore();
    store.apply({
      timestamp: "2026-09-24T11:59:00Z",
      event: "CodexEntry",
      EntryID: 2420401,
      Name: "$Codex_Ent_Stratum_01_Green_Name;",
      Name_Localised: "Stratum Limaxus - Green",
      SubCategory: "$Codex_SubCategory_Organic_Structures;",
      SubCategory_Localised: "Organic structures",
      Category: "$Codex_Category_Biology;",
      Category_Localised: "Biological and Geological",
      Region: "$Codex_RegionName_18;",
      System: "Test",
      SystemAddress: SA,
      BodyID: BODY,
    } as unknown as JournalLine);
    for (const t of ["Log", "Sample", "Sample", "Analyse"]) store.apply(organic(t, "Limaxus", "Stratum"));
    store.apply(organic("Log", "Aurasus", "Bacterium", "Teal"));
    const locks = store.bodies.get(`${SA}:${BODY}`)!.organicGenusLocks;
    expect(locks.map((l) => l.speciesLocalised)).toEqual(["Stratum Limaxus", "Bacterium Aurasus"]);
    expect(locks[0]).toMatchObject({ analysed: true, samples: 3 });
    expect(locks[1]).toMatchObject({ samples: 1 });
  });
});

describe("genus rows and their tags", () => {
  it("tags each genus by how far it got", () => {
    const rows = bodyGenusProgress(
      [hint("Stratum"), hint("Bacterium"), hint("Tussock"), hint("Fungoida"), hint("Osseus")],
      [
        footLock("Stratum", "Limaxus", { samples: 3, analysed: true }),
        footLock("Bacterium", "Aurasus", { samples: 2 }),
        footLock("Tussock", "Pennata", { samples: 1 }),
        { ...footLock("Fungoida", "Setisis"), genusSymbol: "", source: "codex" },
      ],
      { speciesDisplay: "Tussock Pennata - Green", sampleCount: 1 },
    );
    expect(rows.map((r) => `${r.genus} ${genusProgressTag(r)}`.trim())).toEqual([
      "Stratum [3/3]",
      "Bacterium [SEEN]",
      "Tussock [1/3]",
      "Fungoida [CS]",
      "Osseus",
    ]);
  });

  it("shows the live count, not the stored one, while sampling", () => {
    const rows = bodyGenusProgress(null, [footLock("Bacterium", "Aurasus", { samples: 1 })], {
      speciesDisplay: "Bacterium Aurasus",
      sampleCount: 2,
    });
    expect(genusProgressTag(rows[0]!)).toBe("[2/3]");
  });

  it("a genus scanned without a DSS still gets a row", () => {
    const rows = bodyGenusProgress(null, [footLock("Stratum", "Limaxus", { samples: 1 })], null);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ genus: "Stratum", status: "seen", species: "Stratum Limaxus" });
  });

  it("a lock copied from a sibling moon names nothing here", () => {
    const rows = bodyGenusProgress(
      [hint("Stratum")],
      [footLock("Stratum", "Limaxus", { fromSibling: true })],
      null,
    );
    expect(rows[0]).toMatchObject({ status: "dss", species: null });
    expect(genusProgressTag(rows[0]!)).toBe("");
  });

  it("the strongest lock on a genus names the row", () => {
    const rows = bodyGenusProgress(
      [hint("Stratum")],
      [
        { ...footLock("Stratum", "Limaxus"), source: "codex" },
        footLock("Stratum", "Limaxus", { samples: 3, analysed: true }),
      ],
      null,
    );
    expect(rows).toHaveLength(1);
    expect(genusProgressTag(rows[0]!)).toBe("[3/3]");
  });
});
