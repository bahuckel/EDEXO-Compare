/**
 * INCLUDE-BODY-IDS Phase 8 — the importer's four gates, and the mapping rule behind them.
 *
 * The gates exist because the failure mode is silent: a rounded id64 does not throw, does not fail a
 * test, and does not look wrong. It simply joins to nothing, or to the wrong body. Each test below
 * feeds a file that is wrong in exactly one way.
 */
import { gzipSync } from "node:zlib";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setFeederDataDirForTests } from "../src/feeder/paths.js";
import { importCsv, openFeeder, type FeederContext } from "../src/feeder/pipeline.js";
import { backfillBodyIdentity } from "../src/feeder/bodyIdentityBackfill.js";
import {
  EXPECTED_PROBE_ID64,
  bodyIsMapped,
  bodySignalsSeenAt,
  importSpanshExport,
} from "../src/feeder/spanshImport.js";
import { bodyId64From } from "../src/feeder/bigIntJson.js";

const HEADER = "System Name,Body Name,Body Subtype,Distance To Arrival,Landmark Subtype,Value,Count\n";
const ROW = "18 Andromedae,18 Andromedae 8 a,Rocky body,3940,Osseus Discus,19010000,1";
const SYS_ID64 = "78611735724";
const BODY_ID = 23;
const BODY_ID64 = bodyId64From(SYS_ID64, BODY_ID);

const SYSTEM_FIELDS = ["kind", "id64", "name", "coords"];
const BODY_FIELDS = ["kind", "id64", "systemId64", "bodyId", "name", "signals", "mappedBy"];

let corpus: string;
let ctx: FeederContext;

function manifest(over: Record<string, unknown> = {}) {
  return {
    kind: "manifest",
    schemaVersion: 1,
    source: "galaxy_1day.json.gz",
    probe: { id64: EXPECTED_PROBE_ID64 },
    fields: { system: SYSTEM_FIELDS, body: BODY_FIELDS },
    ...over,
  };
}

const systemRow = (over: Record<string, unknown> = {}) => ({
  kind: "system",
  id64: SYS_ID64,
  name: "18 Andromedae",
  coords: { x: -384.625, y: -77.5625, z: -153.78125 },
  ...over,
});

const bodyRow = (over: Record<string, unknown> = {}) => ({
  kind: "body",
  id64: BODY_ID64,
  systemId64: SYS_ID64,
  bodyId: BODY_ID,
  name: "18 Andromedae 8 a",
  signals: {
    signals: { "$SAA_SignalType_Biological;": 1 },
    genuses: ["$Codex_Ent_Osseus_Genus_Name;"],
    updateTime: "2026-09-04 22:55:03+00",
  },
  mappedBy: null,
  ...over,
});

function exportFile(rows: object[]): string {
  const p = path.join(corpus, `export-${Math.random().toString(36).slice(2)}.jsonl.gz`);
  writeFileSync(p, gzipSync(Buffer.from(rows.map((r) => JSON.stringify(r)).join("\n"), "utf8")));
  return p;
}

/** A corpus with one body that Phase 1 has already given an identity. */
async function seedIdentifiedCorpus(): Promise<void> {
  await importCsv(ctx, (() => {
    const p = path.join(corpus, "in.csv");
    writeFileSync(p, HEADER + ROW + "\n", "utf8");
    return p;
  })());
  ctx.store.setSystemId64([{ normSystem: "18 andromedae", id64: SYS_ID64, edsmId: 15695809 }]);
  const rows = ctx.store.planetIdentityRows();
  ctx.store.setBodyIdentity([{ planetId: rows[0]!.planetId, bodyId: BODY_ID, edsmId: 10904346 }]);
  ctx.store.persist();
}

beforeEach(async () => {
  corpus = mkdtempSync(path.join(tmpdir(), "edexo-import-"));
  setFeederDataDirForTests(corpus);
  ctx = await openFeeder();
});

afterEach(() => {
  ctx?.store.close();
  setFeederDataDirForTests(null);
  rmSync(corpus, { recursive: true, force: true });
});

describe("mapping comes from genuses, never from mappedBy", () => {
  it("a genus list proves a DSS map", () => {
    expect(bodyIsMapped(bodyRow())).toBe(true);
  });

  it("a signal count with no genera is not proof of mapping", () => {
    expect(bodyIsMapped(bodyRow({ signals: { signals: { "$SAA_SignalType_Biological;": 1 } } }))).toBe(false);
    expect(bodyIsMapped(bodyRow({ signals: null }))).toBe(false);
  });

  it("normalises Spansh's timestamp into something comparable with a journal one", () => {
    expect(bodySignalsSeenAt(bodyRow())).toBe("2026-09-04T22:55:03Z");
    expect(bodySignalsSeenAt(bodyRow({ signals: { genuses: ["x"] } }))).toBeNull();
  });
});

