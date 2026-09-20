/**
 * The record of what the app believed, before the game corrected it.
 *
 * The outlier log answers "did we miss it". This has to answer "why was it on the list, and should
 * it have been higher" — which means it has to hold the list from *before* the answer arrived. The
 * traps are all about timing: scoring the list after `ScanOrganic` would say the app is always
 * right, and writing a stage on every snapshot recompute would bury the narrowings in noise.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BodyExoState, SpeciesMatch } from "../src/shared/types.js";
import type { SurfaceMark } from "../src/server/surfaceMarksFile.js";

// The file is resolved from the user data directory. Point it at a temp file so a test run never
// reads or writes the commander's real record — the same guard the outlier log's tests use.
let tmp: string;
let auditPath: string;
vi.mock("../src/server/paths.js", async () => {
  const actual = await vi.importActual<typeof import("../src/server/paths.js")>("../src/server/paths.js");
  return { ...actual, resolvePredictionAuditPath: () => auditPath };
});

const {
  recordPredictionForBody,
  predictionRecords,
  finalisePredictionsForSystem,
  resetPredictionAuditForTests,
} = await import("../src/server/predictionAuditLog.js");

const db = { species: [] } as unknown as Parameters<typeof recordPredictionForBody>[0]["db"];

function body(extra: Partial<BodyExoState> = {}): BodyExoState {
  return {
    key: "42:7",
    bodyName: "Test Sector AB-C d1-2 B 4",
    bodyId: 7,
    systemAddress: 42,
    starSystem: "Test Sector AB-C d1-2",
    biologicalSignals: 3,
    genusHints: null,
    dssComplete: false,
    scan: { PlanetClass: "Rocky body", SurfaceTemperature: 164.15 },
    organicGenusLocks: [],
    confirmedVariants: [],
    updatedAt: "2026-09-13T10:00:00Z",
    ...extra,
  } as BodyExoState;
}

const m = (id: string, genus: string, pct: number, unlikely = false) =>
  ({
    entry: { id, genus, displayName: id.replace("_", " ") },
    presenceProbabilityPercent: pct,
    ...(unlikely ? { unlikely: true } : {}),
  }) as unknown as SpeciesMatch;

const hint = (g: string) => ({ Genus: g, Genus_Localised: g }) as never;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "edexo-predictions-"));
  auditPath = path.join(tmp, "edexo-predictions.json");
  resetPredictionAuditForTests();
});

afterEach(() => {
  resetPredictionAuditForTests();
  rmSync(tmp, { recursive: true, force: true });
});

describe("recording the narrowing", () => {
  it("writes one stage for the first offer", () => {
    recordPredictionForBody({ body: body(), matches: [m("frutexa_acus", "Frutexa", 40)], db });
    const rec = predictionRecords()[0]!;
    expect(rec.stages).toHaveLength(1);
    expect(rec.stages[0]!.stage).toBe("fss");
    expect(rec.stages[0]!.offered[0]!.speciesId).toBe("frutexa_acus");
  });

  it("does not write a stage when nothing changed", () => {
    // The snapshot rebuilds constantly. An audit file that logged every rebuild would be useless.
    const matches = [m("frutexa_acus", "Frutexa", 40)];
    recordPredictionForBody({ body: body(), matches, db });
    recordPredictionForBody({ body: body(), matches, db });
    recordPredictionForBody({ body: body(), matches, db });
    expect(predictionRecords()[0]!.stages).toHaveLength(1);
  });

  it("names what the DSS dropped", () => {
    recordPredictionForBody({
      body: body(),
      matches: [m("frutexa_acus", "Frutexa", 40), m("tussock_cultro", "Tussock", 30)],
      db,
    });
    recordPredictionForBody({
      body: body({ dssComplete: true, genusHints: [hint("Frutexa")] }),
      matches: [m("frutexa_acus", "Frutexa", 90)],
      db,
    });
    const stages = predictionRecords()[0]!.stages;
    expect(stages).toHaveLength(2);
    expect(stages[1]!.stage).toBe("dss");
    expect(stages[1]!.dropped).toEqual(["tussock_cultro"]);
  });

  it("records a genus the game named and the app had nothing for", () => {
    // The app being wrong while saying nothing — a miss the game volunteers before anyone lands.
    recordPredictionForBody({
      body: body({ dssComplete: true, genusHints: [hint("Frutexa"), hint("Osseus")] }),
      matches: [m("frutexa_acus", "Frutexa", 90)],
      db,
    });
    expect(predictionRecords()[0]!.stages[0]!.unofferedGenera).toEqual(["Osseus"]);
  });

  it("keeps the demoted tier, marked as demoted", () => {
    recordPredictionForBody({
      body: body(),
      matches: [m("frutexa_acus", "Frutexa", 40), m("osseus_pumice", "Osseus", 2, true)],
      db,
    });
    const offered = predictionRecords()[0]!.stages[0]!.offered;
    expect(offered.find((o) => o.speciesId === "osseus_pumice")).toMatchObject({
      unlikely: true,
      rank: null,
    });
  });

  it("ignores a body with no biology and nothing confirmed", () => {
    recordPredictionForBody({ body: body({ biologicalSignals: 0 }), matches: [], db });
    expect(predictionRecords()).toHaveLength(0);
  });
});

describe("closing a record", () => {
  it("attaches the conditions at each plant when the commander leaves", () => {
    recordPredictionForBody({ body: body(), matches: [m("frutexa_acus", "Frutexa", 40)], db });
    const marks: SurfaceMark[] = [
      {
        bodyKey: "42:7",
        bodyNameNorm: "test sector ab-c d1-2 b 4",
        latDeg: 1,
        lonDeg: 2,
        label: "Frutexa Acus",
        atIso: "2026-09-13T10:05:00Z",
        temperatureK: 168.2,
        gravityG: 0.27,
      },
    ];
    expect(finalisePredictionsForSystem(42, marks)).toBe(1);
    const rec = predictionRecords()[0]!;
    expect(rec.final).toBe(true);
    expect(rec.conditions).toEqual([
      { atIso: "2026-09-13T10:05:00Z", label: "Frutexa Acus", temperatureK: 168.2, gravityG: 0.27 },
    ]);
  });

  it("leaves other systems' records open", () => {
    recordPredictionForBody({ body: body(), matches: [m("frutexa_acus", "Frutexa", 40)], db });
    expect(finalisePredictionsForSystem(999, [])).toBe(0);
    expect(predictionRecords()[0]!.final).toBe(false);
  });

  it("closes a body with no marks, with an empty list rather than nothing", () => {
    // No marks means the app was not running on foot there. That is a fact about the record, and
    // null would read as "not closed yet".
    recordPredictionForBody({ body: body(), matches: [m("frutexa_acus", "Frutexa", 40)], db });
    finalisePredictionsForSystem(42, []);
    expect(predictionRecords()[0]!.conditions).toEqual([]);
  });
});

/**
 * Why a candidate was hidden, not just that it was.
 *
 * The commander's question about `Qeajo TT-A c29-1 4` — "it was there at 2.6 %, why could I not see
 * it?" — could not be answered from the file, and rebuilding the body offline did not reproduce the
 * demotion, because the gates depend on context a reconstruction does not have. Recorded at the time
 * it is a lookup.
 */
