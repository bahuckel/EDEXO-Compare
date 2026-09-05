import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BodyExoState, SpeciesDatabase, SpeciesMatch } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let tmp: string;
let logPath: string;

// The log path is resolved from the user data directory; point it at a temp file so the test never
// touches the commander's real record.
vi.mock("../src/server/paths.js", async () => {
  const actual = await vi.importActual<typeof import("../src/server/paths.js")>("../src/server/paths.js");
  return { ...actual, resolveExoOutlierLogPath: () => logPath };
});

const { exoOutlierTally, recordExoOutliersForBody, resetExoOutlierLogCacheForTests } =
  await import("../src/server/exoOutlierLog.js");
const { loadSpeciesDatabaseFromTree } = await import("../src/server/speciesTreeLoader.js");

let db: SpeciesDatabase;

function bodyWith(lockSpecies: string, extra: Partial<BodyExoState> = {}): BodyExoState {
  return {
    key: "123:4",
    bodyName: "Test Body 4 a",
    starSystem: "Test Sector AB-C d1-2",
    biologicalSignals: 2,
    organicGenusLocks: [
      {
        genusLocalised: "Stratum",
        genusSymbol: "$Codex_Ent_Stratum_Genus_Name;",
        speciesLocalised: lockSpecies,
      },
    ],
    scan: {
      PlanetClass: "High metal content body",
      AtmosphereType: "CarbonDioxide",
      SurfaceTemperature: 180,
      SurfaceGravity: 3.2,
      SurfacePressure: 3040,
      Volcanism: "",
    },
    ...extra,
  } as unknown as BodyExoState;
}

function matchFor(id: string, presenceProbabilityPercent?: number): SpeciesMatch {
  const entry = db.species.find((e) => e.id === id)!;
  return { entry, reasons: [], presenceProbabilityPercent } as unknown as SpeciesMatch;
}

beforeEach(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), "edexo-outlier-"));
  logPath = path.join(tmp, "edexo-outliers.jsonl");
  resetExoOutlierLogCacheForTests();
  if (!db) db = loadSpeciesDatabaseFromTree(root);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/**
 * The probe can only re-measure the past, on one commander's 233 bodies. This grows wherever the
 * commander is actually flying, and keeps working after the harness has been tuned against.
 */
