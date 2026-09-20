/**
 * Stratum tectonicas had no gravity criterion at all, and it is the one Stratum that needs a ceiling.
 *
 * Found from the commander's own journals: of the High metal content bodies he FSS'd in September
 * that the app offered Bacterium or tectonicas on and that carried **no biological signal**, two were
 * offered tectonicas at **0.631 g** and **1.297 g**. Its corpus tops out at 0.598 g over 3,930
 * bodies; he reads 0.607 as the in-game ceiling. The cap is **0.61**, set deliberately above both,
 * because excluding a body at the edge costs a find and including one just past it costs nothing but
 * a row in a list.
 *
 * The genus is the reason this was missed. `meta.genusWideRequirements.max_gravity` is `null` and the
 * other seven Stratum are Rocky-body species living low — paleas averages 0.134 g, laminamus tops out
 * at 0.327 g — so nothing in the file suggested a Stratum could need a ceiling at all, and tectonicas
 * is the only High metal content one.
 *
 * **Correction.** This comment first said tectonicas "likes heavy worlds", from its `histograms`
 * array piling into the last bin. That array is on **globally shared quantile edges** whose top bin
 * is simply "above 0.2753 g" — more than half of tectonicas' range — so it says nothing about the
 * shape within the species. `displayHistograms`, which is keyed to the species' own min and max, is
 * the one to read, and it says the reverse: the distribution peaks at **0.22–0.25 g** (615 of 3,930
 * bodies) and thins to **4 bodies** in the top bin, 0.564–0.598 g.
 *
 * So the cap is the far edge of a long thin tail, not the edge of a preference. The commander's own
 * FSS record agrees and is sharper: across 270 tectonicas-eligible bodies of his, the share carrying
 * any biology falls from **100 % below 0.35 g** to **19 % above 0.55 g**, monotonically. The cap is
 * still right — 0.598 observed, 0.607 his figure, 0.61 set above both — but it is a ceiling on
 * something already vanishing, not a wall across a species' favourite ground.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { getProjectRoot, getSpeciesDataDir } from "../src/server/paths.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import { speciesMatchesCriteria } from "../src/server/matchSpecies.js";
import { estimatedTemperatureRangeForScan } from "../src/server/planetTemperature.js";
import type { PlanetScan, SpeciesEntry } from "../src/shared/types.js";

const EARTH_G_MS2 = 9.80665;
const root = getProjectRoot();
const db = loadSpeciesDatabase() as unknown as { species: SpeciesEntry[] };
const find = (n: string) => db.species.find((e) => e.displayName.toLowerCase() === n.toLowerCase())!;

/** A High metal content body tectonicas would otherwise take: thin CO2, well above 165 K. */
function body(gravityG: number): PlanetScan {
  return {
    BodyName: "probe",
    BodyID: 1,
    StarSystem: "probe",
    SystemAddress: 1,
    PlanetClass: "High metal content body",
    AtmosphereType: "CarbonDioxide",
    Atmosphere: "thin carbon dioxide atmosphere",
    atmosphereComposition: [{ Name: "CarbonDioxide", Percent: 100 }],
    Volcanism: "",
    SurfaceTemperature: 243,
    SurfaceGravity: gravityG * EARTH_G_MS2,
    SurfacePressure: 300,
    Landable: true,
  } as unknown as PlanetScan;
}

function verdict(entry: SpeciesEntry, scan: PlanetScan) {
  const est = estimatedTemperatureRangeForScan(scan);
  const t = scan.SurfaceTemperature!;
  return speciesMatchesCriteria(entry, scan, { minK: t, maxK: t }, est, { surfacePressureAtm: 0.003 });
}

describe("Stratum tectonicas' gravity ceiling", () => {
  it("is 0.61 g, above both the corpus maximum and the commander's figure", () => {
    const g = find("Stratum tectonicas").criteria.surfaceGravity;
    expect(g?.max).toBe(0.61);
  });

  it("offers it across the range it actually lives in", () => {
    /*
      0.048 to 0.598 g in the corpus. The cap must not clip the tail, because the tail is real — it is
      thin, not empty, and a body at 0.55 g still grows tectonicas about one time in five. Its best
      ground is far lower: the per-species histogram peaks at 0.22-0.25 g.
    */
    for (const gg of [0.05, 0.28, 0.45, 0.598, 0.607]) {
      expect(verdict(find("Stratum tectonicas"), body(gg)).ok, `${gg} g`).toBe(true);
    }
  });

  it("refuses the two bodies that prompted it", () => {
    expect(verdict(find("Stratum tectonicas"), body(0.631)).ok).toBe(false);
    expect(verdict(find("Stratum tectonicas"), body(1.297)).ok).toBe(false);
  });

  it("agrees with the corpus it was measured from", () => {
    /*
      The evidence, not a memory of it. If a profile rebuild ever finds tectonicas above the cap this
      goes red, and the cap should be revisited rather than quietly kept.
    */
    const f = path.join(
      getSpeciesDataDir(root),
      "stratum",
      "exomastery",
      "stratum_tectonicas_exomastery.json",
    );
    if (!existsSync(f)) return;
    const j = JSON.parse(readFileSync(f, "utf8")) as {
      sampleCount?: number;
      numerics?: Record<string, { min: number; max: number; count: number }>;
    };
    const g = j.numerics?.["body.gravity"];
    expect(g, "tectonicas must have a gravity profile").toBeTruthy();
    expect(g!.count).toBeGreaterThan(3000);
    expect(g!.max).toBeLessThan(0.61);
  });

  it("leaves the other Stratum ungated, because none of them needed it", () => {
    /*
      Seven Rocky-body species living low — this is the one exception, and adding a cap to the rest on
      the strength of one measurement would be exactly the over-reach the codex rows were full of.
    */
    for (const n of ["Stratum paleas", "Stratum laminamus", "Stratum araneamus", "Stratum cucumisis"]) {
      expect(find(n).criteria.surfaceGravity?.max, n).toBeUndefined();
    }
  });
});
