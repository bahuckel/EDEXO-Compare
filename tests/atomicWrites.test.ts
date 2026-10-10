/**
 * User files are written whole or not at all, and an unreadable notices file is set aside rather than
 * overwritten with defaults (code review 2026-10-10, A3 and A5).
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeFileAtomic } from "../src/server/atomicWrite.js";
import { createNoticesService } from "../src/server/notices.js";

const dir = () => mkdtempSync(path.join(tmpdir(), "edexo-atomic-"));

describe("writeFileAtomic", () => {
  it("replaces the file and leaves no temporary file behind", () => {
    const d = dir();
    const f = path.join(d, "a.json");
    writeFileSync(f, "old", "utf8");
    writeFileAtomic(f, "new");
    expect(readFileSync(f, "utf8")).toBe("new");
    expect(readdirSync(d)).toEqual(["a.json"]);
  });

  it("keeps the old file when the write fails", () => {
    const d = dir();
    const f = path.join(d, "a.json");
    writeFileSync(f, "old", "utf8");
    // A folder in the way of the rename: the write must fail and leave the old file.
    expect(() => writeFileAtomic(path.join(d, "missing", "b.json"), "new")).toThrow();
    expect(readFileSync(f, "utf8")).toBe("old");
  });
});

describe("an unreadable notices file", () => {
  it("is set aside, not overwritten by the next save", () => {
    const d = dir();
    const f = path.join(d, "edexo-notices.json");
    writeFileSync(f, '{"prefs": {"codexFirst": fal', "utf8");
    const n = createNoticesService({ filePath: f });
    n.setPrefs({ chime: true });
    const kept = readdirSync(d).filter((x) => x.startsWith("edexo-notices.json.unreadable-"));
    expect(kept).toHaveLength(1);
    expect(readFileSync(path.join(d, kept[0]!), "utf8")).toContain("codexFirst");
    expect(existsSync(f)).toBe(true);
  });
});
