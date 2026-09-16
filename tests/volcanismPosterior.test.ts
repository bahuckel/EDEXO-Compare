/**
 * Volcanism reaches the posterior. It never did before, on any body, for any species.
 *
 * The owner, after the gate came off: *"no gates, put it in the posterior … If we have a body with
 * volcanism, if there is a bacteria with mode 90-100 % with any volcanism, but the other bacteria
 * has only 15 % on planets with volcanism, it should show the one with higher mode value."*
 *
 * The profiles have held the numbers all along — `body.volcanismType` is one of ten categorical
 * paths every exomastery profile ships — and three things stopped any of it being used:
 *
 * 1. **A quiet body returned `null`.** The journal writes `"Volcanism": ""` when there is none, and
 *    `valueForCategoricalPath` folded that to null, which the scorer reads as "no opinion". The case
 *    with the most to say — Bacterium aurasus is 6,889 of 6,889 on quiet bodies — was the one case
 *    that could never be scored.
 * 2. **The two sides spelled it differently.** A journal says `minor nitrogen magma volcanism`, a
 *    profile says `Minor Nitrogen Magma`. `bucketCategoricalValue` stripped the intensity but not
 *    the trailing word, so `nitrogen magma volcanism` was compared against `nitrogen magma` and
 *    never matched. Volcanic bodies scored nothing either.
 * 3. **A species with one observed value was skipped.** `categories <= 1` dropped exactly the
 *    profiles that are certain — aurasus and informem are 100 % quiet — on the grounds that a single
 *    category cannot discriminate. Within one profile that is true; between candidates on one body
 *    it is the strongest statement available.
 *
 * What the corpus says, and what the posterior now says with it:
 *
 * ```
 * species     n     volcanic   ambient      x
 * verrata     26     100.0%     19.12%    5.23
 * scopulum    17     100.0%     18.15%    5.51
 * omentum     22      95.5%     42.88%    2.23
 * tela       833      15.2%      1.99%    7.67
 * acies      213       2.3%     12.18%    0.19   <- avoids it
 * aurasus   6889       0.0%      0.13%    0.00
 * ```
 *
 * Ambient is the rate among the 10.3 M landable bodies in `edexo-bio-bodies.bin` that carry
 * biology, weighted by each species' own class-and-atmosphere mix — a raw percentage cannot be read
 * on this axis, which is how tela's 15.2 % was mistaken for evidence *against* volcanism.
 *
 * No gate was added and none was restored. One body, three volcanisms, three different answers.
 */
import { describe, expect, it } from "vitest";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import { speciesLogScore, VOLCANISM_TERM_WEIGHT } from "../src/server/speciesLikelihood.js";
import { bucketCategoricalValue, NO_VOLCANISM } from "../src/feeder/parameterImportance.js";
import { valueForCategoricalPath } from "../src/server/exomasteryProfile.js";
import type { PlanetScan, SpeciesEntry } from "../src/shared/types.js";

const db = loadSpeciesDatabase() as unknown as { species: SpeciesEntry[] };
const find = (n: string) => db.species.find((e) => e.displayName.toLowerCase() === n.toLowerCase())!;

/** One neon moon. Only `Volcanism` ever changes between the cases below. */
const MOON = {
  BodyName: "probe",
  BodyID: 1,
  StarSystem: "probe",
  SystemAddress: 1,
  PlanetClass: "Icy body",
  AtmosphereType: "Neon",
  Atmosphere: "thin neon atmosphere",
  atmosphereComposition: [{ Name: "Neon", Percent: 100 }],
  SurfaceGravity: 0.35,
  SurfaceTemperature: 52,
  SurfacePressure: 268,
  Landable: true,
} as unknown as PlanetScan;

const withVolcanism = (v: string): PlanetScan => ({ ...MOON, Volcanism: v }) as PlanetScan;
const QUIET = withVolcanism("");
const NITROGEN = withVolcanism("minor nitrogen magma volcanism");
const WATER = withVolcanism("major water magma volcanism");

const CANDIDATES = [
  "Bacterium omentum",
  "Bacterium acies",
  "Bacterium tela",
  "Bacterium aurasus",
  "Bacterium verrata",
] as const;

