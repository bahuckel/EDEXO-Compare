/**
 * The boot replay's guards (combined plan 1.2, Phase 6 test): one throwing line does not end the
 * merge, and only a folder that is really there and empty counts as having no journals.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { journalFolderIsReadable, makeReplayLineApplier } from "../src/server/journalReplayGuards.js";
import type { JournalLine } from "../src/shared/types.js";

const line = (event: string) => ({ timestamp: "2026-10-04T10:00:00Z", event }) as JournalLine;

describe("makeReplayLineApplier", () => {
  it("keeps applying after a line throws, and counts the throws", () => {
    const seen: string[] = [];
    const log = vi.fn();
    const r = makeReplayLineApplier((l) => {
      if (l.event === "Broken") throw new Error("bad line");
      seen.push(String(l.event));
    }, log);
    for (const e of ["FSDJump", "Broken", "Scan", "Broken", "ScanOrganic"]) r.apply(line(e));
    expect(seen).toEqual(["FSDJump", "Scan", "ScanOrganic"]);
    expect(r.errors()).toBe(2);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("logs the first three throws only", () => {
    const log = vi.fn();
    const r = makeReplayLineApplier(() => {
      throw new Error("x");
    }, log);
    for (let i = 0; i < 10; i++) r.apply(line("Broken"));
    expect(r.errors()).toBe(10);
    expect(log).toHaveBeenCalledTimes(3);
  });
});

describe("journalFolderIsReadable", () => {
  it("is true for an empty folder that is there, false for a missing one or a file", () => {
    const root = mkdtempSync(path.join(tmpdir(), "edexo-guards-"));
    try {
      expect(journalFolderIsReadable(root)).toBe(true);
      // An unmounted drive or a folder not created yet: the cache must survive it.
      expect(journalFolderIsReadable(path.join(root, "not-mounted"))).toBe(false);
      const file = path.join(root, "a-file");
      writeFileSync(file, "");
      expect(journalFolderIsReadable(file)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
