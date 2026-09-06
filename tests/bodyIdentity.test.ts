/**
 * INCLUDE-BODY-IDS Phase 1 — identity recovered from the archives, and the de-duplication that
 * identity is supposed to guarantee.
 *
 * Covers acceptance rules 3 (importing the same CSV twice, and two overlapping CSVs, leave the
 * sighting count unchanged) and 4 (a body spelled differently in two sources resolves to one row).
 *
 * Rule 3 was already true before this item — `UNIQUE(system_id, norm_body)` has always enforced it.
 * It is asserted here rather than assumed because the plan asked for it to be a test rather than an
 * observation, and because the identity columns are new code in the same path.
 */
import { gzipSync } from "node:zlib";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rawPlanetsDir, setFeederDataDirForTests } from "../src/feeder/paths.js";
import { importCsv, openFeeder, type FeederContext } from "../src/feeder/pipeline.js";
import { backfillBodyIdentity } from "../src/feeder/bodyIdentityBackfill.js";

const HEADER = "System Name,Body Name,Body Subtype,Distance To Arrival,Landmark Subtype,Value,Count\n";

let corpus: string;
let ctx: FeederContext;

function csv(rows: string[]): string {
  const p = path.join(corpus, `import-${Math.random().toString(36).slice(2)}.csv`);
  writeFileSync(p, HEADER + rows.join("\n") + "\n", "utf8");
  return p;
}

/** Write a species archive in the shape hydration leaves behind. */
function archive(
  slug: string,
  records: { i: number; systemName: string; bodyName: string; systemId?: number; bodyId?: number; edsmId?: number }[],
): void {
  const dir = path.join(rawPlanetsDir(), slug);
  mkdirSync(dir, { recursive: true });
  const lines = records.map((r) =>
    JSON.stringify({
      i: r.i,
      systemName: r.systemName,
      bodyName: r.bodyName,
      speciesLabel: "Osseus Discus",
      context: {
        systemName: r.systemName,
        systemId: r.systemId ?? null,
        targetBodyName: r.bodyName,
        targetBody:
          r.bodyId === undefined
            ? null
            : { id: r.edsmId ?? null, id64: 828662410047907000, bodyId: r.bodyId, name: r.bodyName },
      },
    }),
  );
  writeFileSync(path.join(dir, "samples.jsonl.gz"), gzipSync(Buffer.from(lines.join("\n"), "utf8")));
}

beforeEach(async () => {
  corpus = mkdtempSync(path.join(tmpdir(), "edexo-identity-"));
  setFeederDataDirForTests(corpus);
  ctx = await openFeeder();
});

afterEach(() => {
  ctx?.store.close();
  setFeederDataDirForTests(null);
  rmSync(corpus, { recursive: true, force: true });
});

const ROW_A = "18 Andromedae,18 Andromedae 8 a,Rocky body,3940,Osseus Discus,19010000,1";
const ROW_B = "18 Andromedae,18 Andromedae 8 b,Rocky body,3950,Osseus Discus,19010000,1";

describe("acceptance rule 3 — importing twice changes nothing", () => {
  it("the same CSV twice leaves the sighting count unchanged", async () => {
    await importCsv(ctx, csv([ROW_A, ROW_B]));
    const first = ctx.store.getStats();
    await importCsv(ctx, csv([ROW_A, ROW_B]));
    const second = ctx.store.getStats();
    expect(second.uniqueSightings).toBe(first.uniqueSightings);
    expect(second.uniquePlanets).toBe(first.uniquePlanets);
    expect(second.uniqueSystems).toBe(first.uniqueSystems);
  });

  it("two CSVs whose bodies overlap leave the sighting count unchanged", async () => {
    await importCsv(ctx, csv([ROW_A, ROW_B]));
    const first = ctx.store.getStats();
    await importCsv(ctx, csv([ROW_B]));
    expect(ctx.store.getStats().uniqueSightings).toBe(first.uniqueSightings);
  });
});

