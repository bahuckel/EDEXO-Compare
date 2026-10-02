/**
 * Recepta Deltahedronix on an icy body with one biological signal (owner, 2026-10-02: shrink the
 * Recepta list only if no real Recepta signal is lost). 0 of 6,801 such Recepta bodies in the Spansh
 * dump, 0 of 12 EDDN sightings, 0 in the commander's journals — so it steps down to unlikely there,
 * and only there: two signals, another planet type, or an assumed count leave it shown.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { matchDatabaseToScan, shownSpeciesMatches } from "../src/server/matchSpecies.js";
import type { GenusHint, PlanetScan } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = loadSpeciesDatabaseFromTree(root);

/** A thin sulphur dioxide icy body inside all three Recepta ranges; made up, the journal's shapes. */
const scan = (planetClass: string) =>
  ({
    BodyName: "Test Sector AB-C d1-2 3 a",
    BodyID: 9,
    StarSystem: "Test Sector AB-C d1-2",
    SystemAddress: 1234567890123,
    PlanetClass: planetClass,
    Atmosphere: "thin sulfur dioxide atmosphere",
    AtmosphereType: "SulphurDioxide",
    atmosphereComposition: [{ Name: "SulphurDioxide", Percent: 100 }],
    SurfaceTemperature: 140,
    SurfaceGravity: 0.2 * 9.80665,
    SurfacePressure: 300,
    Volcanism: "",
    Landable: true,
  }) as unknown as PlanetScan;

const recepta = [{ Genus_Localised: "Recepta" } as unknown as GenusHint];

function receptaRows(planetClass: string, signals: number, signalCountAssumed = false) {
  const run = matchDatabaseToScan(db, scan(planetClass), recepta, null, {
    includeBacterium: true,
    biologicalSignals: signals,
    signalCountAssumed,
  });
  const all = run.matches.filter((m) => m.entry.genusDataDir === "recepta");
  const shown = new Set(shownSpeciesMatches(all).map((m) => m.entry.displayName));
  return { all: all.map((m) => m.entry.displayName), shown };
}

describe("Recepta Deltahedronix on a one-signal icy body", () => {
  it("is demoted, never removed, and the other two stay shown", () => {
    const { all, shown } = receptaRows("Icy body", 1);
    expect(all.some((n) => n.includes("deltahedronix"))).toBe(true);
    expect([...shown].some((n) => n.includes("deltahedronix"))).toBe(false);
    expect([...shown].some((n) => n.includes("umbrux"))).toBe(true);
    expect([...shown].some((n) => n.includes("conditivus"))).toBe(true);
  });

  it("stays shown with two signals, on another planet type, or on an assumed count", () => {
    for (const [cls, n, assumed] of [
      ["Icy body", 2, false],
      ["Rocky body", 1, false],
      ["Icy body", 1, true],
    ] as const) {
      const { shown } = receptaRows(cls, n, assumed);
      expect([...shown].some((x) => x.includes("deltahedronix")), `${cls} ${n} ${assumed}`).toBe(true);
    }
  });
});
