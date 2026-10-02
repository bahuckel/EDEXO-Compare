/** Generated data files are not rewritten for their timestamp alone (review F-F7). */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeJsonIfChanged } from "../src/feeder/stableWrite.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-stable-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const json = (o: unknown) => `${JSON.stringify(o, null, 2)}\n`;

describe("writeJsonIfChanged", () => {
  it("keeps a file whose only change is its stamp, old stamp and all", () => {
    const f = path.join(dir, "p.json");
    writeFileSync(f, json({ generatedAt: "2026-01-01T00:00:00Z", n: 1, a: [1, 2] }));
    expect(writeJsonIfChanged(f, json({ generatedAt: "2026-10-02T00:00:00Z", n: 1, a: [1, 2] }))).toBe(false);
    expect(JSON.parse(readFileSync(f, "utf8")).generatedAt).toBe("2026-01-01T00:00:00Z");
    expect(writeJsonIfChanged(f, json({ builtAt: "x", generatedAt: "y", n: 1, a: [1, 2] }))).toBe(false);
  });

  it("writes a real change, a new file, and over an unreadable one", () => {
    const f = path.join(dir, "p.json");
    expect(writeJsonIfChanged(f, json({ generatedAt: "a", n: 1 }))).toBe(true);
    expect(writeJsonIfChanged(f, json({ generatedAt: "b", n: 2 }))).toBe(true);
    expect(JSON.parse(readFileSync(f, "utf8"))).toEqual({ generatedAt: "b", n: 2 });
    writeFileSync(f, "{ broken");
    expect(writeJsonIfChanged(f, json({ n: 3 }))).toBe(true);
  });
});
