/**
 * A profile is built from every hydrated body of its species, each exactly once.
 *
 * The builder used to merge the archive and the `sample_N` files by occurrence index — an index that
 * had been alphabetical and shifted under imports, so the same body sat under several indices — and
 * never read the `body_<hash>` files the hydrator writes now. On 2026-09-24 that was 69,189 records
 * read, 46,029 distinct bodies among them, and 23,160 hydrated bodies ignored.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPlanetContextsFromDir } from "../src/feeder/planetContexts.js";
import { bodySampleName, looseSampleName, writePackedSamples } from "../src/feeder/samplePacks.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const sample = (systemName: string, bodyName: string, t: number) => ({
  systemName,
  bodyName,
  speciesLabel: "Bacterium Volu",
  context: { systemName, targetBody: { name: bodyName, type: "Planet", surfaceTemperature: t } },
});

describe("loading a species' samples", () => {
  it("reads the archive, sample_N and body_ files, one context per body", async () => {
    const dir = mkdtempSync(join(tmpdir(), "edexo-samples-"));
    dirs.push(dir);
    // The archive holds A twice under two indices (the positional-index era) and B once.
    await writePackedSamples(dir, [
      { i: 0, ...sample("Sys", "Sys A 1", 150) },
      { i: 1, ...sample("Sys", "Sys A 1", 150) },
      { i: 2, ...sample("Sys", "Sys B 2", 160) },
    ]);
    // A loose sample_N repeats B; a body_ file holds C, which nothing else has.
    writeFileSync(join(dir, looseSampleName(7)), JSON.stringify(sample("Sys", "Sys B 2", 161)));
    writeFileSync(join(dir, bodySampleName("Other", "Other C 3")), JSON.stringify(sample("Other", "Other C 3", 170)));

    const contexts = await loadPlanetContextsFromDir(dir);
    const names = contexts.map((c) => c.bodyName).sort();
    expect(names).toEqual(["Other C 3", "Sys A 1", "Sys B 2"]);
    // Loose files win over the archive for the same body.
    expect(contexts.find((c) => c.bodyName === "Sys B 2")!.targetBody!.surfaceTemperature).toBe(161);
  });

  it("still refuses an empty directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "edexo-samples-"));
    dirs.push(dir);
    await expect(loadPlanetContextsFromDir(dir)).rejects.toThrow(/No samples/);
  });
});

describe("temperature edges on the codex limits", () => {
  it("moves the nearest quantile edge onto each limit within 2 K, keeping the bin count", async () => {
    const { snapEdgesToValues } = await import("../src/feeder/histograms.js");
    // The 2026-09-24 temperature edges, around the codex limits.
    const edges = [159.41, 162.95, 165.16, 167.16, 169.38, 172, 174.16, 178.69, 182.61, 187, 191.55, 195.19];
    const snapped = snapEdgesToValues(edges, [160, 165, 170, 175, 180, 190, 195]);
    expect(snapped).toHaveLength(edges.length);
    for (const v of [160, 165, 170, 175, 180, 190, 195]) expect(snapped).toContain(v);
    expect(snapped.every((e, i) => i === 0 || e > snapped[i - 1]!)).toBe(true);
  });

  it("leaves an edge alone when no limit is near, and never reorders bins", async () => {
    const { snapEdgesToValues } = await import("../src/feeder/histograms.js");
    expect(snapEdgesToValues([100, 101, 200], [150])).toEqual([100, 101, 200]);
    // 101 cannot move to 99.5: it would cross the edge at 100.
    expect(snapEdgesToValues([100, 101, 200], [99.5])).toEqual([99.5, 101, 200]);
  });
});
