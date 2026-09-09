/**
 * Reading the galaxy biology index back.
 *
 * The file is 40 MB of fixed-stride bytes with a variable-length tail, which is to say it is exactly
 * the kind of format that reads *almost* right: an off-by-one in the prefix sum shifts every species
 * list by one system and still returns plausible species for plausible systems. So these build a tiny
 * index by hand, with known contents, and assert the bytes come back as what went in.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBioIndex, clearBioIndexCache } from "../src/server/bioIndex.js";

const RECORD = 22;

/** Write a file in the shape scripts/build-bio-index.ts produces. */
function writeIndex(
  file: string,
  species: string[],
  rows: { id64: bigint; x: number; y: number; z: number; region: number; species: number[] }[],
) {
  const json = Buffer.from(JSON.stringify({ species }), "utf8");
  const head = Buffer.alloc(20);
  head.write("EDEXOBIO", 0, "ascii");
  head.writeUInt16LE(1, 8);
  head.writeUInt16LE(species.length, 10);
  head.writeUInt32LE(rows.length, 12);
  head.writeUInt32LE(json.length, 16);
  const table = Buffer.alloc(rows.length * RECORD);
  const runs: number[] = [];
  rows.forEach((r, i) => {
    const o = i * RECORD;
    table.writeBigUInt64LE(r.id64, o);
    table.writeFloatLE(r.x, o + 8);
    table.writeFloatLE(r.y, o + 12);
    table.writeFloatLE(r.z, o + 16);
    table.writeUInt8(r.region, o + 20);
    table.writeUInt8(r.species.length, o + 21);
    runs.push(...r.species);
  });
  writeFileSync(file, Buffer.concat([head, json, table, Buffer.from(runs)]));
}

const SPECIES = ["aleoida_aleoida_arcus", "bacterium_bacterium_aurasus", "stratum_stratum_tectonicas"];
/** Ascending by id64, as the builder writes them — the binary search depends on it. */
const ROWS = [
  { id64: 100n, x: 1.5, y: -2.5, z: 3.5, region: 9, species: [1] },
  { id64: 200n, x: 0, y: 0, z: 0, region: 0, species: [] },
  { id64: 300n, x: -9530.5, y: -910.25, z: 19808.0, region: 18, species: [0, 2] },
  { id64: 400n, x: 10, y: 20, z: 30, region: 1, species: [2] },
];

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "edexo-bioindex-"));
  file = join(dir, "bio-index.bin");
  writeIndex(file, SPECIES, ROWS);
  clearBioIndexCache();
});

describe("looking a system up", () => {
  it("returns the species that were written for it", () => {
    const ix = loadBioIndex(file)!;
    expect(ix.lookup(300n)?.species).toEqual([SPECIES[0], SPECIES[2]]);
  });

  it("keeps each system's list with that system", () => {
    // The prefix-sum bug this file exists for: a run shifted by one still looks like real data.
    const ix = loadBioIndex(file)!;
    expect(ix.lookup(100n)?.species).toEqual([SPECIES[1]]);
    expect(ix.lookup(400n)?.species).toEqual([SPECIES[2]]);
  });

  it("returns an empty list, not a wrong one, for a system with no species", () => {
    const ix = loadBioIndex(file)!;
    expect(ix.lookup(200n)?.species).toEqual([]);
  });

  it("carries coordinates and region", () => {
    const ix = loadBioIndex(file)!;
    const s = ix.lookup(300n)!;
    expect(s.x).toBeCloseTo(-9530.5, 1);
    expect(s.z).toBeCloseTo(19808, 0);
    expect(s.regionId).toBe(18);
  });

  it("says null for a system it has never heard of", () => {
    // Not an empty row: "no biology recorded" and "never seen" are different answers.
    const ix = loadBioIndex(file)!;
    expect(ix.lookup(999n)).toBeNull();
    expect(ix.lookup(1n)).toBeNull();
  });

  it("finds the first and last rows, which a binary search most often misses", () => {
    const ix = loadBioIndex(file)!;
    expect(ix.lookup(100n)).not.toBeNull();
    expect(ix.lookup(400n)).not.toBeNull();
  });
});

describe("finding systems by species", () => {
  it("returns every system holding any of them", () => {
    const ix = loadBioIndex(file)!;
    const got = ix.systemsWithAny([SPECIES[2]!]).map((s) => s.id64);
    expect(got).toEqual([300n, 400n]);
  });

  it("returns nothing for a species no system holds", () => {
    const ix = loadBioIndex(file)!;
    expect(ix.systemsWithAny(["nothing_at_all"])).toEqual([]);
  });
});

describe("a build without an index", () => {
  it("returns null rather than throwing", () => {
    // The index is optional data. Missing it costs the galaxy filter, not the app.
    expect(loadBioIndex(join(dir, "absent.bin"))).toBeNull();
  });

  it("refuses a file that is not an index", () => {
    const bad = join(dir, "bad.bin");
    writeFileSync(bad, Buffer.from("not an index at all, but long enough to read a header from"));
    clearBioIndexCache();
    expect(loadBioIndex(bad)).toBeNull();
  });
});