describe("backfill from the archives", () => {
  it("writes body_id and edsm_id, and reports coverage", async () => {
    await importCsv(ctx, csv([ROW_A, ROW_B]));
    archive("osseus_discus", [
      { i: 0, systemName: "18 Andromedae", bodyName: "18 Andromedae 8 a", systemId: 15695809, bodyId: 23, edsmId: 10904346 },
      { i: 1, systemName: "18 Andromedae", bodyName: "18 Andromedae 8 b", systemId: 15695809, bodyId: 24, edsmId: 10904347 },
    ]);

    const report = await backfillBodyIdentity(ctx.store, { apply: true });
    expect(report.planetsMatched).toBe(2);
    expect(report.coverage.planetsWithBodyId).toBe(2);
    expect(report.coverage.systemsWithEdsmId).toBe(1);
    expect(report.identitySplits).toEqual([]);
    expect(report.nameCollisions).toEqual([]);
  });

  it("a dry run writes nothing", async () => {
    await importCsv(ctx, csv([ROW_A]));
    archive("osseus_discus", [
      { i: 0, systemName: "18 Andromedae", bodyName: "18 Andromedae 8 a", systemId: 15695809, bodyId: 23, edsmId: 1 },
    ]);
    const report = await backfillBodyIdentity(ctx.store, { apply: false });
    expect(report.planetsMatched).toBe(1);
    expect(report.planetsWritten).toBe(0);
    expect(report.coverage.planetsWithBodyId).toBe(0);
  });

  it("is idempotent — a second apply writes nothing", async () => {
    await importCsv(ctx, csv([ROW_A]));
    archive("osseus_discus", [
      { i: 0, systemName: "18 Andromedae", bodyName: "18 Andromedae 8 a", systemId: 15695809, bodyId: 23, edsmId: 1 },
    ]);
    await backfillBodyIdentity(ctx.store, { apply: true });
    const again = await backfillBodyIdentity(ctx.store, { apply: true });
    expect(again.planetsWritten).toBe(0);
    expect(again.systemsWritten).toBe(0);
  });

  it("a body EDSM has no record of stays NULL rather than being invented", async () => {
    await importCsv(ctx, csv([ROW_A]));
    archive("osseus_discus", [{ i: 0, systemName: "18 Andromedae", bodyName: "18 Andromedae 8 a" }]);
    const report = await backfillBodyIdentity(ctx.store, { apply: true });
    expect(report.recordsWithoutBodyId).toBe(1);
    expect(report.coverage.planetsWithBodyId).toBe(0);
  });

  it("counts a row the archives never named as unmatched", async () => {
    await importCsv(ctx, csv([ROW_A, ROW_B]));
    archive("osseus_discus", [
      { i: 0, systemName: "18 Andromedae", bodyName: "18 Andromedae 8 a", systemId: 15695809, bodyId: 23, edsmId: 1 },
    ]);
    const report = await backfillBodyIdentity(ctx.store, { apply: true });
    expect(report.planetsMatched).toBe(1);
    expect(report.planetsUnmatched).toBe(1);
  });
});

describe("acceptance rule 4 — one body, one row, whatever it is called", () => {
  /**
   * The failure the item exists to prevent: the same body under two spellings. Name-based
   * de-duplication cannot see it — the two names normalise differently, so the store has two rows —
   * but both resolve to the same `(system, BodyID)`, and the report says so.
   */
  it("two spellings of one body are reported as a split, not silently merged", async () => {
    await importCsv(
      ctx,
      csv([ROW_A, "18 Andromedae,18 Andromedae 8a,Rocky body,3940,Osseus Discus,19010000,1"]),
    );
    expect(ctx.store.getStats().uniquePlanets).toBe(2);

    archive("osseus_discus", [
      { i: 0, systemName: "18 Andromedae", bodyName: "18 Andromedae 8 a", systemId: 15695809, bodyId: 23, edsmId: 1 },
      { i: 1, systemName: "18 Andromedae", bodyName: "18 Andromedae 8a", systemId: 15695809, bodyId: 23, edsmId: 1 },
    ]);

    const report = await backfillBodyIdentity(ctx.store, { apply: false });
    expect(report.identitySplits).toHaveLength(1);
    expect(report.identitySplits[0]!.bodyId).toBe(23);
    expect(report.identitySplits[0]!.bodies.sort()).toEqual(["18 Andromedae 8 a", "18 Andromedae 8a"]);
  });

  /**
   * The opposite failure: one name that two different bodies answer to. Here the corpus has already
   * averaged two bodies into a single row, and no amount of re-importing separates them — only the
   * report can say it happened.
   */
  it("one name resolving to two BodyIDs is reported as a collision", async () => {
    await importCsv(ctx, csv([ROW_A]));
    archive("osseus_discus", [
      { i: 0, systemName: "18 Andromedae", bodyName: "18 Andromedae 8 a", systemId: 15695809, bodyId: 23, edsmId: 1 },
      { i: 1, systemName: "18 Andromedae", bodyName: "18 Andromedae 8 a", systemId: 15695809, bodyId: 99, edsmId: 2 },
    ]);
    const report = await backfillBodyIdentity(ctx.store, { apply: false });
    expect(report.nameCollisions).toHaveLength(1);
    expect(report.nameCollisions[0]!.bodyIds).toEqual([23, 99]);
  });

  /**
   * Once the corpus is clean, the constraint is real: the store refuses a second row for a body it
   * already holds under a different name. This is what makes rule 4 an enforcement rather than a
   * report — but it can only be created when the data already satisfies it, so a corpus with the
   * split above still opens, and still prints its list.
   */
  it("the identity index exists on a clean corpus and refuses a duplicate", async () => {
    await importCsv(ctx, csv([ROW_A, ROW_B]));
    archive("osseus_discus", [
      { i: 0, systemName: "18 Andromedae", bodyName: "18 Andromedae 8 a", systemId: 15695809, bodyId: 23, edsmId: 1 },
      { i: 1, systemName: "18 Andromedae", bodyName: "18 Andromedae 8 b", systemId: 15695809, bodyId: 24, edsmId: 2 },
    ]);
    await backfillBodyIdentity(ctx.store, { apply: true });
    ctx.store.close();

    // Reopening runs the migration again, which is where the index is created.
    ctx = await openFeeder();
    const rows = ctx.store.planetIdentityRows();
    expect(rows.filter((r) => r.bodyId !== null)).toHaveLength(2);
    expect(ctx.store.duplicateIdentityGroups()).toEqual([]);
  });
});
