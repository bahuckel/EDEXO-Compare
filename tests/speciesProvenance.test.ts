/**
 * The read-time union, against the data that actually ships.
 *
 * The corpus side runs on the real `sector-systems.json` rather than a fixture, because the thing
 * most likely to break there is not the logic — it is the assumption that the two sides name species
 * the same way. They do not: the corpus takes its taxon from Spansh's landmark, which puts a
 * structure's colour first, and the species tree puts it last.
 *
 * The journal side used to read the real `data/foot_scanned.json` for the same reason, and that was
 * wrong twice over once the catalog moved beside the user settings: the test would read whatever the
 * commander running it happens to have scanned, and merely loading it would **carry their catalog
 * into their real user-data directory** as a side effect. It writes its own row into an isolated
 * `EDEXO_USER_DATA_DIR` now, so the assertions hold on a fresh checkout too.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { sectorSystemsPath, speciesProvenance } from "../src/server/speciesProvenance.js";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  clearFootScannedCatalogCache,
  loadFootScannedCatalog,
  resetFootScannedCarryOver,
} from "../src/server/footScannedCatalog.js";
import { resolveFootScannedPath } from "../src/server/paths.js";

const root = process.cwd();

/*
  Isolated for the whole file, not just the block that seeds a row.

  `speciesProvenance` loads the catalog itself, so the corpus-side cases reach it too — and with the
  isolation scoped to one `describe`, running this file copied the developer's own catalog into their
  real user-data directory before that block ever ran. Env is read on every call, so setting it here,
  above every `describe`, covers all of them.
*/
const userDir = mkdtempSync(join(tmpdir(), "edexo-provenance-"));
const priorUserDataDir = process.env.EDEXO_USER_DATA_DIR;
process.env.EDEXO_USER_DATA_DIR = userDir;
resetFootScannedCarryOver();
clearFootScannedCatalogCache();

afterAll(() => {
  if (priorUserDataDir === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = priorUserDataDir;
  resetFootScannedCarryOver();
  clearFootScannedCatalogCache();
  rmSync(userDir, { recursive: true, force: true });
});
const db = loadSpeciesDatabaseFromTree(root);
const entryById = (id: string | null | undefined) =>
  id == null ? undefined : db.species.find((e) => e.id === id);

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
    const file = JSON.parse(readFileSync(sectorSystemsPath(root), "utf8")) as {
      cells: Record<string, { key: string }[]>;
    };
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
  const scanned = db.species.find((e) => e.displayName.toLowerCase() === "bacterium aurasus")!;
  const sample = {
    speciesEntryId: scanned.id,
    systemAddress: 7267487678611,
    bodyId: 21,
  };

  beforeAll(() => {
    writeFileSync(
      resolveFootScannedPath(),
      JSON.stringify({
        formatVersion: 1,
        entries: [
          {
            id: `${sample.systemAddress}:${sample.bodyId}:fixture`,
            recordedAt: "2026-01-01T00:00:00Z",
            confirmationSource: "analyse",
            starSystem: "Fixture Sector AA-A h0",
            systemAddress: sample.systemAddress,
            bodyId: sample.bodyId,
            bodyName: "Fixture Sector AA-A h0 1",
            speciesLocalised: scanned.displayName,
            speciesEntryId: scanned.id,
          },
        ],
      }),
      "utf8",
    );
  });

  afterAll(() => {
    clearFootScannedCatalogCache();
  });

  it("has something to test against", () => {
    const catalog = loadFootScannedCatalog(root);
    expect(catalog.entries.length).toBeGreaterThan(0);
    expect(entryById(catalog.entries[0]!.speciesEntryId), "the row should resolve to a species").toBeTruthy();
  });

  it("claims first-hand only on the exact body that was scanned", () => {
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
    const other = db.species.find((e) => e.id !== sample.speciesEntryId)!;
    expect(speciesProvenance(root, sample.systemAddress, sample.bodyId, other).firstHand).toBe(false);
  });

  it("is safe with no body identity at all", () => {
    const any = db.species[0]!;
    expect(() => speciesProvenance(root, null, null, any)).not.toThrow();
    expect(speciesProvenance(root, null, null, any).firstHand).toBe(false);
  });
});
