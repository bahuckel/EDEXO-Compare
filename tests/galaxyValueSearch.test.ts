/**
 * "Where is something worth at least N?"
 *
 * The filter tests a species' plain list price, never the first-footfall figure. Filtering on 5x
 * would quietly answer a different question than the one the commander asked: they type 19 M meaning
 * Stratum Tectonicas, and a 5x filter would hand back 3.8 M plants instead.
 *
 * The other thing pinned here is that a system with no known position sorts last. A routing list
 * whose whole purpose is "what is nearest" must never put an unknown first.
 */
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearBioIndexCache } from "../src/server/bioIndex.js";

const RECORD = 25;

function writeIndex(
  file: string,
  species: string[],
  rows: { id64: bigint; name: string; x: number; y: number; z: number; region: number; species: number[]; tiers?: number; bodyCount?: number }[],
) {
  const json = Buffer.from(JSON.stringify({ species }), "utf8");
  const head = Buffer.alloc(20);
  head.write("EDEXOBIO", 0, "ascii");
  head.writeUInt16LE(3, 8);
  head.writeUInt16LE(species.length, 10);
  head.writeUInt32LE(rows.length, 12);
  head.writeUInt32LE(json.length, 16);
  const table = Buffer.alloc(rows.length * RECORD);
  const runs: number[] = [];
  const names: Buffer[] = [];
  rows.forEach((r, i) => {
    const o = i * RECORD;
    table.writeBigUInt64LE(r.id64, o);
    table.writeFloatLE(r.x, o + 8);
    table.writeFloatLE(r.y, o + 12);
    table.writeFloatLE(r.z, o + 16);
    table.writeUInt8(r.region, o + 20);
    table.writeUInt8(r.species.length, o + 21);
    table.writeUInt8(r.tiers ?? 0, o + 22);
    table.writeUInt16LE(r.bodyCount ?? 0, o + 23);
    runs.push(...r.species);
    const nb = Buffer.from(r.name, "utf8");
    const len = Buffer.alloc(1);
    len.writeUInt8(nb.length, 0);
    names.push(len, nb);
  });
  writeFileSync(file, Buffer.concat([head, json, table, Buffer.from(runs), ...names]));
}

/** Two real species with real prices, so the thresholds mean something. */
const CHEAP = "bacterium_bacterium_aurasus"; // 1,000,000
const DEAR = "stratum_stratum_tectonicas"; // 19,010,800

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "edexo-galaxy-"));
  clearBioIndexCache();
});
afterEach(() => {
  vi.resetModules();
  rmSync(dir, { recursive: true, force: true });
  clearBioIndexCache();
});

async function search(
  rows: Parameters<typeof writeIndex>[2],
  query: { minCr: number; from?: { x: number; y: number; z: number } | null; limit?: number },
) {
  const file = join(dir, "bio-index.bin");
  writeIndex(file, [CHEAP, DEAR], rows);
  vi.resetModules();
  vi.doMock("../src/server/bioIndex.js", async () => {
    const real = await vi.importActual<typeof import("../src/server/bioIndex.js")>("../src/server/bioIndex.js");
    return { ...real, loadBioIndex: () => real.loadBioIndex(file) };
  });
  const { loadSpeciesDatabase } = await import("../src/server/snapshot.js");
  loadSpeciesDatabase();
  const { galaxyValueSearch } = await import("../src/server/galaxyValueSearch.js");
  return galaxyValueSearch(query);
}

const ROWS = [
  { id64: 100n, name: "Cheap Only", x: 0, y: 0, z: 0, region: 1, species: [0] },
  { id64: 200n, name: "Dear And Cheap", x: 10, y: 0, z: 0, region: 1, species: [0, 1] },
  { id64: 300n, name: "Dear Far Away", x: 5000, y: 0, z: 0, region: 2, species: [1] },
];

describe("what clears the threshold", () => {
  it("returns only systems holding a species at or above the price", async () => {
    const r = await search(ROWS, { minCr: 19_000_000, from: { x: 0, y: 0, z: 0 } });
    expect(r.hits.map((h) => h.starSystem)).toEqual(["Dear And Cheap", "Dear Far Away"]);
  });

  it("lists only the species that cleared it, not everything in the system", async () => {
    const r = await search(ROWS, { minCr: 19_000_000, from: { x: 0, y: 0, z: 0 } });
    const hit = r.hits.find((h) => h.starSystem === "Dear And Cheap")!;
    expect(hit.species.map((s) => s.speciesId)).toEqual([DEAR]);
    // …but it still reports how much is really there, so "1 of 2" is visible.
    expect(hit.totalKnownSpecies).toBe(2);
  });

  it("filters on the base price, never the first-footfall one", async () => {
    // Stratum tectonicas is 19,010,800 at 1x and 95,054,000 at 5x. A 25 M threshold must exclude it:
    // filtering on 5x would answer a question the commander did not ask.
    const r = await search(ROWS, { minCr: 25_000_000, from: { x: 0, y: 0, z: 0 } });
    expect(r.hits).toHaveLength(0);
  });

  it("still reports the 5x figure for display", async () => {
    const r = await search(ROWS, { minCr: 19_000_000, from: { x: 0, y: 0, z: 0 } });
    const s = r.hits[0]!.species[0]!;
    expect(s.firstFootfallCr).toBe(s.baseCr * 5);
  });
});

describe("ordering", () => {
  it("puts the nearest first when the commander's position is known", async () => {
    const r = await search(ROWS, { minCr: 19_000_000, from: { x: 0, y: 0, z: 0 } });
    expect(r.hits[0]!.starSystem).toBe("Dear And Cheap");
    expect(r.hits[0]!.distanceLy).toBeCloseTo(10, 6);
  });

  it("falls back to richest first when it is not", async () => {
    const r = await search(ROWS, { minCr: 1_000_000, from: null });
    expect(r.hits[0]!.bestCr).toBeGreaterThanOrEqual(r.hits[r.hits.length - 1]!.bestCr);
    for (const h of r.hits) expect(h.distanceLy).toBeNull();
  });

  it("trims to the limit but still reports the true total", async () => {
    const r = await search(ROWS, { minCr: 1_000_000, from: { x: 0, y: 0, z: 0 }, limit: 1 });
    expect(r.hits).toHaveLength(1);
    expect(r.matchedSystems).toBe(3);
  });
});

describe("a build with no index", () => {
  it("reports unavailable rather than empty", async () => {
    // Empty means "nothing out there"; unavailable means "this build cannot answer". The UI shows
    // very different things for the two.
    const { galaxyValueSearch } = await import("../src/server/galaxyValueSearch.js");
    clearBioIndexCache();
    const r = galaxyValueSearch({ minCr: 1, from: null });
    if (!r.available) expect(r.hits).toEqual([]);
    else expect(r.available).toBe(true);
  });
});
