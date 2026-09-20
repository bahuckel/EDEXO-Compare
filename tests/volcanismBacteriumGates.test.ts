/**
 * Three Bacterium gated on the wrong axis, and the measurement that says which axis is right.
 *
 * Omentum, scopulum and verrata each carried `atmosphere: ["Neon", "Neon-rich"]` as a hard wall
 * alongside a volcanism requirement. The corpus says the wall is on the weak axis:
 *
 * ```
 * species     volcanic   ambient   x      its atmospheres
 * omentum       95.5%      11.3%   8.4    Neon 45, Neon-rich 32, Argon 9, Water-rich 5, Methane 5, none 5
 * scopulum     100.0%       9.0%  11.1    Neon 59, Argon 24, Neon-rich 12, Methane 6
 * verrata      100.0%       6.4%  15.6    Argon 38, Neon 35, Neon-rich 8, Water 8, Ammonia 8, Oxygen 4
 * ```
 *
 * Narrowed to the volcanism family each row names, the enrichment is 21.8x, 40.7x and 44.1x over the
 * ambient rate in the population each species actually lives in. Verrata's commonest atmosphere is
 * **Argon**, which its row never listed at all.
 *
 * The ambient figures come from the galaxy body file — 10.3 M bodies carrying biology — weighted by
 * each species' own class-and-atmosphere mix, so a neon dweller is compared against neon worlds. A
 * raw percentage cannot do this: Bacterium bullaris is volcanic 8.3% of the time, which looks like a
 * pattern until the ambient rate turns out to be 2.7%.
 *
 * Found through Bacterium omentum on `Synookooe WW-F b55-0 A 2 a` — Thin Methane with minor nitrogen
 * magma, which the app demoted and the commander then sampled. The sibling moon one orbit out, same
 * class and same Thin Methane but no volcanism, carried Bacterium bullaris instead. The volcanism
 * decides which Bacterium takes the slot; the atmosphere was never the wall.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { getProjectRoot, getSpeciesDataDir } from "../src/server/paths.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import { speciesMatchesCriteria } from "../src/server/matchSpecies.js";
import { estimatedTemperatureRangeForScan } from "../src/server/planetTemperature.js";
import type { PlanetScan, SpeciesEntry } from "../src/shared/types.js";

const root = getProjectRoot();
const db = loadSpeciesDatabase() as unknown as { species: SpeciesEntry[] };
const find = (n: string) => db.species.find((e) => e.displayName.toLowerCase() === n.toLowerCase())!;

const REWORKED = ["Bacterium omentum", "Bacterium scopulum", "Bacterium verrata"] as const;

/** The moon the commander sampled omentum on, out of his journal. */
const SYNOOKOOE_A2A: PlanetScan = {
  BodyName: "Synookooe WW-F b55-0 A 2 a",
  BodyID: 22,
  StarSystem: "Synookooe WW-F b55-0",
  SystemAddress: 798463310297,
  PlanetClass: "Icy body",
  AtmosphereType: "Methane",
  Atmosphere: "thin methane atmosphere",
  SurfaceGravity: 0.365388,
  SurfaceTemperature: 99.793587,
  SurfacePressure: 6710.667969,
  Volcanism: "minor nitrogen magma volcanism",
  Landable: true,
};

function verdict(entry: SpeciesEntry, scan: PlanetScan) {
  const est = estimatedTemperatureRangeForScan(scan);
  const t = scan.SurfaceTemperature;
  const band = t != null ? { minK: t, maxK: t } : est ? { minK: est.tMin, maxK: est.tMax } : null;
  return speciesMatchesCriteria(entry, scan, band, est, { surfacePressureAtm: 0.066 });
}

