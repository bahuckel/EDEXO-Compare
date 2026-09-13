/**
 * Picking a half-finished run back up after the app restarts.
 *
 * Three things had to be true and none of them were: the saved run has to be *findable* after a
 * restart, the journal has to be read back to the right place, and the two have to be merged rather
 * than one overwriting the other. The commander reported the symptom — restart the app mid-run and
 * the tracker starts from nothing, so there is no way to continue from the second sample.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { restoreOrganicSessionFromJournal } from "../src/server/exoOrganicTracker.js";
import { speciesKeyFromOrganicJournal } from "../src/server/organicTracking.js";
import { organicSampleSessionPath } from "../src/server/organicSampleSessionFile.js";
import { resolveOrganicSampleSessionPath } from "../src/server/paths.js";
import { loadSpeciesDatabase, getCachedSpeciesDatabase } from "../src/server/snapshot.js";
import type { JournalLine } from "../src/shared/types.js";

const SA = 685719759473;
const BODY = 22;

const scan = (scanType: string, species = "Tubus Compagibus", genus = "Tubus") =>
  ({
    event: "ScanOrganic",
    timestamp: "2026-09-12T19:00:35Z",
    ScanType: scanType,
    Genus_Localised: genus,
    Species_Localised: species,
    SystemAddress: SA,
    Body: BODY,
  }) as unknown as JournalLine;

const touchdown = () => ({ event: "Touchdown", timestamp: "2026-09-12T18:55:00Z" }) as unknown as JournalLine;

function store(tracker: unknown = null) {
  return { exoOrganicTracker: tracker } as never;
}

function restored(lines: JournalLine[], tracker: unknown = null) {
  const s = store(tracker);
  const ok = restoreOrganicSessionFromJournal(s, lines, process.cwd(), getCachedSpeciesDatabase());
  return { ok, t: (s as unknown as { exoOrganicTracker: Record<string, unknown> | null }).exoOrganicTracker };
}

beforeAll(() => {
  loadSpeciesDatabase();
});

describe("where the run is saved", () => {
  it("lives beside the user settings, not in the install directory", () => {
    // The portable build unpacks to a new temporary directory every launch, so a file written under
    // the project root is written once and never found again.
    expect(organicSampleSessionPath("C:/anything")).toBe(resolveOrganicSampleSessionPath());
    expect(organicSampleSessionPath("C:/anything")).not.toContain("anything");
  });
});

describe("reading the run back out of the journal", () => {
  it("counts a Log and the Samples after it", () => {
    const { ok, t } = restored([touchdown(), scan("Log"), scan("Sample")]);
    expect(ok).toBe(true);
    expect(t!.recoveredSamples).toBe(2);
  });

  it("stops at the last Analyse, so a finished run is not walked back into", () => {
    // Log, Sample, Sample, Analyse is one complete plant. Nothing is in progress afterwards.
    const lines = [touchdown(), scan("Log"), scan("Sample"), scan("Sample"), scan("Analyse")];
    expect(restored(lines).ok).toBe(false);
  });

  it("picks up what was started after that Analyse", () => {
    const lines = [
      touchdown(),
      scan("Log"),
      scan("Sample"),
      scan("Sample"),
      scan("Analyse"),
      scan("Log", "Stratum Tectonicas", "Stratum"),
      scan("Sample", "Stratum Tectonicas", "Stratum"),
    ];
    const { ok, t } = restored(lines);
    expect(ok).toBe(true);
    expect(t!.speciesDisplay).toBe("Stratum Tectonicas");
    expect(t!.recoveredSamples).toBe(2);
  });

  it("starts the count again when a different species is logged", () => {
    // Walking off a half-sampled plant for a better one is ordinary play.
    const lines = [
      touchdown(),
      scan("Log"),
      scan("Sample"),
      scan("Log", "Osseus Pumice", "Osseus"),
    ];
    const { ok, t } = restored(lines);
    expect(ok).toBe(true);
    expect(t!.speciesDisplay).toBe("Osseus Pumice");
    expect(t!.recoveredSamples).toBe(1);
  });

  it("ignores anything before the landing", () => {
    const lines = [scan("Log"), scan("Sample"), touchdown()];
    expect(restored(lines).ok).toBe(false);
  });
});

describe("merging with the run restored from disk", () => {
  // Built the way the tracker builds it, so a change to the key shape fails loudly here.
  const speciesKey = speciesKeyFromOrganicJournal(scan("Log"));
  const saved = (anchors: number, recovered = 0) => ({
    bundleKey: `${SA}:${BODY}::${speciesKey}`,
    bodyKey: `${SA}:${BODY}`,
    speciesKey,
    speciesDisplay: "Tubus Compagibus",
    genusLocalised: "Tubus",
    bodyNameNorm: "body 22",
    minSampleDistanceM: 100,
    anchors: Array.from({ length: anchors }, (_, i) => ({
      latDeg: -12 + i / 10,
      lonDeg: 32,
      planetRadiusM: 5_246_376,
    })),
    recoveredSamples: recovered,
    phase: "tracking",
    celebrationUntil: 0,
  });

  it("uses the same bundle key the journal restore builds", () => {
    // Guards the two tests below from passing for the wrong reason.
    const { t } = restored([touchdown(), scan("Log")]);
    expect(t!.bundleKey).toBe(saved(0).bundleKey);
  });

  it("keeps the saved positions instead of overwriting them with a bare count", () => {
    // The anchors are the only record of where the plants were — `ScanOrganic` has no coordinates.
    const { ok, t } = restored([touchdown(), scan("Log"), scan("Sample")], saved(2));
    expect(ok).toBe(true);
    expect(t!.anchors).toHaveLength(2);
    expect(t!.recoveredSamples).toBe(0);
  });

  it("tops up a scan taken while the app was closed", () => {
    // Two in the log, one placed: the second happened and cannot be placed, which is what
    // `recoveredSamples` means.
    const { ok, t } = restored([touchdown(), scan("Log"), scan("Sample")], saved(1));
    expect(ok).toBe(true);
    expect(t!.anchors).toHaveLength(1);
    expect(t!.recoveredSamples).toBe(1);
  });

  it("replaces a saved run for a different plant", () => {
    const lines = [touchdown(), scan("Log", "Osseus Pumice", "Osseus")];
    const { ok, t } = restored(lines, saved(2));
    expect(ok).toBe(true);
    expect(t!.speciesDisplay).toBe("Osseus Pumice");
    expect(t!.anchors).toHaveLength(0);
  });
});
