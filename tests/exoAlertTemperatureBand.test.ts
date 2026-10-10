/**
 * A confirmed species is judged at the body's measured temperature, as the matcher judges it, not at
 * the estimator's band (owner, 2026-10-10: Phraa Blao ED-Q d6-82 AB 1 e, 195.2 K, thin CO2, Frutexa
 * fera logged and listed at 28 %, reported "Live scan vs codex" against an estimated 308 K).
 */
import { describe, expect, it } from "vitest";
import type { BodyExoState, PlanetScan, SpeciesMatch } from "../src/shared/types.js";
import { computeExoDataAlertsForBody } from "../src/server/exoDataConsistencyAlerts.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";

const scan = {
  BodyName: "Phraa Blao ED-Q d6-82 AB 1 e",
  BodyID: 22,
  PlanetClass: "Rocky body",
  Atmosphere: "thin carbon dioxide atmosphere",
  AtmosphereType: "CarbonDioxide",
  AtmosphereComposition: [{ Name: "CarbonDioxide", Percent: 100 }],
  Volcanism: "",
  SurfaceGravity: 2.06932,
  SurfaceTemperature: 195.170029,
  SurfacePressure: 8329.529297,
  Landable: true,
  DistanceFromArrivalLS: 4437.49,
  Parents: [{ Null: 21 }, { Planet: 15 }, { Null: 0 }],
  TidalLock: true,
  MassEM: 0.015912,
  Radius: 1750687.25,
  SemiMajorAxis: 43946321.6,
} as unknown as PlanetScan;

describe("confirmed-species alerts use the matcher's temperature band", () => {
  it("does not flag Frutexa fera at 195.2 K when the estimate runs past its cap", () => {
    const db = loadSpeciesDatabase();
    const fera = db.species.find((s) => /fera/i.test(s.id))!;
    const body = {
      key: "2830156912315:22",
      biologicalSignals: 7,
      genusHints: [],
      organicGenusLocks: [
        { genusLocalised: "Frutexa", speciesLocalised: "Frutexa Fera", variantLocalised: "Frutexa Fera - Green", source: "codex" },
      ],
    } as unknown as BodyExoState;
    const { alerts } = computeExoDataAlertsForBody({
      body,
      mergedScan: scan,
      matches: [{ entry: fera, reasons: [] } as unknown as SpeciesMatch],
      speciesMatchCtx: { parentStarType: "F", systemMainStarClass: "F", hostStarClasses: ["F", "K"] },
      db,
      includeBacterium: true,
    });
    expect(alerts.filter((a) => a.speciesEntryId === fera.id)).toEqual([]);
  });
});