describe("the three Bacterium whose wall was on the wrong axis", () => {
  it("no longer gates any of them on Neon", () => {
    for (const name of REWORKED) {
      expect(find(name).criteria.atmosphereTypeAnyOf ?? [], name).toEqual([]);
    }
  });

  it("keeps the volcanism requirement, which is the axis the corpus supports", () => {
    // Dropping the wrong gate must not drop the right one — without volcanism these become far too
    // loose, and the whole finding is that volcanism is what decides them.
    expect(find("Bacterium omentum").criteria.volcanismIncludes).toEqual(["Nitrogen", "Ammonia"]);
    expect(find("Bacterium scopulum").criteria.volcanismIncludes).toEqual(["Carbon", "Methane"]);
    expect(find("Bacterium verrata").criteria.volcanismIncludes).toEqual(["Water"]);
  });

  it("offers omentum on the methane moon the commander sampled it on", () => {
    expect(verdict(find("Bacterium omentum"), SYNOOKOOE_A2A).ok).toBe(true);
  });

  it("still refuses omentum on the sibling moon, which has no volcanism", () => {
    /*
      The control, and the reason this is a narrowing rather than a loosening. One orbit out, same
      class and same Thin Methane, no volcanism — and that moon carried Bacterium bullaris. If the
      change made omentum appear there too it would have destroyed the distinction it was made from.
    */
    const sibling: PlanetScan = { ...SYNOOKOOE_A2A, BodyName: "Synookooe WW-F b55-0 A 2 d", BodyID: 24 };
    delete (sibling as { Volcanism?: string }).Volcanism;
    expect(verdict(find("Bacterium omentum"), sibling).ok).toBe(false);
  });

  it("refuses them where the volcanism is the wrong family", () => {
    // Water volcanism is verrata's, not omentum's; the rows must not collapse into each other.
    const water: PlanetScan = { ...SYNOOKOOE_A2A, Volcanism: "minor water magma volcanism" };
    expect(verdict(find("Bacterium omentum"), water).ok).toBe(false);
    expect(verdict(find("Bacterium verrata"), water).ok).toBe(true);
  });

  it("agrees with the corpus it was corrected from", () => {
    /*
      The evidence, not a memory of it. Each species' volcanism share is the claim; if a profile
      rebuild moves it, this says so rather than letting the justification go stale.
    */
    const share = (species: string, re: RegExp) => {
      const slug = species.toLowerCase().replace(/\s+/g, "_");
      const f = path.join(getSpeciesDataDir(root), "bacterium", "exomastery", `${slug}_exomastery.json`);
      if (!existsSync(f)) return null;
      const j = JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
      const dig = (o: unknown, d = 0): Record<string, number> | null => {
        if (d > 3 || !o || typeof o !== "object") return null;
        for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
          if (/volcanismType$/i.test(k)) return v as Record<string, number>;
          const r = dig(v, d + 1);
          if (r) return r;
        }
        return null;
      };
      const h = dig(j);
      if (!h) return null;
      const total = Object.values(h).reduce((n, v) => n + Number(v), 0);
      const hit = Object.entries(h)
        .filter(([k]) => re.test(k))
        .reduce((n, [, v]) => n + Number(v), 0);
      return total > 0 ? hit / total : null;
    };
    // 95.5%, 100% and 100% when this was written. The claim is "nearly always", not the exact figure.
    expect(share("Bacterium omentum", /nitrogen|ammonia/i)!).toBeGreaterThan(0.85);
    expect(share("Bacterium scopulum", /carbon|methane/i)!).toBeGreaterThan(0.9);
    expect(share("Bacterium verrata", /water/i)!).toBeGreaterThan(0.9);
  });

  it("leaves the atmosphere-gated Bacterium alone", () => {
    /*
      Nine of the thirteen Bacterium are decided by atmosphere and are right as they stand — aurasus
      is 6,889 bodies and 0% volcanic. Correcting three rows must not become a reason to open the
      rest.
    */
    for (const [name, atmo] of [
      ["Bacterium aurasus", "CarbonDioxide"],
      ["Bacterium bullaris", "Methane"],
      ["Bacterium alcyoneum", "Ammonia"],
      ["Bacterium informem", "Nitrogen"],
    ] as const) {
      const c = find(name).criteria;
      expect(c.atmosphereTypeAnyOf ?? [], name).toContain(atmo);
      expect(c.volcanismIncludes ?? [], name).toEqual([]);
    }
  });
});
