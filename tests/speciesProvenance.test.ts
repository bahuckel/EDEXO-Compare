/**
 * The read-time union, against the data that actually ships.
 *
 * These run on the real `sector-systems.json` and the real `foot_scanned.json` rather than fixtures,
 * because the thing most likely to break here is not the logic — it is the assumption that the two
 * files name species the same way. They do not: the corpus takes its taxon from Spansh's landmark,
 * which puts a structure's colour first, and the species tree puts it last.
 */
import { describe, expect, it } from "vitest";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { sectorSystemsPath, speciesProvenance } from "../src/server/speciesProvenance.js";
import { readFileSync } from "node:fs";
import { loadFootScannedCatalog } from "../src/server/footScannedCatalog.js";

const root = process.cwd();
const db = loadSpeciesDatabaseFromTree(root);
const entryById = (id: string) => db.species.find((e) => e.id === id);

describe("corpus side, at system resolution", () => {
  it("finds a genus-first species where the corpus has one", () => {
    // Sol's neighbourhood is not in the corpus; pick a system the shipped file actually names.
    const aurasus = db.species.find((e) => e.displayName.toLowerCase() === "bacterium aurasus");
    expect(aurasus).toBeTruthy();
    // HIP 64318 is the first system in the shipped drill-down file.
    const p = speciesProvenance(root, 79230486907, 1, aurasus!);
    expect(p.systemInCorpus).toBe(true);
  });

  it("reports a system the corpus has never seen as absent, not as zero-confirmed", () => {
    const any = db.species[0]!;
    const p = speciesProvenance(root, 1, 1, any);
    expect(p.systemInCorpus).toBe(false);
    expect(p.corpusInSystem).toBe(0);
    // The distinction matters: 0 in a known system is evidence, 0 in an unknown one is silence.
  });

  it("resolves structures whose names run the other way round", () => {
    /*
     * The real test of the key, because a broken one fails silently as honest absence.
     *
     * Sweeps every system in the shipped file and counts how many of the 108 species entries the
     * corpus can place anywhere. A genus-then-name key scores every structure at zero — Sinuous
     * Tubers, Brain Trees, Anemones — and nothing about the app looks wrong; the species simply
     * never show corpus support. So this asserts the count, not that a lookup ran.
     */
    const file = JSON.parse(
      readFileSync(sectorSystemsPath(root), "utf8"),
    ) as { cells: Record<string, { key: string }[]> };
    const systems = Object.values(file.cells).flat();
    expect(systems.length).toBeGreaterThan(1000);

    const placed = new Set<string>();
    for (const s of systems) {
      for (const e of db.species) {
        if (placed.has(e.id)) continue;
        if (speciesProvenance(root, Number(s.key), 1, e).corpusInSystem > 0) placed.add(e.id);
      }
    }

    // 100 of the corpus's 110 taxa carry a species row; the other ten are signal-level rows and the
    // Anemone variants the tree has no entry for. Anything far below this means the key broke.
    expect(placed.size).toBeGreaterThanOrEqual(95);

    const tuber = db.species.find((e) => /sinuous tubers/i.test(e.displayName));
    const brain = db.species.find((e) => /brain tree/i.test(e.displayName));
    expect(tuber && placed.has(tuber.id), "a Sinuous Tuber should be placed").toBe(true);
    expect(brain && placed.has(brain.id), "a Brain Tree should be placed").toBe(true);
  });
});

describe("journal side, at body resolution", () => {
  const catalog = loadFootScannedCatalog(root);
  const sample = catalog.entries.find((e) => e.speciesEntryId && entryById(e.speciesEntryId));

  it("has something to test against", () => {
    expect(catalog.entries.length).toBeGreaterThan(0);
    expect(sample, "at least one journal row should resolve to a species entry").toBeTruthy();
  });

  it("claims first-hand only on the exact body that was scanned", () => {
    if (!sample) return;
    const entry = entryById(sample.speciesEntryId)!;
    const hit = speciesProvenance(root, sample.systemAddress, sample.bodyId, entry);
    expect(hit.firstHand).toBe(true);
    expect(hit.firstHandAt).toBeTruthy();

    // Same system, a body that is not the one scanned — must not inherit the claim. This is the
    // whole reason the journal side is kept at body resolution while the corpus side is not.
    const otherBody = speciesProvenance(root, sample.systemAddress, sample.bodyId + 997, entry);
    expect(otherBody.firstHand).toBe(false);
  });

  it("does not claim first-hand for a species the commander did not scan there", () => {
    if (!sample) return;
    const other = db.species.find((e) => e.id !== sample.speciesEntryId)!;
    expect(speciesProvenance(root, sample.systemAddress, sample.bodyId, other).firstHand).toBe(false);
  });

  it("is safe with no body identity at all", () => {
    const any = db.species[0]!;
    expect(() => speciesProvenance(root, null, null, any)).not.toThrow();
    expect(speciesProvenance(root, null, null, any).firstHand).toBe(false);
  });
});
