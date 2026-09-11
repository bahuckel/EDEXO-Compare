/**
 * A trace of the right gas is not a habitat.
 *
 * Blu Thua EM-D d12-25 A 1 a is 99.01 % CO₂ with 0.99 % SO₂ in the mix. Recepta needs sulphur
 * dioxide, and both its species were offered on the shown list: `AtmosphereType` names only the
 * dominant gas, so the trace was invisible, and the observation floor then overruled the miss.
 *
 * Below 5 % the species is **demoted**, not deleted — a long shot belongs in the unlikely tier.
 */
import { describe, expect, it } from "vitest";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import { getProjectRoot } from "../src/server/paths.js";
import type { PlanetScan } from "../src/shared/types.js";

const db = loadSpeciesDatabaseFromTree(getProjectRoot());

function scan(over: Partial<PlanetScan>): PlanetScan {
  return {
    BodyName: "Test 1 a",
    BodyID: 1,
    StarSystem: "Test",
    SystemAddress: 1,
    PlanetClass: "Rocky body",
    SurfaceGravity: 2.28,
    SurfaceTemperature: 181,
    SurfacePressure: 9649,
    Landable: true,
    ...over,
  };
}

const receptaIds = (s: PlanetScan) => {
  const run = matchDatabaseToScan(db, s, null, null, { includeBacterium: true });
  const pick = (unlikely: boolean) =>
    run.matches
      .filter((m) => !!m.unlikely === unlikely && m.entry.genusDataDir === "recepta")
      .map((m) => m.entry.id)
      .sort();
  return { shown: pick(false), unlikely: pick(true) };
};

describe("a genus-required gas, measured against the composition", () => {
  it("demotes Recepta on the real body — 0.99 % sulphur dioxide in a CO₂ atmosphere", () => {
    const got = receptaIds(
      scan({
        AtmosphereType: "CarbonDioxide",
        Atmosphere: "thin carbon dioxide atmosphere",
        atmosphereComposition: [
          { Name: "CarbonDioxide", Percent: 99.009911 },
          { Name: "SulphurDioxide", Percent: 0.990099 },
        ],
      }),
    );
    expect(got.shown).toEqual([]);
    expect(got.unlikely.length).toBeGreaterThan(0);
  });

  it("keeps Recepta on the shown list when the gas is the atmosphere", () => {
    const got = receptaIds(
      scan({ AtmosphereType: "SulphurDioxide", Atmosphere: "thin sulphur dioxide atmosphere" }),
    );
    expect(got.shown.length).toBeGreaterThan(0);
  });

  it("accepts a mix that clears the five per cent floor", () => {
    const got = receptaIds(
      scan({
        AtmosphereType: "CarbonDioxide",
        atmosphereComposition: [
          { Name: "CarbonDioxide", Percent: 93 },
          { Name: "SulphurDioxide", Percent: 7 },
        ],
      }),
    );
    expect(got.shown.length).toBeGreaterThan(0);
  });

  it("does not invent a rejection when the scan carries no composition", () => {
    // Older scans and some caches drop AtmosphereComposition. Measuring a trace is then impossible,
    // and a rare body let through costs less than a real one hidden by missing data.
    const withComposition = receptaIds(
      scan({
        AtmosphereType: "SulphurDioxide",
        atmosphereComposition: [{ Name: "SulphurDioxide", Percent: 100 }],
      }),
    );
    const without = receptaIds(scan({ AtmosphereType: "SulphurDioxide" }));
    expect(without.shown).toEqual(withComposition.shown);
  });
});

/**
 * The same rule, said by one species instead of by its genus.
 *
 * A genus can only require a gas when every species in it does. Frutexa cannot — Frutexa acus lives
 * in carbon dioxide — yet Frutexa collum is 133 of 133 recorded sightings on sulphur dioxide. Before
 * `required_atmosphere_type` was readable on a species row, collum was offered on any body holding a
 * trace of it, which is the failure the genus rule exists to stop, in the genus it cannot reach.
 */
describe("a species-required gas, in a genus that cannot declare one", () => {
  const idsFor = (s: PlanetScan, id: string) => {
    const run = matchDatabaseToScan(db, s, null, null, { includeBacterium: true });
    const m = run.matches.find((x) => x.entry.id === id);
    return m ? { found: true, unlikely: !!m.unlikely } : { found: false, unlikely: false };
  };
  const traceSO2 = scan({
    AtmosphereType: "CarbonDioxide",
    Atmosphere: "thin carbon dioxide atmosphere",
    atmosphereComposition: [
      { Name: "CarbonDioxide", Percent: 99.009911 },
      { Name: "SulphurDioxide", Percent: 0.990099 },
    ],
  });

  it("demotes Frutexa collum on a trace of sulphur dioxide", () => {
    expect(idsFor(traceSO2, "frutexa_frutexa_collum").unlikely).toBe(true);
  });

  it("leaves a sibling species in the same genus alone", () => {
    // Frutexa acus declares no required gas, so the rule must not reach it through the genus.
    const acus = idsFor(traceSO2, "frutexa_frutexa_acus");
    if (acus.found) expect(acus.unlikely).toBe(false);
  });

  it("keeps Tussock stigmasis shown when the gas is the atmosphere", () => {
    const got = idsFor(
      scan({ AtmosphereType: "SulphurDioxide", Atmosphere: "thin sulphur dioxide atmosphere" }),
      "tussock_tussock_stigmasis",
    );
    expect(got.found && !got.unlikely).toBe(true);
  });

  /**
   * A required gas is only writable when `AtmosphereType` can stand in for a missing composition.
   *
   * Measured over every landable body in the corpus, counting the times a gas sits at 5 % or more:
   * Neon is named by the type 100 % of the time, Argon 98.3 %, sulphur dioxide 76.5 % — but
   * **nitrogen only 40.3 %**, because Neon-rich and Argon-rich air is nitrogen with a trace of the
   * gas in the label. A nitrogen rule therefore demotes on scans that simply never carried the
   * evidence: it cost Fonticulua upupam its place on Body 5, a body the commander found it on.
   */
  it("writes no required gas the atmosphere type cannot stand in for", () => {
    const UNCONFIRMABLE = new Set(["nitrogen", "oxygen"]);
    const offenders = db.species
      .filter((e) => e.criteria?.atmosphereTypeRequiredAnyOf?.length)
      .flatMap((e) =>
        (e.criteria.atmosphereTypeRequiredAnyOf ?? [])
          .filter((g) => UNCONFIRMABLE.has(String(g).toLowerCase().replace(/[^a-z]/g, "")))
          .map((g) => `${e.id} requires ${g}`),
      );
    expect(offenders).toEqual([]);
  });
});