describe("the four gates", () => {
  it("imports a conforming file and joins on identity alone", async () => {
    await seedIdentifiedCorpus();
    const f = exportFile([manifest(), systemRow(), bodyRow()]);
    const r = await importSpanshExport(ctx.store, f, { apply: true });
    expect(r.failures).toEqual([]);
    expect(r.matched).toBe(1);
    expect(r.mappedTrue).toBe(1);
    expect(r.coverage.mapped).toBe(1);
  });

  it("gate 1 — a probe that did not survive the trip aborts the whole file", async () => {
    await seedIdentifiedCorpus();
    // The probe as a number is exactly what a JSON.parse somewhere upstream would produce.
    const f = exportFile([manifest({ probe: { id64: 6160925022241180003 } }), systemRow(), bodyRow()]);
    const r = await importSpanshExport(ctx.store, f, { apply: true });
    expect(r.failures.join(" ")).toMatch(/probe id64/);
    expect(r.coverage.mapped).toBe(0); // nothing written
  });

  it("gate 2 — a renamed column fails at the door instead of being ignored", async () => {
    await seedIdentifiedCorpus();
    const renamed = { ...bodyRow(), bodyID: BODY_ID } as Record<string, unknown>;
    delete renamed.bodyId;
    const f = exportFile([manifest(), systemRow(), renamed]);
    const r = await importSpanshExport(ctx.store, f, { apply: true });
    expect(r.failures.join(" ")).toMatch(/key list deviates/);
    expect(r.coverage.mapped).toBe(0);
  });

  it("gate 3 — an id64 that fails the shift identity is refused", async () => {
    await seedIdentifiedCorpus();
    const f = exportFile([manifest(), systemRow(), bodyRow({ id64: "828662410047907000" })]);
    const r = await importSpanshExport(ctx.store, f, { apply: true });
    expect(r.failures.join(" ")).toMatch(/fails systemId64/);
    expect(r.coverage.mapped).toBe(0);
  });

  it("gate 4 — an id-shaped field carrying a bare big integer fails", async () => {
    await seedIdentifiedCorpus();
    const f = exportFile([manifest(), systemRow(), bodyRow({ id64: 6160925022241180003 })]);
    const r = await importSpanshExport(ctx.store, f, { apply: true });
    expect(r.failures.join(" ")).toMatch(/expected a decimal string/);
  });

  /**
   * The contract claims no plain integer exceeds 2^53. It does — `belts[].mass` reaches 1.26e18 in
   * the real sample. A belt's mass is a quantity, not an identity, so this warns rather than
   * refuses; rejecting a sound file over it would be the gate doing harm.
   */
  it("gate 4 — an oversized integer in a quantity field warns but does not refuse", async () => {
    await seedIdentifiedCorpus();
    const fields = { system: SYSTEM_FIELDS, body: [...BODY_FIELDS, "belts"] };
    const f = exportFile([
      manifest({ fields }),
      systemRow(),
      { ...bodyRow(), belts: [{ name: "Belt A", mass: 1260200000000000000 }] },
    ]);
    const r = await importSpanshExport(ctx.store, f, { apply: true });
    expect(r.failures).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/beyond 2\^53/);
    expect(r.coverage.mapped).toBe(1); // still imported
  });

  it("refuses a file that cannot describe itself", async () => {
    await seedIdentifiedCorpus();
    const f = exportFile([systemRow(), bodyRow()]);
    const r = await importSpanshExport(ctx.store, f, { apply: true });
    expect(r.failures.join(" ")).toMatch(/first line is not a manifest/);
  });
});

describe("what it writes", () => {
  it("a dry run writes nothing", async () => {
    await seedIdentifiedCorpus();
    const f = exportFile([manifest(), systemRow(), bodyRow()]);
    const r = await importSpanshExport(ctx.store, f, { apply: false });
    expect(r.matched).toBe(1);
    expect(r.planetsWritten).toBe(0);
    expect(r.coverage.mapped).toBe(0);
  });

  it("is idempotent — a second import reports the match but changes nothing", async () => {
    await seedIdentifiedCorpus();
    const f = exportFile([manifest(), systemRow(), bodyRow()]);
    await importSpanshExport(ctx.store, f, { apply: true });
    const again = await importSpanshExport(ctx.store, f, { apply: true });
    expect(again.matched).toBe(1);
    expect(again.changed).toBe(0);
    expect(again.planetsWritten).toBe(0);
  });

  /** The sticky rule, enforced in SQL as well as in the queue. */
  it("a later 'no evidence of mapping' never clears a stored true", async () => {
    await seedIdentifiedCorpus();
    await importSpanshExport(ctx.store, exportFile([manifest(), systemRow(), bodyRow()]), { apply: true });
    expect(ctx.store.mappedCoverage().mapped).toBe(1);

    const unmapped = bodyRow({ signals: { signals: { "$SAA_SignalType_Biological;": 1 }, updateTime: "2026-09-05 00:00:00+00" } });
    await importSpanshExport(ctx.store, exportFile([manifest(), systemRow(), unmapped]), { apply: true });
    expect(ctx.store.mappedCoverage().mapped).toBe(1);
    expect(ctx.store.mappedCoverage().unmapped).toBe(0);
  });

  it("ignores a dump body the corpus does not hold — it never inserts", async () => {
    await seedIdentifiedCorpus();
    const before = ctx.store.getStats().uniquePlanets;
    const other = bodyRow({ bodyId: 99, id64: bodyId64From(SYS_ID64, 99), name: "18 Andromedae 9" });
    const r = await importSpanshExport(ctx.store, exportFile([manifest(), systemRow(), other]), { apply: true });
    expect(r.matched).toBe(0);
    expect(ctx.store.getStats().uniquePlanets).toBe(before);
  });

  it("a body the corpus never identified cannot be joined, and is skipped rather than name-matched", async () => {
    // No Phase 1 backfill: the planet row exists but has no body_id.
    const p = path.join(corpus, "in.csv");
    writeFileSync(p, HEADER + ROW + "\n", "utf8");
    await importCsv(ctx, p);
    await backfillBodyIdentity(ctx.store, { apply: true }); // no archives, so nothing to fill
    const r = await importSpanshExport(ctx.store, exportFile([manifest(), systemRow(), bodyRow()]), {
      apply: true,
    });
    expect(r.matched).toBe(0);
  });
});
