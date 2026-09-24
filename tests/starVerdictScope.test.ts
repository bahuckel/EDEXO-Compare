/**
 * Where the "never seen under this host star" term applies — and where it does not.
 *
 * Measured on 82,039 replay slots and on the 3,687 slots of the 2026-09-24 EDDN capture, recorded
 * after the rule was set: a colour taken from a crust material means the star is not the species'
 * rule (Bacterium omentum, verrata; every body carries a material of each rare group), and a colour
 * star follows the system's main star rather than a dwarf the body orbits (star-coloured species fit
 * the main star on 96-99 % of their bodies, the host on 76-94 %).
 */
import { describe, expect, it } from "vitest";
import { matchDatabaseToScan, speciesMatchesExcludingTempPressure } from "../src/server/matchSpecies.js";
import { hostStarVerdict } from "../src/server/speciesHostStarObservations.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import type { PlanetScan, SpeciesDatabase, SpeciesEntry } from "../src/shared/types.js";

const db = loadSpeciesDatabase() as unknown as SpeciesDatabase & { species: SpeciesEntry[] };
const species = (id: string) => db.species.find((e) => e.id === id)!;
const scan = {
  BodyName: "Test 1 a",
  BodyID: 1,
  StarSystem: "Test",
  SystemAddress: 1,
  PlanetClass: "Rocky body",
  Atmosphere: "thin carbon dioxide atmosphere",
  AtmosphereType: "CarbonDioxide",
  SurfaceGravity: 0.1 * 9.80665,
  SurfaceTemperature: 160,
  SurfacePressure: 1000,
  Landable: true,
} as PlanetScan;
const neverSeen = (id: string, host: string, main?: string) =>
  speciesMatchesExcludingTempPressure(species(id), scan, {
    parentStarType: host,
    hostStarClasses: [host],
    ...(main ? { systemMainStarClass: main } : {}),
  }).reasons.some((r) => r.field === "StarType" && /none of the/.test(r.detail));

describe("the observed-host-star term", () => {
  it("still has something to say about these species on their own (the profiles are unchanged)", () => {
    expect(hostStarVerdict(species("bacterium_bacterium_omentum"), "K").kind).toBe("never");
    expect(hostStarVerdict(species("fonticulua_fonticulua_lapida"), "Y").kind).toBe("never");
  });

  it("stays silent for a species whose colour comes from a crust material", () => {
    expect(neverSeen("bacterium_bacterium_omentum", "K", "K")).toBe(false);
  });

  it("accepts a class seen as the main star when the body orbits a dwarf", () => {
    expect(neverSeen("fonticulua_fonticulua_lapida", "Y", "K")).toBe(false);
  });

  it("still demotes when neither the host nor the main star has been seen", () => {
    expect(neverSeen("fonticulua_fonticulua_lapida", "Y", "Y")).toBe(true);
  });
});

describe("restoring a named genus — the atmosphere weighs most", () => {
  it("puts back labiata, not the ammonia-only aureolas, on a carbon-dioxide world round an M dwarf", () => {
    // Labiata's one objection is its M-host gate; aureolas' is the atmosphere its codex does not list.
    const { matches } = matchDatabaseToScan(
      db,
      scan,
      [{ Genus: "$Codex_Ent_Conchas_Genus_Name;", Genus_Localised: "Concha" }],
      null,
      { matchContext: { parentStarType: "M", hostStarClasses: ["M"], systemMainStarClass: "K" } },
    );
    const shown = matches.filter((m) => m.entry.genusDataDir === "concha" && !m.unlikely).map((m) => m.entry.id);
    expect(shown).toContain("concha_concha_labiata");
    expect(shown).not.toContain("concha_concha_aureolas");
  });
});
