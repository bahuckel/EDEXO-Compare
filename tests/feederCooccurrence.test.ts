import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setFeederDataDirForTests } from "../src/feeder/paths.js";
import { importCsv, openFeeder, type FeederContext } from "../src/feeder/pipeline.js";
import { buildCooccurrenceTable, writeCooccurrenceTable } from "../src/feeder/cooccurrence.js";
import {
  clearGenusCooccurrenceCacheForTests,
  loadGenusCooccurrenceTable,
} from "../src/server/genusCooccurrenceTable.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HEADER = "System Name,Body Name,Body Subtype,Distance To Arrival,Landmark Subtype,Value,Count\n";

let corpus: string;
let ctx: FeederContext;
const db = loadSpeciesDatabaseFromTree(repoRoot);

function csv(rows: string[]): string {
  const p = path.join(corpus, `import-${Math.random().toString(36).slice(2)}.csv`);
  writeFileSync(p, HEADER + rows.join("\n") + "\n", "utf8");
  return p;
}

beforeEach(async () => {
  corpus = mkdtempSync(path.join(tmpdir(), "edexo-cooc-"));
  setFeederDataDirForTests(corpus);
  ctx = await openFeeder();
});

afterEach(() => {
  ctx?.store.close();
  setFeederDataDirForTests(null);
  clearGenusCooccurrenceCacheForTests();
  rmSync(corpus, { recursive: true, force: true });
});

describe("buildCooccurrenceTable", () => {
  it("counts a body once per genus, whatever the species", async () => {
    await importCsv(
      ctx,
      csv([
        "Sol,Sol 4 a,Rocky body,120,Bacterium Aurasus,1000,1",
        "Sol,Sol 4 a,Rocky body,120,Bacterium Vesicula,1000,1",
        "Sol,Sol 4 a,Rocky body,120,Stratum Tectonicas,19010800,1",
        "Sol,Sol 5 b,Rocky body,90,Bacterium Aurasus,1000,1",
      ]),
    );
    const r = buildCooccurrenceTable(ctx.store.db, db);
    expect(r.bodies).toBe(2);
    expect(r.table.genera.bacterium!.bodies).toBe(2);
    expect(r.table.genera.stratum!.bodies).toBe(1);
    expect(r.table.pairs["bacterium|stratum"]).toBe(1);
    expect(r.multiGenusBodies).toBe(1);
  });

  /**
   * The corpus calls the colour variants their own genus — Spansh's landmark subtype makes "Aureum
   * Brain Tree" a genus called `Aureum`, eleven colour words against two real genera. Keyed that way
   * the table would never join to the matcher, so every label goes through the installer's own
   * resolver on the way in.
   */
  it("keys on the app's genus, not on the corpus' first word", async () => {
    await importCsv(
      ctx,
      csv([
        "Sol,Sol 6 a,Rocky body,10,Aureum Brain Tree,2000,1",
        "Sol,Sol 6 a,Rocky body,10,Bacterium Aurasus,1000,1",
      ]),
    );
    const r = buildCooccurrenceTable(ctx.store.db, db);
    expect(Object.keys(r.table.genera).sort()).toEqual(["bacterium", "brain-tree"]);
    expect(r.table.pairs["bacterium|brain-tree"]).toBe(1);
  });

  /**
   * The Anemone colour variants and Bark Mounds have no species row to resolve to. Dropping them
   * silently would leave a table that quietly disagrees with the corpus about how many bodies it saw.
   */
  it("names the labels it could not map instead of dropping them quietly", async () => {
    await importCsv(
      ctx,
      csv([
        "Sol,Sol 7 a,Rocky body,10,Croceum Anemone,2000,1",
        "Sol,Sol 7 a,Rocky body,10,Bacterium Aurasus,1000,1",
      ]),
    );
    const r = buildCooccurrenceTable(ctx.store.db, db);
    expect(r.table.unmappedLabels).toContain("Croceum Anemone");
    expect(r.unmappedSightings).toBe(1);
    expect(r.table.genera.bacterium!.bodies).toBe(1);
  });
});

describe("loadGenusCooccurrenceTable", () => {
  it("round-trips what the feeder wrote", async () => {
    await importCsv(
      ctx,
      csv([
        "Sol,Sol 4 a,Rocky body,120,Bacterium Aurasus,1000,1",
        "Sol,Sol 4 a,Rocky body,120,Stratum Tectonicas,19010800,1",
      ]),
    );
    const built = buildCooccurrenceTable(ctx.store.db, db);
    const file = writeCooccurrenceTable(built.table, corpus);
    expect(JSON.parse(readFileSync(file, "utf8")).formatVersion).toBe(1);

    const loaded = loadGenusCooccurrenceTable(corpus)!;
    expect(loaded.bodies).toBe(1);
    expect(loaded.pairs["bacterium|stratum"]).toBe(1);
  });

  /**
   * A checkout with no table has to match, rank and pay out exactly as it did before — the table is
   * an ordering, never a gate.
   */
  it("returns null when there is no table, rather than throwing", () => {
    expect(loadGenusCooccurrenceTable(path.join(corpus, "nowhere"))).toBeNull();
  });

  it("refuses a file from a future format version", () => {
    const dir = path.join(corpus, "future", "data", "exomastery");
    writeCooccurrenceTable(
      { ...buildCooccurrenceTable(ctx.store.db, db).table, formatVersion: 2 as 1 },
      path.join(corpus, "future"),
    );
    expect(readFileSync(path.join(dir, "genus-cooccurrence.json"), "utf8")).toContain('"formatVersion": 2');
    expect(loadGenusCooccurrenceTable(path.join(corpus, "future"))).toBeNull();
  });
});
