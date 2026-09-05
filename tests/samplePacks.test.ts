import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PACKED_SAMPLES_FILE,
  looseSampleIndex,
  looseSampleName,
  packSpeciesSamples,
  readPackedSamples,
  writePackedSamples,
} from "../src/feeder/samplePacks.js";

let dir: string;

function writeLoose(index: number, systemName: string, hasBody = true): void {
  writeFileSync(
    path.join(dir, looseSampleName(index)),
    JSON.stringify({
      systemName,
      bodyName: `${systemName} 1 a`,
      speciesLabel: "Tussock Ignis",
      systemCacheFile: `${systemName}__abc.json`,
      context: { targetBody: hasBody ? { name: `${systemName} 1 a`, subType: "Rocky body" } : null },
    }),
    "utf8",
  );
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-packs-"));
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("looseSampleIndex", () => {
  it("reads the occurrence index out of the filename", () => {
    expect(looseSampleIndex("sample_0.json")).toBe(0);
    expect(looseSampleIndex("sample_1234.json")).toBe(1234);
  });

  it("ignores anything that is not one", () => {
    expect(looseSampleIndex(PACKED_SAMPLES_FILE)).toBeNull();
    expect(looseSampleIndex("sample_.json")).toBeNull();
    expect(looseSampleIndex("sample_-1.json")).toBeNull();
    expect(looseSampleIndex("sample_2.json.tmp")).toBeNull();
  });
});

describe("packSpeciesSamples", () => {
  it("folds every loose file into one archive and deletes them", async () => {
    for (let i = 0; i < 12; i++) writeLoose(i, `Sys ${i}`);
    const r = await packSpeciesSamples(dir);

    expect(r.folded).toBe(12);
    expect(r.records).toBe(12);
    expect(r.packedBytes).toBeLessThan(r.looseBytes);
    expect(readdirSync(dir)).toEqual([PACKED_SAMPLES_FILE]);

    const archive = await readPackedSamples(dir);
    expect(archive.size).toBe(12);
    expect(archive.get(7)?.systemName).toBe("Sys 7");
    expect(archive.get(7)?.context).toEqual({ targetBody: { name: "Sys 7 1 a", subType: "Rocky body" } });
  });

  /** A species hydrated after its last pack has newer records loose; those have to win. */
  it("merges a second pass, newest on top", async () => {
    writeLoose(0, "First");
    writeLoose(1, "Second");
    await packSpeciesSamples(dir);

    writeLoose(1, "Second corrected");
    writeLoose(2, "Third");
    const r = await packSpeciesSamples(dir);

    expect(r.records).toBe(3);
    expect(r.folded).toBe(2);
    const archive = await readPackedSamples(dir);
    expect(archive.get(0)?.systemName).toBe("First");
    expect(archive.get(1)?.systemName).toBe("Second corrected");
    expect(archive.get(2)?.systemName).toBe("Third");
  });

  it("is a no-op when there is nothing loose", async () => {
    writeLoose(0, "Only");
    await packSpeciesSamples(dir);
    const again = await packSpeciesSamples(dir);
    expect(again.folded).toBe(0);
    expect(again.records).toBe(1);
  });

  it("says nothing for a species with no samples at all", async () => {
    expect(await packSpeciesSamples(path.join(dir, "nope"))).toEqual({
      records: 0,
      folded: 0,
      looseBytes: 0,
      packedBytes: 0,
    });
  });

  /**
   * A file we cannot parse is evidence, not garbage: it stays on disk rather than being folded into
   * an archive that would silently lose it.
   */
  it("leaves an unreadable loose file alone", async () => {
    writeLoose(0, "Good");
    writeFileSync(path.join(dir, looseSampleName(1)), "{ not json", "utf8");
    await packSpeciesSamples(dir);
    expect(readdirSync(dir).sort()).toEqual([PACKED_SAMPLES_FILE, looseSampleName(1)].sort());
  });
});

describe("readPackedSamples", () => {
  it("gives an empty map when there is no archive", async () => {
    expect((await readPackedSamples(dir)).size).toBe(0);
  });

  it("survives one corrupt line without losing the species", async () => {
    await writePackedSamples(dir, [
      { i: 0, systemName: "A" },
      { i: 1, systemName: "B" },
    ]);
    const archive = await readPackedSamples(dir);
    expect(archive.size).toBe(2);
    expect([...archive.keys()].sort()).toEqual([0, 1]);
  });

  it("round-trips in occurrence order, not filename order", async () => {
    await writePackedSamples(dir, [
      { i: 10, systemName: "ten" },
      { i: 9, systemName: "nine" },
      { i: 2, systemName: "two" },
    ]);
    expect([...(await readPackedSamples(dir)).keys()]).toEqual([2, 9, 10]);
  });
});