describe("the reason a candidate was demoted", () => {
  const demoted = (id: string, reasons: { field: string; detail: string; soft?: boolean }[]) =>
    ({
      entry: { id, genus: "Bacterium", displayName: id.replace("_", " ") },
      presenceProbabilityPercent: 2.6,
      unlikely: true,
      unlikelyReasons: reasons,
    }) as unknown as SpeciesMatch;

  it("records the matcher's own reasons against the hidden candidate", () => {
    recordPredictionForBody({
      body: body(),
      matches: [
        m("stratum_tectonicas", "Stratum", 97.4),
        demoted("bacterium_aurasus", [
          { field: "PlanetClass", detail: "High metal content body", soft: true },
        ]),
      ],
      db,
    });
    const offered = predictionRecords()[0]!.stages[0]!.offered;
    const aurasus = offered.find((o) => o.speciesId === "bacterium_aurasus")!;
    expect(aurasus.unlikely).toBe(true);
    expect(aurasus.blockedBy).toEqual([
      { field: "PlanetClass", detail: "High metal content body", soft: true },
    ]);
  });

  it("leaves the list empty for a candidate that was shown", () => {
    recordPredictionForBody({ body: body(), matches: [m("stratum_tectonicas", "Stratum", 97.4)], db });
    expect(predictionRecords()[0]!.stages[0]!.offered[0]!.blockedBy).toEqual([]);
  });

  it("writes a new stage when only the reason changed", () => {
    // The same names in the same order with a different reason is a different answer, and it is the
    // change this file exists to catch.
    const shown = m("stratum_tectonicas", "Stratum", 97.4);
    recordPredictionForBody({
      body: body(),
      matches: [shown, demoted("bacterium_aurasus", [{ field: "PlanetClass", detail: "x", soft: true }])],
      db,
    });
    recordPredictionForBody({
      body: body(),
      matches: [shown, demoted("bacterium_aurasus", [{ field: "StarType", detail: "y", soft: true }])],
      db,
    });
    expect(predictionRecords()[0]!.stages).toHaveLength(2);
  });

  it("reads back a record written before the field existed", () => {
    // Old files are on disk right now; a missing `blockedBy` must not throw.
    const rec = predictionRecords();
    expect(rec).toHaveLength(0);
    recordPredictionForBody({ body: body(), matches: [m("stratum_tectonicas", "Stratum", 97.4)], db });
    const stage = predictionRecords()[0]!.stages[0]!;
    delete (stage.offered[0] as { blockedBy?: unknown }).blockedBy;
    expect(() =>
      recordPredictionForBody({ body: body(), matches: [m("stratum_tectonicas", "Stratum", 97.4)], db }),
    ).not.toThrow();
  });
});

