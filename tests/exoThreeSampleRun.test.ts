/**
 * A whole sampling run, as the journal actually writes one.
 *
 * The journal emits `Log, Sample, Sample, Analyse` — four events for three plants, because Log is
 * the first plant and Analyse fires seconds after the third at the same spot. The tracker read that
 * as two plants and a restart: the third Sample wiped the run and began a new one, so the overlay
 * had no "Scan 3" distance, and Analyse then found a session holding one sample and wiped that too.
 * The commander reported the missing distance; the vanished "Complete" was the same bug.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { ingestExoOrganicJournalLine, buildExoOrganicOverlayDto } from "../src/server/exoOrganicTracker.js";
import { loadSpeciesDatabase, getCachedSpeciesDatabase } from "../src/server/snapshot.js";
import type { PriceIndex } from "../src/server/priceList.js";

const BODY = "Smojai UJ-F b13-0 B 4";
const RADIUS_M = 5_246_376;

/** Three plants, far enough apart that the great-circle distances are unmistakable. */
const PLANTS = [
  { latDeg: -12.5, lonDeg: 32.5 },
  { latDeg: -12.4, lonDeg: 32.5 },
  { latDeg: -12.3, lonDeg: 32.5 },
];

function fixAt(p: { latDeg: number; lonDeg: number }) {
  return {
    latDeg: p.latDeg,
    lonDeg: p.lonDeg,
    planetRadiusM: RADIUS_M,
    bodyName: BODY,
    headingDeg: 62,
    temperatureK: null,
    gravityG: null,
  };
}

function newStore() {
  return {
    exoOrganicTracker: null,
    exoOrganicLastFix: null,
    footSessionBodyKey: null,
    footSessionBodyNameNorm: null,
    footTravelOdometerEnabled: false,
    firstFootfallBodies: new Set<string>(),
    surfaceSampleMarks: [] as unknown[],
    explorationScans: new Map<string, { surfaceGravity?: number; radius?: number }>(),
    surfaceShipMark: null,
    addSurfaceSampleMark() {},
    beginFootTravelOdometerSession() {},
  } as never;
}

function line(scanType: string, species = "Tubus Compagibus", genus = "Tubus") {
  return {
    event: "ScanOrganic",
    timestamp: "2026-09-12T19:00:35Z",
    ScanType: scanType,
    Genus_Localised: genus,
    Species_Localised: species,
    WasLogged: false,
    SystemAddress: 685719759473,
    Body: 22,
  } as never;
}

/** Walks the four events, each at its own place, and hands back the store. */
function runAll(steps: string[] = ["Log", "Sample", "Sample", "Analyse"]) {
  const store = newStore();
  const db = getCachedSpeciesDatabase();
  steps.forEach((scanType, i) => {
    // Analyse happens where the third Sample did — the commander has not moved.
    const at = PLANTS[Math.min(i, PLANTS.length - 1)]!;
    ingestExoOrganicJournalLine(store, line(scanType), fixAt(at), process.cwd(), db);
  });
  return store as unknown as {
    exoOrganicTracker: { anchors: unknown[]; phase: string } | null;
    exoOrganicLastFix: unknown;
  };
}

beforeAll(() => {
  loadSpeciesDatabase();
});

describe("a three-plant run", () => {
  it("keeps all three places instead of restarting on the third", () => {
    const store = runAll();
    expect(store.exoOrganicTracker).not.toBeNull();
    expect(store.exoOrganicTracker!.anchors).toHaveLength(3);
  });

  it("ends in the celebration, not wiped", () => {
    const store = runAll();
    expect(store.exoOrganicTracker!.phase).toBe("celebrate");
  });

  it("does not add a fourth anchor for the Analyse at the third plant", () => {
    // Analyse is the same spot as the third Sample. A second anchor there would be the same plant
    // twice, and would push the real third plant out of the "Scan 3" slot.
    const store = runAll();
    const anchors = store.exoOrganicTracker!.anchors as { latDeg: number }[];
    expect(anchors.map((a) => a.latDeg)).toEqual(PLANTS.map((p) => p.latDeg));
  });

  it("still takes the Analyse position when the third Sample had no fix", () => {
    // `Status.json` between writes, or the app started mid-run: Analyse is the last chance to learn
    // where the commander was standing.
    const store = newStore() as unknown as { exoOrganicTracker: { anchors: unknown[] } | null };
    const db = getCachedSpeciesDatabase();
    ingestExoOrganicJournalLine(store as never, line("Log"), fixAt(PLANTS[0]!), process.cwd(), db);
    ingestExoOrganicJournalLine(store as never, line("Sample"), fixAt(PLANTS[1]!), process.cwd(), db);
    ingestExoOrganicJournalLine(store as never, line("Sample"), null, process.cwd(), db);
    ingestExoOrganicJournalLine(store as never, line("Analyse"), fixAt(PLANTS[2]!), process.cwd(), db);
    expect(store.exoOrganicTracker!.anchors).toHaveLength(3);
  });

  it("reports a distance to every plant, the third included", () => {
    const store = runAll();
    // The commander is standing where the run ended.
    (store as unknown as { exoOrganicLastFix: unknown }).exoOrganicLastFix = fixAt(PLANTS[2]!);
    const dto = buildExoOrganicOverlayDto(store as never, new Map() as unknown as PriceIndex);
    expect(dto).not.toBeNull();
    expect(dto!.distToFirstM).toBeGreaterThan(0);
    expect(dto!.distToSecondM).toBeGreaterThan(0);
    expect(dto!.distToThirdM).not.toBeNull();
  });

  it("starts fresh when the next species is logged", () => {
    // The restart guard still has to fire; it was only ever the *third plant* that was not a restart.
    const store = runAll();
    const db = getCachedSpeciesDatabase();
    ingestExoOrganicJournalLine(
      store as never,
      line("Log", "Stratum Tectonicas", "Stratum"),
      fixAt(PLANTS[0]!),
      process.cwd(),
      db,
    );
    expect(store.exoOrganicTracker!.anchors).toHaveLength(1);
  });
});
