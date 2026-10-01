/**
 * A sample run that crosses an app restart (owner, 2026-10-02).
 *
 * He logged a Fonticulua, hopped the ship to the next plant and sampled it, restarted the app, then
 * took the third. The HUD lost the first sample's distance: the second plant's distance sat in the
 * first row and the third row stayed empty, while the radar still showed every plant. Three faults:
 * the odometer setting (off) deleted the saved run at every start, the journal rebuild stopped at
 * the last landing (one scan of two), and a rebuilt run had no positions at all although the radar's
 * marks, stamped with each line's time, had them.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildExoOrganicOverlayDto,
  ingestExoOrganicJournalLine,
  restoreOrganicSessionFromJournal,
} from "../src/server/exoOrganicTracker.js";
import { GameStateStore } from "../src/server/gameState.js";
import { resolveOrganicSampleSessionPath } from "../src/server/paths.js";
import { getCachedSpeciesDatabase, loadSpeciesDatabase } from "../src/server/snapshot.js";
import type { JournalLine } from "../src/shared/types.js";

const SA = 685719759473;
const BODY = 26;
const KEY = `${SA}:${BODY}`;
const RADIUS_M = 1_500_000;
const M_PER_DEG = (Math.PI * RADIUS_M) / 180;

const at = (s: number) => `2026-10-01T23:${String(25 + Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}Z`;
const scan = (type: string, t: number) =>
  ({
    event: "ScanOrganic",
    timestamp: at(t),
    ScanType: type,
    Genus_Localised: "Fonticulua",
    Species_Localised: "Fonticulua Lapida",
    SystemAddress: SA,
    Body: BODY,
  }) as unknown as JournalLine;
const land = (event: "Touchdown" | "Liftoff", t: number, body = BODY) =>
  ({ event, timestamp: at(t), SystemAddress: SA, BodyID: body }) as unknown as JournalLine;
const mark = (latDeg: number, t: number) => ({
  bodyKey: KEY,
  bodyNameNorm: "here",
  latDeg,
  lonDeg: 0,
  label: "Fonticulua Lapida",
  atIso: at(t),
});

function store(marks: ReturnType<typeof mark>[], fixLat = 0) {
  return {
    exoOrganicTracker: null,
    exoOrganicLastFix: {
      latDeg: fixLat,
      lonDeg: 0,
      planetRadiusM: RADIUS_M,
      bodyName: "here",
      headingDeg: 0,
      temperatureK: null,
      gravityG: null,
    },
    firstFootfallBodies: new Set<string>(),
    surfaceSampleMarks: marks,
    explorationScans: new Map([[KEY, { radius: RADIUS_M }]]),
    surfaceShipMark: null,
    footTravelOdometerEnabled: false,
    addSurfaceSampleMark() {},
    beginFootTravelOdometerSession() {},
  } as unknown as Parameters<typeof restoreOrganicSessionFromJournal>[0];
}
const tracker = (s: unknown) => (s as { exoOrganicTracker: Record<string, unknown> | null }).exoOrganicTracker;

// His journal, in the shape it had: Log, back to the ship, hop, Sample, (restart).
const hisRun = [
  land("Touchdown", 0),
  scan("Log", 48),
  land("Liftoff", 65),
  land("Touchdown", 79),
  scan("Sample", 94),
];

beforeAll(() => {
  loadSpeciesDatabase();
});

describe("rebuilding a run from the journal after a restart", () => {
  it("counts both scans across a ship hop on the same body, and places them from the radar's marks", () => {
    const s = store([mark(0.01, 48), mark(0.02, 94)]);
    expect(restoreOrganicSessionFromJournal(s, hisRun, process.cwd(), getCachedSpeciesDatabase())).toBe(true);
    const t = tracker(s)!;
    expect((t.anchors as unknown[]).length).toBe(2);
    expect(t.recoveredSamples ?? 0).toBe(0);
    const dto = buildExoOrganicOverlayDto(s as never, new Map())!;
    expect(dto.sampleCount).toBe(2);
    expect(dto.distToFirstM).toBeCloseTo(0.01 * M_PER_DEG, -1);
    expect(dto.distToSecondM).toBeCloseTo(0.02 * M_PER_DEG, -1);
  });

  it("stops at a landing on another body", () => {
    const lines = [land("Touchdown", 0), scan("Log", 48), land("Liftoff", 65), land("Touchdown", 79, 27)];
    expect(restoreOrganicSessionFromJournal(store([]), lines, process.cwd(), getCachedSpeciesDatabase())).toBe(false);
  });

  it("an unplaced first scan keeps its row empty instead of taking the second plant's distance", () => {
    const s = store([mark(0.02, 94)]);
    restoreOrganicSessionFromJournal(s, hisRun, process.cwd(), getCachedSpeciesDatabase());
    const dto = buildExoOrganicOverlayDto(s as never, new Map())!;
    expect(dto.sampleCount).toBe(2);
    expect(dto.distToFirstM).toBeNull();
    expect(dto.distToSecondM).toBeCloseTo(0.02 * M_PER_DEG, -1);
  });

  it("a live third scan after the restart lands in the third row", () => {
    const s = store([]);
    restoreOrganicSessionFromJournal(s, hisRun, process.cwd(), getCachedSpeciesDatabase());
    const fix = { latDeg: 0.03, lonDeg: 0, planetRadiusM: RADIUS_M, bodyName: "here", headingDeg: 0, temperatureK: null, gravityG: null };
    ingestExoOrganicJournalLine(s, scan("Sample", 300), fix, process.cwd(), getCachedSpeciesDatabase());
    const dto = buildExoOrganicOverlayDto(s as never, new Map())!;
    expect(dto.sampleCount).toBe(3);
    expect(dto.distToFirstM).toBeNull();
    expect(dto.distToSecondM).toBeNull();
    expect(dto.distToThirdM).toBeCloseTo(0.03 * M_PER_DEG, -1);
  });
});

describe("the odometer setting", () => {
  it("switching it off, as every start does when it is off, leaves the saved run alone", () => {
    const file = resolveOrganicSampleSessionPath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "{}", "utf8");
    const gs = new GameStateStore();
    gs.footTravelOdometerTracking = true;
    gs.footTravelDistanceMeters = 120;
    gs.setFootTravelOdometerEnabled(false);
    expect(existsSync(file)).toBe(true);
    expect(gs.footTravelOdometerTracking).toBe(false);
    expect(gs.footTravelDistanceMeters).toBe(0);
  });
});