describe("recordExoOutliersForBody", () => {
  it("writes nothing when the confirmed species was offered", () => {
    const body = bodyWith("Stratum tectonicas");
    const n = recordExoOutliersForBody({
      body,
      matches: [matchFor("stratum_stratum_tectonicas")],
      db,
    });
    expect(n).toBe(0);
    expect(existsSync(logPath)).toBe(false);
  });

  it("records a confirmed species the candidate list missed, with the criterion that blocked it", () => {
    const body = bodyWith("Stratum tectonicas");
    const n = recordExoOutliersForBody({ body, matches: [matchFor("bacterium_bacterium_aurasus")], db });
    expect(n).toBe(1);

    const rec = JSON.parse(readFileSync(logPath, "utf8").trim());
    expect(rec.speciesId).toBe("stratum_stratum_tectonicas");
    expect(rec.severity).toBe("absent");
    expect(rec.bodyName).toBe("Test Body 4 a");
    expect(rec.scan.planetClass).toBe("High metal content body");
    expect(rec.biologicalSignals).toBe(2);
    expect(rec.candidates).toEqual(["bacterium_bacterium_aurasus"]);
    // The blocking criterion comes from the matcher, not from a guess here.
    expect(rec.blockedBy).toBeTruthy();
  });

  it("writes each (body, species) once however often the snapshot recomputes", () => {
    const body = bodyWith("Stratum tectonicas");
    const args = { body, matches: [matchFor("bacterium_bacterium_aurasus")], db };
    expect(recordExoOutliersForBody(args)).toBe(1);
    expect(recordExoOutliersForBody(args)).toBe(0);
    expect(recordExoOutliersForBody(args)).toBe(0);
    expect(readFileSync(logPath, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("re-reads an existing log so a restart does not duplicate entries", () => {
    const body = bodyWith("Stratum tectonicas");
    const args = { body, matches: [matchFor("bacterium_bacterium_aurasus")], db };
    expect(recordExoOutliersForBody(args)).toBe(1);
    resetExoOutlierLogCacheForTests(); // simulate a restart
    expect(recordExoOutliersForBody(args)).toBe(0);
    expect(readFileSync(logPath, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("records a species offered only in the unlikely tier, and says so", () => {
    // The no-walls change turns most "absent" misses into demoted ones. The commander still would
    // not have seen it without opening the collapsed list, so it is still a miss — a smaller one.
    const body = bodyWith("Stratum tectonicas");
    const demoted = { ...matchFor("stratum_stratum_tectonicas"), unlikely: true } as SpeciesMatch;
    const n = recordExoOutliersForBody({ body, matches: [demoted], db });
    expect(n).toBe(1);

    const rec = JSON.parse(readFileSync(logPath, "utf8").trim());
    expect(rec.speciesId).toBe("stratum_stratum_tectonicas");
    expect(rec.severity).toBe("unlikelyOnly");
    // The candidate list recorded is the one the commander was actually shown.
    expect(rec.candidates).toEqual([]);
    expect(rec.candidateCount).toBe(0);
  });

  it("ignores bodies with no scan or no confirmed species", () => {
    expect(
      recordExoOutliersForBody({ body: bodyWith("Stratum tectonicas", { scan: null }), matches: [], db }),
    ).toBe(0);
    expect(
      recordExoOutliersForBody({
        body: bodyWith("Stratum tectonicas", { organicGenusLocks: [] }),
        matches: [],
        db,
      }),
    ).toBe(0);
    expect(existsSync(logPath)).toBe(false);
  });
});

/**
 * The case the ranking model created, predicted in this module's own comment before the model
 * existed: since nothing is strictly excluded any more, the failure that matters is a species
 * offered and sorted below the ones the panel names. The game names `k` genera, so outside the top
 * `k` is outside what the commander reads.
 */
describe("rankedLow", () => {
  it("records a confirmed species that was listed but ranked below the signal count", () => {
    const body = bodyWith("Stratum tectonicas"); // two biological signals
    const n = recordExoOutliersForBody({
      body,
      matches: [
        matchFor("bacterium_bacterium_aurasus", 90),
        matchFor("bacterium_bacterium_cerbrus", 70),
        matchFor("stratum_stratum_tectonicas", 5),
      ],
      db,
    });
    expect(n).toBe(1);

    const rec = JSON.parse(readFileSync(logPath, "utf8").trim());
    expect(rec.speciesId).toBe("stratum_stratum_tectonicas");
    expect(rec.severity).toBe("rankedLow");
    expect(rec.rank).toBe(3);
  });

  it("says nothing when the species is inside the top k", () => {
    const body = bodyWith("Stratum tectonicas");
    const n = recordExoOutliersForBody({
      body,
      matches: [
        matchFor("bacterium_bacterium_aurasus", 90),
        matchFor("stratum_stratum_tectonicas", 70),
        matchFor("bacterium_bacterium_cerbrus", 5),
      ],
      db,
    });
    expect(n).toBe(0);
  });

  /** No signal count is no verdict: the app never claimed how many genera were down there. */
  it("does not judge the ranking on a body with no signal count", () => {
    const body = bodyWith("Stratum tectonicas", { biologicalSignals: null });
    const n = recordExoOutliersForBody({
      body,
      matches: [
        matchFor("bacterium_bacterium_aurasus", 90),
        matchFor("bacterium_bacterium_cerbrus", 70),
        matchFor("stratum_stratum_tectonicas", 5),
      ],
      db,
    });
    expect(n).toBe(0);
  });
});

describe("exoOutlierTally", () => {
  it("counts nothing before anything is recorded", () => {
    expect(exoOutlierTally()).toEqual({ total: 0, absent: 0, unlikelyOnly: 0, rankedLow: 0 });
  });

  it("counts what has been written, and survives a restart by re-reading the file", () => {
    recordExoOutliersForBody({
      body: bodyWith("Stratum tectonicas"),
      matches: [matchFor("bacterium_bacterium_aurasus")],
      db,
    });
    expect(exoOutlierTally()).toMatchObject({ total: 1, absent: 1 });

    resetExoOutlierLogCacheForTests();
    expect(exoOutlierTally()).toMatchObject({ total: 1, absent: 1, rankedLow: 0 });
  });
});
