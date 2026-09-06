/**
 * INCLUDE-BODY-IDS acceptance rule 1: an id64 beyond 2^53 round-trips through parser → store →
 * export with **exact digits**. Not approximately.
 *
 * The value below is a real one from the corpus. `JSON.parse` alone returns 828662410047907000 for
 * it — the last three digits replaced by zeros — which is the corruption this whole item exists to
 * stop reproducing.
 */
import { describe, expect, it } from "vitest";
import {
  ID64_FIELDS,
  MAX_SAFE_ID,
  isTrustworthyId64,
  parseJsonPreservingIds,
  quoteBigIntFields,
  toId64String,
} from "../src/feeder/bigIntJson.js";

const REAL_BODY_ID64 = "828662410047907001";
const REAL_SYSTEM_ID64 = "36029979779502910";

describe("id64 survives JSON", () => {
  it("plain JSON.parse loses the digits — the defect this module exists for", () => {
    const parsed = JSON.parse(`{"id64": ${REAL_BODY_ID64}}`) as { id64: number };
    expect(String(parsed.id64)).not.toBe(REAL_BODY_ID64);
    expect(parsed.id64).toBeGreaterThan(Number(MAX_SAFE_ID));
  });

  it("round-trips exact digits through parse and re-serialise", () => {
    const source = `{"id64": ${REAL_BODY_ID64}, "bodyId": 23, "name": "18 Andromedae 8 a"}`;
    const parsed = parseJsonPreservingIds<{ id64: string; bodyId: number; name: string }>(source);
    expect(parsed.id64).toBe(REAL_BODY_ID64);

    // …and out again, which is the "export" half of the round trip.
    const exported = JSON.stringify(parsed);
    const reparsed = parseJsonPreservingIds<{ id64: string }>(exported);
    expect(reparsed.id64).toBe(REAL_BODY_ID64);
  });

  it("leaves small numbers and non-id64 fields alone", () => {
    const parsed = parseJsonPreservingIds<{ id: number; bodyId: number; id64: string }>(
      `{"id": 10904346, "bodyId": 23, "id64": ${REAL_BODY_ID64}}`,
    );
    expect(parsed.id).toBe(10904346);
    expect(parsed.bodyId).toBe(23);
    expect(typeof parsed.id64).toBe("string");
  });

  it("is idempotent — quoting twice changes nothing", () => {
    const source = `{"systemId64": ${REAL_SYSTEM_ID64}}`;
    const once = quoteBigIntFields(source);
    expect(quoteBigIntFields(once)).toBe(once);
  });

  it("covers every declared id64 field, and nested ones", () => {
    const source = `{"SystemAddress": ${REAL_SYSTEM_ID64}, "body": {"bodyId64": ${REAL_BODY_ID64}}}`;
    const parsed = parseJsonPreservingIds<{ SystemAddress: string; body: { bodyId64: string } }>(source);
    expect(parsed.SystemAddress).toBe(REAL_SYSTEM_ID64);
    expect(parsed.body.bodyId64).toBe(REAL_BODY_ID64);
    expect(ID64_FIELDS).toContain("SystemAddress");
  });

  it("does not touch a value that is already a string, or null", () => {
    const source = `{"id64": "${REAL_BODY_ID64}", "systemId64": null}`;
    const parsed = parseJsonPreservingIds<{ id64: string; systemId64: null }>(source);
    expect(parsed.id64).toBe(REAL_BODY_ID64);
    expect(parsed.systemId64).toBeNull();
  });
});

/**
 * Where the rounding actually happens, pinned.
 *
 * §2.4 originally claimed TEXT was the only SQLite column type that survives this stack. It is not,
 * and Fable was right to push back while building the Spansh ingest: SQLite's INTEGER is 64-bit and
 * exact, and only the JavaScript boundary loses anything. This test exists so that correction cannot
 * quietly rot back into the old claim — and so that a future switch to INTEGER storage has the
 * evidence it needs sitting next to it.
 */
describe("SQLite is not the lossy part — the JS boundary is", () => {
  const HUGE = "6160925022241180003"; // the largest body id64 in the Spansh galaxy dump

  it("stores exactly, and only the default JS read rounds", async () => {
    const initSqlJs = (await import("sql.js")).default;
    const { PROJECT_ROOT } = await import("../src/feeder/paths.js");
    const { join } = await import("node:path");
    const SQL = await initSqlJs({
      locateFile: (f: string) => join(PROJECT_ROOT, "node_modules", "sql.js", "dist", f),
    });
    const db = new SQL.Database();
    db.run("CREATE TABLE t (a INTEGER, b TEXT)");
    // A literal, so no JavaScript number is created on the way in.
    db.run(`INSERT INTO t (a, b) VALUES (${HUGE}, '${HUGE}')`);

    // SQLite kept both, and agrees they are the same value.
    const cmp = db.prepare("SELECT a = CAST(b AS INTEGER) FROM t");
    cmp.step();
    expect(Number((cmp.get() as unknown[])[0])).toBe(1);
    cmp.free();

    const st = db.prepare("SELECT a, b, CAST(a AS TEXT) FROM t");
    st.step();
    const [asNumber, asText, cast] = st.get() as [unknown, unknown, unknown];

    expect(typeof asNumber).toBe("number");
    expect(String(asNumber)).not.toBe(HUGE); // the default read is where it is lost
    expect(asText).toBe(HUGE);
    expect(cast).toBe(HUGE); // INTEGER storage + CAST is exact

    st.reset();
    st.step();
    const big = (st as unknown as { get: (p: unknown, c: unknown) => unknown[] }).get(null, {
      useBigInt: true,
    });
    expect(typeof big[0]).toBe("bigint");
    expect(String(big[0])).toBe(HUGE); // INTEGER storage + useBigInt is exact
    st.free();
    db.close();
  });
});

describe("trust", () => {
  it("a big number is not trustworthy; the same digits as a string are", () => {
    expect(isTrustworthyId64(Number(REAL_BODY_ID64))).toBe(false);
    expect(isTrustworthyId64(REAL_BODY_ID64)).toBe(true);
    expect(isTrustworthyId64(23)).toBe(true);
    expect(isTrustworthyId64(BigInt(REAL_BODY_ID64))).toBe(true);
    expect(isTrustworthyId64(null)).toBe(false);
    expect(isTrustworthyId64("not a number")).toBe(false);
  });

  it("normalises the shapes a source can hand us", () => {
    expect(toId64String(REAL_BODY_ID64)).toBe(REAL_BODY_ID64);
    expect(toId64String(BigInt(REAL_BODY_ID64))).toBe(REAL_BODY_ID64);
    expect(toId64String(23)).toBe("23");
    expect(toId64String(null)).toBeNull();
    expect(toId64String("")).toBeNull();
    // A damaged number still normalises — to its damaged digits, which is why the caller must ask
    // isTrustworthyId64 before believing it. It normalises to the digits that are *on disk*, not to
    // the float's exact value (828662410047906944): a join has to match the file, not the IEEE.
    expect(toId64String(828662410047907000)).toBe("828662410047907000");
    expect(BigInt(828662410047907000).toString()).toBe("828662410047906944");
  });
});
