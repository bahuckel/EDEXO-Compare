/**
 * INCLUDE-BODY-IDS Phase 2 — system `id64`, from the cache and from the network.
 *
 * The corpus's own system ids are all comfortably below 2^53, so the real corpus cannot prove the
 * parser works. These tests use values past the boundary on purpose: the point of the parse-safe
 * path is that it holds when a commander finally visits a sector far enough out to need it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rawSystemsDir, setFeederDataDirForTests } from "../src/feeder/paths.js";
import { importCsv, openFeeder, type FeederContext } from "../src/feeder/pipeline.js";
import { backfillSystemId64, parseSystemCacheHeader } from "../src/feeder/systemId64Backfill.js";
import { parseEdsmSystemIds } from "../src/feeder/edsm.js";

const HEADER = "System Name,Body Name,Body Subtype,Distance To Arrival,Landmark Subtype,Value,Count\n";

/** Past 2^53, so a float64 round trip would visibly damage it. */
const HUGE_ID64 = "9007199254740993";
const REAL_ID64 = "78611735724";

let corpus: string;
let ctx: FeederContext;

function csv(rows: string[]): string {
  const p = path.join(corpus, `import-${Math.random().toString(36).slice(2)}.csv`);
  writeFileSync(p, HEADER + rows.join("\n") + "\n", "utf8");
  return p;
}

/** A cache file shaped the way EDSM's bodies endpoint writes one. */
function cacheFile(name: string, id: number, id64: string, bodies = 2): void {
  mkdirSync(rawSystemsDir(), { recursive: true });
  const body = {
    id,
    id64: "@@ID64@@",
    name,
    url: `https://www.edsm.net/en/system/bodies/id/${id}`,
    bodyCount: bodies,
    bodies: Array.from({ length: bodies }, (_, i) => ({ id: id + i, id64: "@@BODY@@", bodyId: i, name: `${name} ${i}` })),
  };
  const text = JSON.stringify(body, null, 2)
    .replace('"@@ID64@@"', id64)
    .replace(/"@@BODY@@"/g, "828662410047907001");
  writeFileSync(path.join(rawSystemsDir(), `${name.replace(/\s+/g, "_")}__test.json`), text, "utf8");
}

beforeEach(async () => {
  corpus = mkdtempSync(path.join(tmpdir(), "edexo-sysid-"));
  setFeederDataDirForTests(corpus);
  ctx = await openFeeder();
});

afterEach(() => {
  ctx?.store.close();
  setFeederDataDirForTests(null);
  rmSync(corpus, { recursive: true, force: true });
});

describe("parseEdsmSystemIds", () => {
  it("keeps every digit of an id64 past 2^53", () => {
    const rows = parseEdsmSystemIds(`[{"name":"Far Out","id":42,"id64":${HUGE_ID64}}]`);
    expect(rows).toEqual([{ name: "Far Out", edsmId: 42, id64: HUGE_ID64 }]);
    // The whole point, stated as a contrast: the obvious implementation loses the last digit.
    expect(String((JSON.parse(`{"id64":${HUGE_ID64}}`) as { id64: number }).id64)).not.toBe(HUGE_ID64);
  });

  it("reads the shape EDSM actually returns", () => {
    const rows = parseEdsmSystemIds(
      `[{"name":"18 Andromedae","id":15695809,"id64":${REAL_ID64},"coords":{"x":-384.625,"y":-77.5625,"z":-153.78125},"coordsLocked":true}]`,
    );
    expect(rows).toEqual([{ name: "18 Andromedae", edsmId: 15695809, id64: REAL_ID64 }]);
  });

  it("skips rows missing a name or an id, and survives junk", () => {
    expect(parseEdsmSystemIds(`[{"id":1,"id64":${REAL_ID64}},{"name":"X"},{"name":"Y","id":2,"id64":${REAL_ID64}}]`)).toEqual(
      [{ name: "Y", edsmId: 2, id64: REAL_ID64 }],
    );
    expect(parseEdsmSystemIds("not json")).toEqual([]);
    expect(parseEdsmSystemIds('{"name":"not an array"}')).toEqual([]);
  });
});

