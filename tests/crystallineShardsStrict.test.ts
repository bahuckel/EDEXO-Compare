/**
 * Crystalline Shards are listed only when every condition is known and met (owner, 2026-10-04: "show
 * crystalline only if they meet all conditions, no guess work"). They showed on cold rocks before the
 * system's other bodies were known, since an unfinished honk left the companion-body gate unresolved,
 * and after the full scan they went to "unlikely" instead of away.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import type { GenusHint, PlanetScan, SpeciesMatchContext } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = loadSpeciesDatabaseFromTree(root);
const SHARDS = "crystalline_shards_crystalline_shards";

/** A cold airless icy moon, the kind Shards grow on. */
const scan = {
  BodyName: "Test Shards 4 a",
  BodyID: 12,
  StarSystem: "Test Shards",
  SystemAddress: 1234567,
  PlanetClass: "Icy body",
  Atmosphere: "",
  AtmosphereType: "None",
  SurfaceGravity: 0.9,
  SurfaceTemperature: 120,
  SurfacePressure: 0,
  Landable: true,
} as unknown as PlanetScan;

const base: SpeciesMatchContext = {
  parentStarType: "K",
  hostStarClasses: ["K"],
  systemMainStarClass: "K",
  distanceFromArrivalLs: 20_000,
} as SpeciesMatchContext;

const shards = (ctx: Partial<SpeciesMatchContext>, hints: GenusHint[] | null = null) =>
  matchDatabaseToScan(db, scan, hints, null, { matchContext: { ...base, ...ctx }, biologicalSignals: 1 }).matches.find(
    (m) => m.entry.id === SHARDS,
  );

describe("Crystalline Shards: every condition, or not listed", () => {
  it("carry the flag from their data file", () => {
    expect(db.species.find((e) => e.id === SHARDS)?.criteria?.allConditionsRequired).toBe(true);
  });

  it("are listed when a companion body is scanned, the host is allowed and the body is far enough out", () => {
    const m = shards({ systemBodyClasses: ["Earthlike body"], systemBodyListComplete: false });
    expect(m).toBeDefined();
    expect(m!.unlikely).toBeFalsy();
  });

  it("are not listed before the system's other bodies are known", () => {
    expect(shards({ systemBodyClasses: [], systemBodyListComplete: false })).toBeUndefined();
    expect(shards({ systemBodyClasses: ["Icy body", "Rocky body"], systemBodyListComplete: false })).toBeUndefined();
  });

  it("are not listed, not even as unlikely, once the full scan finds no companion body", () => {
    expect(shards({ systemBodyClasses: ["Icy body", "High metal content body"], systemBodyListComplete: true })).toBeUndefined();
  });

  it("are not listed when the distance from arrival is short or unknown", () => {
    const ok = { systemBodyClasses: ["Water world"], systemBodyListComplete: true };
    expect(shards({ ...ok, distanceFromArrivalLs: 5_000 })).toBeUndefined();
    expect(shards({ ...ok, distanceFromArrivalLs: 11_500 })).toBeUndefined();
    expect(shards({ ...ok, distanceFromArrivalLs: undefined })).toBeUndefined();
  });

  it("are not listed while the body's host star is unknown", () => {
    expect(shards({ systemBodyClasses: ["Earthlike body"], hostStarClasses: [], systemMainStarClass: undefined })).toBeUndefined();
  });

  it("are listed when a DSS names the genus, whatever else is known", () => {
    const dss: GenusHint[] = [{ Genus: "$Codex_Ent_Ground_Struct_Ice_Name;", Genus_Localised: "Crystalline Shards" }];
    expect(shards({ systemBodyClasses: [], systemBodyListComplete: false }, dss)).toBeDefined();
  });
});
