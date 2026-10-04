/**
 * The Thargoid entries (owner, 2026-10-04: "nice to have if there, otherwise they stay hidden"):
 * Coral Root, Barnacle Matrix, Mega Barnacles and the spires, sampled on foot with the genetic
 * sampler. Never predicted from the body; listed when a DSS names their genus, or once logged.
 */
import { describe, expect, it } from "vitest";
import { getCachedPriceIndex, loadSpeciesDatabase } from "../src/server/snapshot.js";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import { collectResolvedOrganicLockSpeciesIds } from "../src/server/organicLocks.js";
import { dssHintsMissingCandidateGenera } from "../src/server/footScannedCatalog.js";
import { lookupPriceStrict } from "../src/server/priceList.js";
import type { GenusHint, OrganicGenusLock, PlanetScan, SpeciesDatabase, SpeciesMatch } from "../src/shared/types.js";

const db = loadSpeciesDatabase() as unknown as SpeciesDatabase;
const thargoid = (id: string) => id.startsWith("thargoid_");

/** HIP 19870 3 b, where EDDN has both sampled on foot (2026-10-01). */
const body: PlanetScan = {
  BodyName: "HIP 19870 3 b",
  BodyID: 26,
  StarSystem: "HIP 19870",
  SystemAddress: 1178708461915,
  PlanetClass: "Rocky body",
  Atmosphere: "thin water atmosphere",
  AtmosphereType: "Water",
  SurfaceGravity: 0.0496 * 9.80665,
  SurfaceTemperature: 410.8,
  SurfacePressure: 0.05 * 101325,
  Landable: true,
};
const run = (hints: GenusHint[] | null, locks: OrganicGenusLock[] | null = null) =>
  matchDatabaseToScan(db, body, hints, locks, { includeBacterium: true }).matches.map((m) => m.entry.id);

describe("the Thargoid entries", () => {
  it("are in the database, DSS-only, each with its Vista price", () => {
    const rows = db.species.filter((e) => thargoid(e.id));
    expect(rows.map((e) => e.displayName).sort()).toEqual([
      "Major Thargoid Spire",
      "Minor Thargoid Spire",
      "Primary Thargoid Spire",
      "Thargoid Barnacle Matrix",
      "Thargoid Coral Root",
      "Thargoid Mega Barnacles",
      "Thargoid Spire",
    ]);
    expect(rows.every((e) => e.dssOnly)).toBe(true);
    const prices = getCachedPriceIndex();
    const price = (n: string) => lookupPriceStrict(prices, n, n);
    expect(price("Thargoid Coral Root")).toBe(1_924_600);
    expect(price("Thargoid Barnacle Matrix")).toBe(2_313_500);
    expect(price("Thargoid Mega Barnacles")).toBe(2_313_500);
    expect(price("Major Thargoid Spire")).toBe(2_247_100);
  });

  it("are never predicted from the body: nothing before a DSS, nothing when the DSS names other genera", () => {
    expect(run(null).filter(thargoid)).toEqual([]);
    expect(run([{ Genus: "$Codex_Ent_Bacterial_Genus_Name;", Genus_Localised: "Bacterium" }]).filter(thargoid)).toEqual([]);
  });

  it("are listed when the DSS names their genus, by the game's symbol or its name", () => {
    expect(run([{ Genus: "$Codex_Ent_Thargoid_Coral_Name;", Genus_Localised: "" }]).filter(thargoid)).toEqual([
      "thargoid_coral_coral_root",
    ]);
    const barnacles = run([{ Genus: "$Codex_Ent_Barnacles_Name;", Genus_Localised: "Barnacles" }]).filter(thargoid);
    expect(barnacles.sort()).toEqual(["thargoid_barnacles_barnacle_matrix", "thargoid_barnacles_mega_barnacles"]);
  });

  it("a genus the DSS named and the app listed is not also called missing", () => {
    const hints = [{ Genus: "$Codex_Ent_Barnacles_Name;", Genus_Localised: "Barnacles" }];
    const r = matchDatabaseToScan(db, body, hints, null, { includeBacterium: true });
    expect(dssHintsMissingCandidateGenera(hints, r.matches as SpeciesMatch[])).toEqual([]);
  });

  it("one logged on foot is found and named, symbols only (EDDN) or the game's labels", () => {
    const coral: OrganicGenusLock = {
      genusLocalised: "",
      genusSymbol: "$Codex_Ent_Thargoid_Coral_Name;",
      speciesLocalised: "$Codex_Ent_Thargoid_Coral_Root_Name;",
      speciesSymbol: "$Codex_Ent_Thargoid_Coral_Root_Name;",
      variantLocalised: "",
    };
    expect(collectResolvedOrganicLockSpeciesIds([coral], db)).toEqual(["thargoid_coral_coral_root"]);
    expect(run(null, [coral])).toContain("thargoid_coral_coral_root");
    // "Thargoid Spire" sits inside "Major Thargoid Spire": the exact name wins.
    const spire = (name: string): OrganicGenusLock => ({
      genusLocalised: "Thargoid Spires",
      genusSymbol: "$Codex_Ent_Thargoid_Spire_Name;",
      speciesLocalised: name,
      speciesSymbol: "",
      variantLocalised: "",
    });
    expect(collectResolvedOrganicLockSpeciesIds([spire("Major Thargoid Spire")], db)).toEqual(["thargoid_spires_major"]);
    expect(collectResolvedOrganicLockSpeciesIds([spire("Thargoid Spire")], db)).toEqual(["thargoid_spires_spire"]);
  });
});