/**
 * Partial failures: the right genus, the wrong species within it.
 *
 * The owner's case — three species of one genus offered and the one actually growing is not the one
 * at the top of them. Across the whole list that reads as `shown` at rank four, which says almost
 * nothing: the genera above it stopped being candidates the moment the DSS named one. Within the
 * genus it is the only question left.
 */
describe("how the confirmed species did inside its own genus", () => {
  const lock = { genus: "Bacterium", genusLocalised: "Bacterium", speciesLocalised: "Bacterium cerbrus" };
  const withTruth = () =>
    body({
      organicGenusLocks: [lock] as never,
      genusHints: [hint("Bacterium")],
      dssComplete: true,
    });
  const dbWith = {
    species: [
      { id: "bacterium_cerbrus", genus: "Bacterium", displayName: "Bacterium cerbrus" },
      { id: "bacterium_aurasus", genus: "Bacterium", displayName: "Bacterium aurasus" },
      { id: "bacterium_acies", genus: "Bacterium", displayName: "Bacterium acies" },
      { id: "stratum_tectonicas", genus: "Stratum", displayName: "Stratum tectonicas" },
    ],
  } as unknown as Parameters<typeof recordPredictionForBody>[0]["db"];

  /** Offer the whole list first, so there is a previous stage to score the truth against. */
  const offerThenConfirm = (matches: SpeciesMatch[]) => {
    recordPredictionForBody({ body: body(), matches, db: dbWith });
    recordPredictionForBody({ body: withTruth(), matches: matches.slice(0, 1), db: dbWith });
    return predictionRecords()[0]!.outcomes[0]!;
  };

  it("says which species of the genus outranked the one that was there", () => {
    const out = offerThenConfirm([
      m("stratum_tectonicas", "Stratum", 60),
      m("bacterium_aurasus", "Bacterium", 25),
      m("bacterium_cerbrus", "Bacterium", 10),
      m("bacterium_acies", "Bacterium", 5),
    ]);
    expect(out.speciesId).toBe("bacterium_cerbrus");
    // Fourth across the whole list, but second of the three Bacterium — which is the real miss.
    expect(out.rank).toBe(3);
    expect(out.genusRank).toBe(2);
    expect(out.genusCandidates).toBe(3);
    expect(out.beatenBy).toBe("bacterium aurasus");
  });

  it("calls it right within the genus even when other genera outranked the group", () => {
    const out = offerThenConfirm([
      m("stratum_tectonicas", "Stratum", 80),
      m("bacterium_cerbrus", "Bacterium", 12),
      m("bacterium_aurasus", "Bacterium", 8),
    ]);
    expect(out.verdict).toBe("shown");
    expect(out.genusRank).toBe(1);
    expect(out.beatenBy).toBeNull();
  });

  it("places a demoted species among its own kind, where it has no overall rank", () => {
    const out = offerThenConfirm([
      m("bacterium_aurasus", "Bacterium", 90),
      m("bacterium_cerbrus", "Bacterium", 2, true),
    ]);
    expect(out.verdict).toBe("unlikelyOnly");
    expect(out.rank).toBeNull();
    expect(out.genusRank).toBe(2);
    expect(out.beatenBy).toBe("bacterium aurasus");
  });

  it("leaves the genus figures empty for a species that was never offered", () => {
    const out = offerThenConfirm([m("stratum_tectonicas", "Stratum", 100)]);
    expect(out.verdict).toBe("absent");
    expect(out.genusRank).toBeNull();
    expect(out.genusCandidates).toBe(0);
  });
});