const score = (name: string, scan: PlanetScan) => speciesLogScore(find(name), scan, null, null, {});

/** The candidates in posterior order, best first, stripped of the genus for readability. */
function order(scan: PlanetScan): string[] {
  return CANDIDATES.map((s) => ({ s, r: score(s, scan) }))
    .filter((x) => x.r)
    .sort((a, b) => b.r!.logScore - a.r!.logScore)
    .map((x) => x.s.replace("Bacterium ", ""));
}

describe("volcanism in the posterior", () => {
  it("reads a quiet body as an observation, not as missing data", () => {
    /*
      The whole first bug in one assertion. An empty `Volcanism` is the journal saying "none"; a
      field that is absent is the journal saying nothing, and the two must not collapse.
    */
    expect(valueForCategoricalPath("body.volcanismType", QUIET, null, null)).toBe(NO_VOLCANISM);
    expect(valueForCategoricalPath("body.volcanismType", NITROGEN, null, null)).toBe(
      "minor nitrogen magma volcanism",
    );
    const noField = { ...MOON } as PlanetScan;
    delete (noField as { Volcanism?: string }).Volcanism;
    expect(valueForCategoricalPath("body.volcanismType", noField, null, null)).toBeNull();
  });

  it("buckets the journal's wording and the corpus's onto the same token", () => {
    // The second bug. These are the exact spellings each side uses.
    const b = (v: string) => bucketCategoricalValue("body.volcanismType", v);
    expect(b("minor nitrogen magma volcanism")).toBe(b("Minor Nitrogen Magma"));
    expect(b("major water magma volcanism")).toBe(b("Major Water Magma"));
    expect(b("major water geysers volcanism")).toBe(b("Major Water Geysers"));
    // Intensity is not a mechanism; minor and major rocky magma are one bucket, as they always were.
    expect(b("Minor Rocky Magma")).toBe(b("Major Rocky Magma"));
    // And a quiet body agrees with the corpus's own label for one.
    expect(b(NO_VOLCANISM)).toBe("none");
    expect(b("")).not.toBe("nitrogen magma");
  });

  it("does not confuse two different volcanisms", () => {
    const b = (v: string) => bucketCategoricalValue("body.volcanismType", v);
    expect(b("Minor Water Magma")).not.toBe(b("Minor Nitrogen Magma"));
    expect(b("Major Water Geysers")).not.toBe(b("Major Water Magma"));
    expect(b(NO_VOLCANISM)).not.toBe(b("Minor Water Magma"));
  });

  it("scores the volcanism term at all, on a quiet body and a volcanic one", () => {
    // If the term is skipped the two scores are identical, which is what happened for years.
    for (const name of ["Bacterium omentum", "Bacterium acies", "Bacterium aurasus"]) {
      const q = score(name, QUIET)!;
      const v = score(name, NITROGEN)!;
      expect(q, name).not.toBeNull();
      expect(v.logScore, `${name} must not score the same with and without volcanism`).not.toBe(
        q.logScore,
      );
    }
  });

  it("lets the volcanism family decide between the species that live on volcanism", () => {
    /*
      The owner's rule, on one moon with nothing changed but the volcanism field. Omentum is 21 of
      22 on nitrogen or ammonia magma, verrata 26 of 26 on water, and neither has ever been seen on
      the other's — so whichever family the body has should lead the other, both ways round.
    */
    const ahead = (scan: PlanetScan, winner: string, loser: string) => {
      const o = order(scan);
      return o.indexOf(winner) < o.indexOf(loser);
    };
    expect(ahead(NITROGEN, "omentum", "verrata"), "nitrogen magma should favour omentum").toBe(true);
    expect(ahead(WATER, "verrata", "omentum"), "water magma should favour verrata").toBe(true);
    // And on a quiet body the one that avoids volcanism outranks both.
    expect(ahead(QUIET, "acies", "omentum")).toBe(true);
    expect(ahead(QUIET, "acies", "verrata")).toBe(true);
  });

  it("does not overturn a species standing in its own best habitat", () => {
    /*
      This moon is 100 % neon at 52 K, which is Bacterium acies' core — all 213 of its bodies are
      85-100 % neon — and acies keeps the lead even with omentum's own nitrogen magma on it. That is
      the commander's own field report: *"I just landed on a planet with nitrogen volcanism and neon
      atmosphere (100 % neon) … acies won, so the data we found from the Spansh dumps was correct."*

      One term is one term. Volcanism is worth 0.277 to omentum here and acies leads by more than
      three log units on atmosphere, temperature and prior together. A term that could overturn that
      would be a gate wearing a weight's clothes.
    */
    expect(order(NITROGEN)[0]).toBe("acies");
    const gapQuiet = score("Bacterium acies", QUIET)!.logScore - score("Bacterium omentum", QUIET)!.logScore;
    const gapVolcanic =
      score("Bacterium acies", NITROGEN)!.logScore - score("Bacterium omentum", NITROGEN)!.logScore;
    // It still closes the gap, which is the whole of what a weight is asked to do.
    expect(gapVolcanic).toBeLessThan(gapQuiet);
  });

  it("moves each species in the direction its own corpus points", () => {
    const delta = (name: string, scan: PlanetScan) =>
      score(name, scan)!.logScore - score(name, QUIET)!.logScore;

    // 95.5 % volcanic, and nitrogen is one of its two families.
    expect(delta("Bacterium omentum", NITROGEN)).toBeGreaterThan(0);
    // 2.3 % volcanic — it prefers the quiet body and should lose ground here.
    expect(delta("Bacterium acies", NITROGEN)).toBeLessThan(0);
    // 6,889 of 6,889 quiet: the largest penalty of the five, and the case the old guard skipped.
    expect(delta("Bacterium aurasus", NITROGEN)).toBeLessThan(delta("Bacterium acies", NITROGEN));
    // Verrata's water, on its own volcanism.
    expect(delta("Bacterium verrata", WATER)).toBeGreaterThan(0);
  });

  it("is a weight and not a wall — every candidate still scores everywhere", () => {
    /*
      The point of moving this into the posterior rather than back into `criteria`. A species whose
      corpus has never seen this volcanism is ranked lower, not removed: Laplace smoothing gives the
      unseen bucket a floor, so the row survives to be offered when nothing better fits.
    */
    for (const scan of [QUIET, NITROGEN, WATER]) {
      for (const name of CANDIDATES) {
        const r = score(name, scan);
        expect(r, `${name} must still be scored`).not.toBeNull();
        expect(Number.isFinite(r!.logScore), name).toBe(true);
      }
    }
  });

  it("carries the weight the sweep chose, and can be swept again", () => {
    /*
      `VOLCANISM_TERM_WEIGHT` is 2, picked on `rank-probe --model` over 585 species: top-3 is at its
      maximum there and mean rank within 0.004 of anything the curve ever reaches, so the smaller
      weight wins a flat comparison. The seam is what made that measurable, and it has to keep
      working or the next person re-tunes by editing a constant and guessing.
    */
    expect(VOLCANISM_TERM_WEIGHT).toBe(2);

    const at = (w: number, scan: PlanetScan) =>
      speciesLogScore(find("Bacterium omentum"), scan, null, null, { volcanismWeight: w })!.logScore;

    // Zero drops the term: the quiet body and the volcanic one become indistinguishable.
    expect(at(0, NITROGEN)).toBe(at(0, QUIET));
    // And a heavier weight pulls harder, in the same direction.
    const d1 = at(1, NITROGEN) - at(1, QUIET);
    const d4 = at(4, NITROGEN) - at(4, QUIET);
    expect(d1).toBeGreaterThan(0);
    expect(d4).toBeGreaterThan(d1);
    expect(d4 / d1).toBeCloseTo(4, 5);
  });

  it("leaves no volcanism gate behind in the data", () => {
    // Four rows carried one; three had it replaced by their real axis and tela's was wrong outright.
    for (const name of ["Bacterium tela", "Bacterium acies", "Bacterium aurasus"]) {
      expect(find(name).criteria.volcanismIncludes ?? [], name).toEqual([]);
    }
  });
});
