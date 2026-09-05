import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  describeUserDataMigration,
  migrateLegacyUserData,
} from "../src/server/userDataMigration.js";

let legacy: string;
let current: string;
const saved = { legacy: process.env.EDEXO_LEGACY_USER_DATA_DIR, current: process.env.EDEXO_USER_DATA_DIR };

const SETTINGS = "edexo-compare-user-settings.json";
const LAN_KEY = "edexo-compare-lan-key.txt";
const OUTLIERS = "edexo-outliers.jsonl";

function record(bodyKey: string, speciesId: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ bodyKey, speciesId, speciesName: speciesId, ...extra });
}

beforeEach(() => {
  const root = mkdtempSync(path.join(tmpdir(), "edexo-userdata-"));
  legacy = path.join(root, "legacy");
  current = path.join(root, "current");
  mkdirSync(legacy, { recursive: true });
  mkdirSync(current, { recursive: true });
  process.env.EDEXO_LEGACY_USER_DATA_DIR = legacy;
  process.env.EDEXO_USER_DATA_DIR = current;
});

afterEach(() => {
  rmSync(path.dirname(legacy), { recursive: true, force: true });
  if (saved.legacy === undefined) delete process.env.EDEXO_LEGACY_USER_DATA_DIR;
  else process.env.EDEXO_LEGACY_USER_DATA_DIR = saved.legacy;
  if (saved.current === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = saved.current;
});

describe("migrateLegacyUserData", () => {
  it("does nothing when there is no legacy directory", () => {
    delete process.env.EDEXO_LEGACY_USER_DATA_DIR;
    const m = migrateLegacyUserData();
    expect(m.legacyDir).toBeNull();
    expect(describeUserDataMigration(m)).toEqual([]);
  });

  it("does nothing when the legacy directory is the current one", () => {
    process.env.EDEXO_LEGACY_USER_DATA_DIR = current;
    writeFileSync(path.join(current, SETTINGS), "{}", "utf8");
    expect(migrateLegacyUserData().copied).toEqual([]);
  });

  it("carries over settings and the LAN key when the new location has none", () => {
    writeFileSync(path.join(legacy, SETTINGS), '{"includeBacterium":true}', "utf8");
    writeFileSync(path.join(legacy, LAN_KEY), "legacy-key", "utf8");

    const m = migrateLegacyUserData();
    expect(m.copied).toEqual([SETTINGS, LAN_KEY]);
    expect(readFileSync(path.join(current, SETTINGS), "utf8")).toBe('{"includeBacterium":true}');
    expect(readFileSync(path.join(current, LAN_KEY), "utf8")).toBe("legacy-key");
  });

  /** The location being kept is the one every probe and the dev server already used. */
  it("never overwrites a file the current location already has", () => {
    writeFileSync(path.join(legacy, SETTINGS), "legacy", "utf8");
    writeFileSync(path.join(current, SETTINGS), "current", "utf8");

    expect(migrateLegacyUserData().copied).toEqual([]);
    expect(readFileSync(path.join(current, SETTINGS), "utf8")).toBe("current");
  });

  /**
   * The miss log is the only file here where losing a line loses evidence — §40 through §44 were all
   * argued from it — so it is merged rather than copied.
   */
  it("merges both miss logs instead of choosing one", () => {
    writeFileSync(path.join(legacy, OUTLIERS), `${record("b1", "s1")}\n${record("b2", "s2")}\n`, "utf8");
    writeFileSync(path.join(current, OUTLIERS), `${record("b3", "s3")}\n`, "utf8");

    const m = migrateLegacyUserData();
    expect(m.outliersMerged).toBe(2);

    const keys = readFileSync(path.join(current, OUTLIERS), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as { bodyKey: string });
    expect(keys.map((k) => k.bodyKey).sort()).toEqual(["b1", "b2", "b3"]);
  });

  it("de-duplicates a body flown under both builds, current winning", () => {
    writeFileSync(path.join(legacy, OUTLIERS), `${record("b1", "s1", { blockedBy: "old" })}\n`, "utf8");
    writeFileSync(path.join(current, OUTLIERS), `${record("b1", "s1", { blockedBy: "new" })}\n`, "utf8");

    expect(migrateLegacyUserData().outliersMerged).toBe(0);
    const lines = readFileSync(path.join(current, OUTLIERS), "utf8").split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).blockedBy).toBe("new");
  });

  it("copies the legacy log wholesale when there is no current one", () => {
    writeFileSync(path.join(legacy, OUTLIERS), `${record("b1", "s1")}\n${record("b2", "s2")}\n`, "utf8");
    expect(migrateLegacyUserData().outliersMerged).toBe(2);
    expect(existsSync(path.join(current, OUTLIERS))).toBe(true);
  });

  it("is idempotent — a second run moves nothing", () => {
    writeFileSync(path.join(legacy, SETTINGS), "s", "utf8");
    writeFileSync(path.join(legacy, OUTLIERS), `${record("b1", "s1")}\n`, "utf8");
    migrateLegacyUserData();

    const again = migrateLegacyUserData();
    expect(again.copied).toEqual([]);
    expect(again.outliersMerged).toBe(0);
  });

  /** Derived data rebuilds itself, so it is reported and left — not copied, and not deleted. */
  it("reports a stale journal cache without touching it", () => {
    const cache = path.join(legacy, ".edexo-cache");
    mkdirSync(cache, { recursive: true });
    writeFileSync(path.join(cache, "journal-merge.payload.v8gz"), Buffer.alloc(2_000_000));

    const m = migrateLegacyUserData();
    expect(m.staleCacheDir).toBe(cache);
    expect(m.staleCacheBytes).toBe(2_000_000);
    expect(existsSync(path.join(cache, "journal-merge.payload.v8gz"))).toBe(true);
    expect(existsSync(path.join(current, ".edexo-cache", "journal-merge.payload.v8gz"))).toBe(false);
    expect(describeUserDataMigration(m).join(" ")).toContain("safe to delete");
  });
});
