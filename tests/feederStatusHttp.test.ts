/**
 * The feeder panel's numbers, which were wrong for as long as the panel was unfindable.
 *
 * Two defects, found by unburying it (§11.3):
 *
 * 1. `packCount` counted **loose `sample_N.json` files only** — and §46 folded every one of them into
 *    a `samples.jsonl.gz` archive. So it returned 0 for all 100 species and the panel said
 *    "0 of 100 hydrated".
 * 2. "Behind" compared a profile's sample count against the corpus's raw *occurrences*, which
 *    includes §45.2's 599 sightings whose body EDSM has no record of. That called **63** profiles
 *    stale and told the owner to run a job that would fetch nothing. `scripts/feeder.ts` had already
 *    been fixed for exactly this; the HTTP path had not.
 *
 * Both now go through the same archive-aware count the CLI uses, so the panel and the command line
 * cannot disagree about what "hydrated" means.
 */
import { gzipSync } from "node:zlib";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countHydratableSamplesSync } from "../src/feeder/samplePacks.js";
import { setFeederDataDirForTests } from "../src/feeder/paths.js";

let dir: string;

/** A species directory as hydration leaves it after §46 packing: one archive, no loose files. */
function packed(slug: string, records: { i: number; hasBody: boolean }[]): string {
  const d = path.join(dir, slug);
  mkdirSync(d, { recursive: true });
  const lines = records.map((r) =>
    JSON.stringify({
      i: r.i,
      systemName: "Alpha",
      bodyName: `Alpha ${r.i}`,
      context: r.hasBody ? { targetBody: { id: r.i, bodyId: r.i } } : {},
    }),
  );
  writeFileSync(path.join(d, "samples.jsonl.gz"), gzipSync(Buffer.from(lines.join("\n"), "utf8")));
  return d;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-packs-"));
  setFeederDataDirForTests(dir);
});

afterEach(() => {
  setFeederDataDirForTests(null);
  rmSync(dir, { recursive: true, force: true });
});

describe("counting hydrated samples synchronously", () => {
  it("counts records inside a packed archive — the case that read as zero", () => {
    const d = packed("osseus_discus", [
      { i: 0, hasBody: true },
      { i: 1, hasBody: true },
      { i: 2, hasBody: true },
    ]);
    expect(countHydratableSamplesSync(d)).toBe(3);
  });

  /**
   * A sighting whose body EDSM has no record of is *not* hydratable. This is the distinction that
   * made 63 profiles look stale: the corpus holds the occurrence, but no run can turn it into a
   * sample.
   */
  it("does not count a record with no body — the corpus holds it, no run can supply it", () => {
    const d = packed("bacterium_aurasus", [
      { i: 0, hasBody: true },
      { i: 1, hasBody: false },
      { i: 2, hasBody: false },
    ]);
    expect(countHydratableSamplesSync(d)).toBe(1);
  });

  it("counts loose files too, and a loose file wins over the same index in the archive", () => {
    const d = packed("frutexa_acus", [{ i: 0, hasBody: true }]);
    writeFileSync(
      path.join(d, "sample_1.json"),
      JSON.stringify({ context: { targetBody: { id: 9 } } }),
      "utf8",
    );
    expect(countHydratableSamplesSync(d)).toBe(2);
  });

  it("returns zero for a species with nothing on disk rather than throwing", () => {
    expect(countHydratableSamplesSync(path.join(dir, "never_hydrated"))).toBe(0);
  });

  it("survives a corrupt archive line without losing the rest", () => {
    const d = path.join(dir, "tussock_ignis");
    mkdirSync(d, { recursive: true });
    const good = JSON.stringify({ i: 0, context: { targetBody: { id: 1 } } });
    writeFileSync(
      path.join(d, "samples.jsonl.gz"),
      gzipSync(Buffer.from(`${good}\n{not json\n${JSON.stringify({ i: 2, context: { targetBody: { id: 3 } } })}`, "utf8")),
    );
    expect(countHydratableSamplesSync(d)).toBe(2);
  });
});
