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
