/**
 * Version 2 of the galaxy body file (code review 2026-10-10, B3): the builder carries each bio body's
 * arrival distance and host star, and each system's planet classes, so the galaxy scan can judge the
 * companion-body, arrival-distance and host-star gates. Without them it could never return
 * Crystalline Shards.
 *
 * Built end to end: a tiny dump in the Spansh shape, the real builder, the real reader and scan. The
 * system is in Formorian Frontier, 30,800 ly from the core, where the codex has logged Shards.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import { clearBioBodiesCache, loadBioBodies } from "../src/server/bioBodies.js";
import { galaxyBodyScan } from "../src/server/galaxyBodyScan.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";

const BIO = "$SAA_SignalType_Biological;";

function dump(withCompanion: boolean): string {
  const lines = [
    JSON.stringify({ kind: "system", id64: "1234567", name: "Testia AA-A h0", coords: { x: -10000, y: 0, z: 55000 }, bodyCount: 3 }),
    JSON.stringify({ kind: "body", type: "Star", bodyId: 0, name: "Testia AA-A h0 A", subType: "F (White) Star", spectralClass: "F5", mainStar: true, distanceToArrival: 0 }),
    JSON.stringify({ kind: "body", type: "Star", bodyId: 1, name: "Testia AA-A h0 B", subType: "K (Yellow-Orange) Star", spectralClass: "K3", distanceToArrival: 14000 }),
    JSON.stringify({
      kind: "body",
      type: "Planet",
      bodyId: 2,
      name: "Testia AA-A h0 B 1",
      subType: withCompanion ? "Earth-like world" : "Class I gas giant",
      distanceToArrival: 14100,
    }),
    JSON.stringify({
      kind: "body",
      type: "Planet",
      bodyId: 3,
      name: "Testia AA-A h0 B 2",
      subType: "Icy body",
      atmosphereType: null,
      volcanismType: "Minor Water Magma",
      surfaceTemperature: 150,
      gravity: 0.1,
      surfacePressure: 0,
      isLandable: true,
      hostStarBodyId: 1,
      distanceToArrival: 15000,
      signals: { signals: { [BIO]: 1 } },
    }),
  ];
  return lines.join("\n") + "\n";
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-bio-bodies-v2-"));
  clearBioBodiesCache();
});

afterEach(() => {
  clearBioBodiesCache();
  rmSync(dir, { recursive: true, force: true });
});

function build(withCompanion: boolean): string {
  const src = path.join(dir, "galaxy_bio.jsonl.gz");
  const out = path.join(dir, "edexo-bio-bodies.bin");
  writeFileSync(src, gzipSync(dump(withCompanion)));
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", path.resolve(__dirname, "../scripts/build-bio-bodies.ts"), src, "--out", out],
    { encoding: "utf8", env: { ...process.env, EDEXO_USER_DATA_DIR: dir } },
  );
  expect(r.status, r.stderr).toBe(0);
  return out;
}

describe("galaxy body file version 2", () => {
  it("carries the arrival distance, the host star and the system's planet classes", () => {
    const f = loadBioBodies(build(true))!;
    expect(f.bodyCount).toBe(1);
    const sys = f.system(0);
    expect(sys.starType).toBe("F5");
    expect(sys.planetClasses).toEqual(expect.arrayContaining(["Earth-like world", "Icy body"]));
    // One icy body: its own class is not a companion.
    expect(sys.planetClassesTwice).toEqual([]);
    expect(sys.bodyListComplete).toBe(true);
    f.forEachBodyOfSystem(0, (b) => {
      expect(b.arrivalLs).toBeCloseTo(15000);
      expect(b.hostStarType).toBe("K3");
    });
  }, 30_000);

  it("lets the galaxy scan return Crystalline Shards when every condition is met, and not without the companion", async () => {
    const shards = loadSpeciesDatabase().species.find((s) => s.id === "crystalline_shards_crystalline_shards")!;
    const ask = async (withCompanion: boolean) => {
      clearBioBodiesCache();
      const f = loadBioBodies(build(withCompanion))!;
      const r = await galaxyBodyScan({ regionId: f.system(0).regionId, speciesIds: [shards.id], includeUnprobed: true });
      return r.hits.length;
    };
    expect(await ask(true)).toBe(1);
    expect(await ask(false)).toBe(0);
  }, 60_000);
});
