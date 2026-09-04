import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setFeederDataDirForTests } from "../src/feeder/paths.js";
import { importCsv, openFeeder, type FeederContext } from "../src/feeder/pipeline.js";
import { parseSpanshExobiologyCsv } from "../src/feeder/csvImport.js";

let corpus: string;
let ctx: FeederContext;

const HEADER = "System Name,Body Name,Body Subtype,Distance To Arrival,Landmark Subtype,Value,Count\n";

function csv(rows: string[]): string {
  const p = path.join(corpus, `import-${rows.length}-${Math.random().toString(36).slice(2)}.csv`);
  writeFileSync(p, HEADER + rows.join("\n") + "\n", "utf8");
  return p;
}

beforeEach(async () => {
  corpus = mkdtempSync(path.join(tmpdir(), "edexo-corpus-"));
  setFeederDataDirForTests(corpus);
  ctx = await openFeeder();
});

afterEach(() => {
  ctx?.store.close();
  setFeederDataDirForTests(null);
  rmSync(corpus, { recursive: true, force: true });
});

describe("parseSpanshExobiologyCsv", () => {
  it("keeps rows with the three columns that matter and drops the rest", () => {
    const rows = parseSpanshExobiologyCsv(
      HEADER +
        "Sol,Sol 4 a,High metal content body,120,Stratum Tectonicas,19010800,1\n" +
        ",Nowhere 1,Rocky body,5,Bacterium Aurasus,1000,1\n" +
        "Sol,Sol 5 b,Rocky body,90,,1000,1\n",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.systemName).toBe("Sol");
    expect(rows[0]!.landmarkSubtype).toBe("Stratum Tectonicas");
  });
});

/**
 * The import has to answer one question: which species need rebuilding. Rebuilding everything after
 * every CSV would mean re-fetching tens of thousands of systems from EDSM for data that did not
 * change.
 */
describe("importCsv", () => {
  it("reports the species a first import introduced", async () => {
    const r = await importCsv(
      ctx,
      csv([
        "Sol,Sol 4 a,High metal content body,120,Stratum Tectonicas,19010800,1",
        "Sol,Sol 5 b,Rocky body,90,Bacterium Aurasus,1000,1",
      ]),
    );
    expect(r.rowsInFile).toBe(2);
    expect(r.speciesTotal).toBe(2);
    expect(r.newSpeciesLabels).toEqual(["Bacterium Aurasus", "Stratum Tectonicas"]);
    expect(r.newOccurrences).toBe(2);
    expect(r.touchedSpecies).toEqual(["Bacterium Aurasus", "Stratum Tectonicas"]);
  });

  it("touches only the species that gained an occurrence", async () => {
    await importCsv(
      ctx,
      csv([
        "Sol,Sol 4 a,High metal content body,120,Stratum Tectonicas,19010800,1",
        "Sol,Sol 5 b,Rocky body,90,Bacterium Aurasus,1000,1",
      ]),
    );
    const second = await importCsv(
      ctx,
      csv([
        // Same Stratum body again — no new evidence, so nothing to rebuild for it.
        "Sol,Sol 4 a,High metal content body,120,Stratum Tectonicas,19010800,1",
        "Alpha Centauri,AC 2 c,Rocky body,44,Bacterium Aurasus,1000,1",
      ]),
    );
    expect(second.newSpeciesLabels).toEqual([]);
    expect(second.newOccurrences).toBe(1);
    expect(second.touchedSpecies).toEqual(["Bacterium Aurasus"]);
  });

  it("counts an occurrence once however many times it is imported", async () => {
    const rows = ["Sol,Sol 4 a,High metal content body,120,Stratum Tectonicas,19010800,1"];
    await importCsv(ctx, csv(rows));
    await importCsv(ctx, csv(rows));
    await importCsv(ctx, csv(rows));
    expect(ctx.speciesIndex["Stratum Tectonicas"]!.occurrences).toHaveLength(1);
    // Cumulative rows still counts every line imported — that is the corpus's own odometer.
    expect(ctx.cumulativeCsvRows).toBe(3);
  });

  it("refuses a CSV with none of the columns it needs, rather than importing nothing quietly", async () => {
    const p = path.join(corpus, "wrong.csv");
    writeFileSync(p, "a,b,c\n1,2,3\n", "utf8");
    await expect(importCsv(ctx, p)).rejects.toThrow(/System Name/);
  });
});
