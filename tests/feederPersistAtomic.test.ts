/**
 * The feeder corpus is written beside itself and renamed over (review F-F3): a crash mid-write used
 * to truncate the only copy.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openFeederStore } from "../src/feeder/feederDb.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-feeder-persist-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("feeder persist", () => {
  it("leaves only the database, which opens again with what was written", async () => {
    const file = path.join(dir, "corpus.sqlite");
    const a = await openFeederStore(file);
    a.db.run("CREATE TABLE t (x INTEGER);");
    a.db.run("INSERT INTO t VALUES (42);");
    a.persist();
    expect(readdirSync(dir)).toEqual(["corpus.sqlite"]);
    const b = await openFeederStore(file);
    expect(b.db.exec("SELECT x FROM t")[0]!.values).toEqual([[42]]);
  });
});
