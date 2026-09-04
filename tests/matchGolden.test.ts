import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import type { PlanetScan, SpeciesDatabase } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface GoldenCase {
  bodyName: string;
  scan: Record<string, unknown>;
  confirmedSpecies: string[];
  candidates: string[];
}

const fixture = JSON.parse(
  readFileSync(path.join(root, "tests", "fixtures", "match-golden.json"), "utf8"),
) as { cases: GoldenCase[] };

let db: SpeciesDatabase;
beforeAll(() => {
  db = loadSpeciesDatabaseFromTree(root);
});

/**
 * Twenty real scans from the journal, with the candidate list each produced when the fixture was
 * generated. The accuracy probe needs the commander's own journal cache and cannot run on another
 * machine or in CI; this is the half that travels with the repository.
 *
 * A failure here is not automatically a regression — it means predictions moved. Read the diff, and
 * if the move is intended, regenerate with `npx tsx scripts/gen-match-fixture.ts` in the same commit
 * so the change is reviewable rather than silent.
 *
 * Matching is FSS-only (no DSS genus hints), the scenario the app exists for.
 */
describe("golden candidate lists", () => {
  it("covers every atmosphere type in the truth set", () => {
    const atmos = new Set(fixture.cases.map((c) => String(c.scan.AtmosphereType ?? "none")));
    expect(fixture.cases.length).toBe(20);
    expect(atmos.size).toBeGreaterThanOrEqual(10);
  });

  it.each(fixture.cases.map((c) => [c.bodyName, c] as const))("%s", (_name, c) => {
    const matches = matchDatabaseToScan(db, c.scan as unknown as PlanetScan, null, null, {
      includeBacterium: true,
    }).matches;
    expect(matches.map((m) => m.entry.id).sort()).toEqual(c.candidates);
  });

  it("still offers the species the commander actually found, where it did when generated", () => {
    // Pins recall on the fixture: any species that was being found must keep being found. This is
    // the assertion that catches a gate change quietly costing a real find.
    for (const c of fixture.cases) {
      const wasFound = c.confirmedSpecies.filter((s) => c.candidates.includes(s));
      const matches = matchDatabaseToScan(db, c.scan as unknown as PlanetScan, null, null, {
        includeBacterium: true,
      }).matches;
      const ids = new Set(matches.map((m) => m.entry.id));
      for (const s of wasFound) {
        expect(ids.has(s), `${c.bodyName}: lost ${s}`).toBe(true);
      }
    }
  });
});
