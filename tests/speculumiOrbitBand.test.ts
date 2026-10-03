/**
 * Clypeus speculumi under its codex "5 AU" (2026-10-03): kept at the chance the corpus gives it
 * there rather than demoted. EDDN ScanOrganic set: one was logged at 2,327 ls (NGC 6530 Sector DG-X
 * d1-74, body 37); the corpus has 64 of 5,974 at 2,300–2,495 ls and none under 2,000.
 */
import { describe, expect, it } from "vitest";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import { speciesMatchesExcludingTempPressure } from "../src/server/matchSpecies.js";
import type { PlanetScan, SpeciesEntry, SpeciesMatchContext } from "../src/shared/types.js";

const db = loadSpeciesDatabase() as unknown as { species: SpeciesEntry[] };
const speculumi = db.species.find((e) => e.id === "clypeus_clypeus_speculumi")!;
const scan: PlanetScan = {
  BodyName: "Test 1 a",
  BodyID: 1,
  StarSystem: "Test",
  SystemAddress: 1,
  PlanetClass: "Rocky body",
  Atmosphere: "thin carbon dioxide atmosphere",
  AtmosphereType: "CarbonDioxide",
  SurfaceGravity: 0.23 * 9.80665,
  SurfaceTemperature: 195,
  SurfacePressure: 0.09 * 101325,
  Landable: true,
};
const at = (ls: number) =>
  speciesMatchesExcludingTempPressure(speculumi, scan, {
    orbitDistanceFromParentStarLs: ls,
  } as SpeciesMatchContext);

describe("Clypeus speculumi's orbit", () => {
  it("passes at full chance from 2,500 ls", () => {
    const r = at(3000);
    expect(r.ok).toBe(true);
    expect(r.presenceFactor).toBeUndefined();
  });
  it("is kept at a lower chance just under it, where it was found", () => {
    expect(at(2450)).toMatchObject({ ok: true, presenceFactor: 0.14 });
    expect(at(2327)).toMatchObject({ ok: true, presenceFactor: 0.07 });
    expect(at(2100)).toMatchObject({ ok: true, presenceFactor: 0.015 });
  });
  it("is demoted where the corpus has never seen it", () => {
    const r = at(1900);
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.field === "Orbit" && x.soft)).toBe(true);
  });
});

describe("codex gravity limits are the game's m/s², rounded", async () => {
  const { gameGravityLimitG } = await import("../src/server/matchSpecies.js");
  it("reads 0.15 g as 1.5 m/s² and 0.275 g as 2.7 m/s²", () => {
    expect(gameGravityLimitG(0.15)! * 9.80665).toBeCloseTo(1.5, 6);
    expect(gameGravityLimitG(0.275)! * 9.80665).toBeCloseTo(2.7, 6);
    expect(gameGravityLimitG(undefined)).toBeUndefined();
  });
});