describe("parseSystemCacheHeader", () => {
  it("reads id, id64 and name without parsing the body list", () => {
    const head = `{\n  "id": 15695809,\n  "id64": ${REAL_ID64},\n  "name": "18 Andromedae",\n  "bodyCount": 21,\n  "bodies": [\n    {\n      "id": 109043`;
    expect(parseSystemCacheHeader(head)).toEqual({ name: "18 Andromedae", edsmId: 15695809, id64: REAL_ID64 });
  });

  it("keeps the digits of an id64 past 2^53 even from a truncated header", () => {
    const head = `{"id":1,"id64":${HUGE_ID64},"name":"Far Out","bodies":[{"id":2,"id6`;
    expect(parseSystemCacheHeader(head)?.id64).toBe(HUGE_ID64);
  });

  it("returns null rather than guessing when the header is unusable", () => {
    expect(parseSystemCacheHeader("")).toBeNull();
    expect(parseSystemCacheHeader('{"id":1,"name":"No bodies key"}')).toBeNull();
    expect(parseSystemCacheHeader('{"id":1,"bodies":[]}')).toBeNull();
  });
});

describe("backfillSystemId64", () => {
  const ROW = "18 Andromedae,18 Andromedae 8 a,Rocky body,3940,Osseus Discus,19010000,1";
  const ROW2 = "Far Out,Far Out 1 a,Rocky body,100,Osseus Discus,19010000,1";

  it("fills id64 from the cache with no network, and reports what is left", async () => {
    await importCsv(ctx, csv([ROW, ROW2]));
    cacheFile("18 Andromedae", 15695809, REAL_ID64);

    const report = await backfillSystemId64(ctx.store, { apply: true });
    expect(report.fromCache).toBe(1);
    expect(report.coverage.systemsWithId64).toBe(1);
    expect(report.stillMissing).toBe(1);
    expect(report.missingNames).toEqual(["Far Out"]);
  });

  it("stores an id64 past 2^53 with its digits intact, end to end", async () => {
    await importCsv(ctx, csv([ROW2]));
    cacheFile("Far Out", 42, HUGE_ID64);

    await backfillSystemId64(ctx.store, { apply: true });
    const row = ctx.store.systemIdentityRows().find((r) => r.displayName === "Far Out");
    expect(row?.id64).toBe(HUGE_ID64);
    expect(typeof row?.id64).toBe("string");
  });

  it("a dry run writes nothing", async () => {
    await importCsv(ctx, csv([ROW]));
    cacheFile("18 Andromedae", 15695809, REAL_ID64);
    const report = await backfillSystemId64(ctx.store, { apply: false });
    expect(report.fromCache).toBe(1);
    expect(report.written).toBe(0);
    expect(report.coverage.systemsWithId64).toBe(0);
  });

  it("is idempotent — a second apply writes nothing", async () => {
    await importCsv(ctx, csv([ROW]));
    cacheFile("18 Andromedae", 15695809, REAL_ID64);
    await backfillSystemId64(ctx.store, { apply: true });
    expect((await backfillSystemId64(ctx.store, { apply: true })).written).toBe(0);
  });

  it("counts cached systems the store does not hold rather than inserting them", async () => {
    await importCsv(ctx, csv([ROW]));
    cacheFile("18 Andromedae", 15695809, REAL_ID64);
    cacheFile("Somewhere Else", 999, "12345678");
    const report = await backfillSystemId64(ctx.store, { apply: true });
    expect(report.cacheOnly).toBe(1);
    expect(report.coverage.systems).toBe(1);
  });

  /**
   * The corpus measurement this phase turned on: system ids are small, body ids are not. If this
   * ever fails for a real corpus it means a commander has been somewhere far enough out to matter,
   * and the TEXT column plus the parse-safe path are what make that a non-event.
   */
  it("reports the largest id64 it saw and whether any crossed 2^53", async () => {
    await importCsv(ctx, csv([ROW, ROW2]));
    cacheFile("18 Andromedae", 1, REAL_ID64);
    cacheFile("Far Out", 2, HUGE_ID64);
    const report = await backfillSystemId64(ctx.store, { apply: true });
    expect(report.largestId64).toBe(HUGE_ID64);
    expect(report.beyondSafeInteger).toBe(1);
  });
});
