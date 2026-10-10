/**
 * The galaxy body file is released with the map's other memory after the idle time (plan 4.1,
 * 2026-10-10): it is 683 MB since version 2, and one "possible" search kept it until the app closed.
 */
import { describe, expect, it } from "vitest";
import express from "express";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerGalaxyRoutes } from "../src/server/routes/galaxyRoutes.js";
import { galaxyMemoryState, releaseGalaxyMemory } from "../src/server/galaxyMemory.js";
import { clearBioBodiesCache, loadBioBodies } from "../src/server/bioBodies.js";

function emptyFile(file: string): void {
  // A version-1 file with no systems and no bodies: header and an empty string table.
  const json = Buffer.from(JSON.stringify({ subTypes: [], atmospheres: [], volcanisms: [], starTypes: [] }));
  const header = Buffer.alloc(24);
  header.write("EDEXOBOD", 0, "ascii");
  header.writeUInt16LE(1, 8);
  header.writeUInt32LE(json.length, 20);
  writeFileSync(file, Buffer.concat([header, json]));
}

describe("galaxy memory and the body file", () => {
  it("registers the body file and lets it go on release", () => {
    registerGalaxyRoutes(express(), {} as never, {} as never);
    expect(galaxyMemoryState().caches).toContain("bio-bodies");

    const dir = mkdtempSync(path.join(tmpdir(), "edexo-galaxy-mem-"));
    try {
      const a = path.join(dir, "a.bin");
      const b = path.join(dir, "b.bin");
      emptyFile(a);
      emptyFile(b);
      clearBioBodiesCache();
      const held = loadBioBodies(a);
      expect(held).not.toBeNull();
      // Held: a second load returns the same handle whatever path it is given.
      expect(loadBioBodies(b)).toBe(held);
      releaseGalaxyMemory();
      expect(loadBioBodies(b)).not.toBe(held);
    } finally {
      clearBioBodiesCache();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
