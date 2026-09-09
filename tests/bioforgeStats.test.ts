/**
 * Canonn's second opinion, and the case that justifies having one.
 *
 * The fixtures are the real entries from the owner's own Bioforge files, trimmed of histograms. They
 * are two Tussock species that no physical measurement can separate:
 *
 *   Propagito   146.0 - 196.3 K   Thin CO2   Rocky / HMC   18,788 sightings   1,000,000 CR
 *   Pennata     145.6 - 154.0 K   Thin CO2   Rocky / HMC    3,338 sightings   5,853,800 CR
 *
 * Pennata's whole temperature range sits inside Propagito's, the atmosphere and body types are
 * identical, and the payout differs by 5.85x. At 150 K the physics is silent. Across 22,126
 * sightings their region sets are **disjoint** — which is the entire argument for scoring geography
 * rather than treating it as noise.
 */
import { describe, expect, it } from "vitest";
import {
  bioforgeChances,
  bioforgeColourFor,
  bioforgeSpeciesChances,
  bioforgeUrl,
  scoreEntry,
  speciesNameOf,
  type BioforgeBody,
  type BioforgeEntry,
} from "../src/shared/bioforgeStats.js";

const PROPAGITO: BioforgeEntry = {
  id: "$Codex_Ent_Tussocks_09_F_Name;",
  name: "Tussock Propagito - Yellow",
  count: 18788,
  reward: 1_000_000,
  atmosphereType: ["Thin Carbon dioxide"],
  bodies: ["Rocky body", "High metal content world"],
  volcanism: ["No volcanism"],
  materials: ["Iron", "Nickel", "Phosphorus", "Sulphur", "Carbon"],
  regions: [
    "Norma Expanse",
    "Outer Scutum-Centaurus Arm",
    "Inner Scutum-Centaurus Arm",
    "Aquila's Halo",
    "Odin's Hold",
    "The Void",
    "The Veils",
    "Trojan Belt",
    "Hieronymus Delta",
    "Galactic Centre",
    "Formorian Frontier",
  ],
  localStars: ["F (White) Star", "K (Yellow-Orange) Star", "M (Red dwarf) Star", null],
  primaryStars: ["F (White) Star", "G (White-Yellow) Star", null],
  mint: 146,
  maxt: 196.254181,
  ming: 0.0401375548077904,
  maxg: 0.270276945039258,
  minp: 0.00297405929434986,
  maxp: 0.0986862355094991,
};

const PENNATA: BioforgeEntry = {
  id: "$Codex_Ent_Tussocks_01_F_Name;",
  name: "Tussock Pennata - Yellow",
  count: 3338,
  reward: 5_853_800,
  atmosphereType: ["Thin Carbon dioxide"],
  bodies: ["Rocky body", "High metal content world"],
  volcanism: ["No volcanism"],
  materials: ["Iron", "Nickel", "Phosphorus", "Sulphur", "Carbon"],
  regions: [
    "Achilles's Altar",
    "Elysian Shore",
    "Inner Orion Spur",
    "Hawking's Gap",
    "Temple",
    "Perseus Arm",
    "Outer Orion Spur",
    "Sagittarius-Carina Arm",
  ],
  localStars: ["F (White) Star", "K (Yellow-Orange) Star", "M (Red dwarf) Star", null],
  primaryStars: ["F (White) Star", "G (White-Yellow) Star", null],
  mint: 145.630569,
  maxt: 153.9953,
  ming: 0.0390005098399103,
  maxg: 0.174975425716325,
  minp: 0.00280441378731804,
  maxp: 0.0111676475697015,
};

/** A body both species are physically consistent with: 150 K, thin CO2, rocky. */
const AMBIGUOUS: BioforgeBody = {
  surfaceTemperature: 150,
  gravityG: 0.1,
  pressureAtm: 0.008,
  atmosphereType: "Thin Carbon dioxide",
  subType: "Rocky body",
  volcanism: "No volcanism",
};

const pct = (rows: ReturnType<typeof bioforgeChances>, name: string) =>
  rows.find((r) => r.entry.name.startsWith(name))?.percent ?? 0;

describe("when physics cannot separate two species", () => {
  it("admits both, because at 150 K both are genuinely possible", () => {
    expect(scoreEntry(PROPAGITO, AMBIGUOUS).failures).toEqual([]);
    expect(scoreEntry(PENNATA, AMBIGUOUS).failures).toEqual([]);
  });

  it("falls back to how often each has been seen", () => {
    // With nothing else to go on, 18,788 sightings against 3,338 is the honest split. Not a
    // coin-flip, and not a claim either.
    const rows = bioforgeChances([PROPAGITO, PENNATA], AMBIGUOUS);
    expect(pct(rows, "Tussock Propagito")).toBeCloseTo((18788 / (18788 + 3338)) * 100, 1);
    expect(pct(rows, "Tussock Pennata")).toBeCloseTo((3338 / (18788 + 3338)) * 100, 1);
  });
});

describe("region, which is the only thing that can separate them", () => {
  it("flips the answer to the cheap species in Propagito country", () => {
    const rows = bioforgeChances([PROPAGITO, PENNATA], { ...AMBIGUOUS, region: "Norma Expanse" });
    expect(pct(rows, "Tussock Propagito")).toBeGreaterThan(98);
    expect(pct(rows, "Tussock Pennata")).toBeLessThan(2);
  });

  it("flips it to the species worth 5.85x in Pennata country", () => {
    // The whole point of the feature: same body, same readings, 5.85x the payout, and the only
    // thing that said so was which part of the galaxy it is in.
    const rows = bioforgeChances([PROPAGITO, PENNATA], { ...AMBIGUOUS, region: "Inner Orion Spur" });
    expect(pct(rows, "Tussock Pennata")).toBeGreaterThan(70);
    expect(pct(rows, "Tussock Propagito")).toBeLessThan(30);
  });

  it("demotes rather than excludes, because their regions are a survey and not a law", () => {
    // Crystalline Shards are listed in 19 rim regions because nobody looks for them in the core.
    // An unlisted region is weak evidence of absence and no evidence of impossibility.
    const rows = bioforgeChances([PROPAGITO, PENNATA], { ...AMBIGUOUS, region: "Nowhere At All" });
    for (const r of rows) {
      expect(r.percent).toBeGreaterThan(0);
      expect(r.failures).toEqual([]);
    }
  });
});

describe("envelopes are observations, so their edges are soft", () => {
  it("rejects a body far outside everything ever recorded", () => {
    const hot = { ...AMBIGUOUS, surfaceTemperature: 400 };
    expect(scoreEntry(PENNATA, hot).failures).toContain("temperature");
    expect(scoreEntry(PROPAGITO, hot).failures).toContain("temperature");
  });

  it("accepts a body just past a bound, which is a rounding argument not a biological one", () => {
    // Canonn's own route check leaves 0.4 % of real sightings just outside a bound.
    expect(scoreEntry(PENNATA, { ...AMBIGUOUS, surfaceTemperature: 157 }).failures).toEqual([]);
  });

  it("leaves an untested field alone rather than counting it against the species", () => {
    // A body we have no temperature for must not be rejected for its temperature.
    expect(scoreEntry(PENNATA, { atmosphereType: "Thin Carbon dioxide" }).failures).toEqual([]);
  });

  it("does not read a null in a recorded list as a class", () => {
    // `localStars` carries null for sightings with no recorded star. Matching against it would let
    // any star satisfy any species.
    const entry: BioforgeEntry = { ...PENNATA, localStars: [null] };
    const out = scoreEntry(entry, { ...AMBIGUOUS, parentStarClass: "B (Blue-White) Star" });
    // Nothing known, so nothing is tested — full weight, no failure.
    expect(out.weight).toBe(PENNATA.count);
  });
});

describe("what the caller is told when there is nothing to say", () => {
  it("returns no rows at all when the commander imported nothing", () => {
    // Must be drawn as "no second opinion", never as 0 %: one is missing data, the other is a claim.
    expect(bioforgeChances([], AMBIGUOUS)).toEqual([]);
  });

  it("keeps a failed species in the list with zero, because absence is worth saying", () => {
    const rows = bioforgeChances([PROPAGITO, PENNATA], { ...AMBIGUOUS, surfaceTemperature: 180 });
    const pennata = rows.find((r) => r.entry.name.startsWith("Tussock Pennata"));
    expect(pennata?.percent).toBe(0);
    expect(pennata?.failures).toContain("temperature");
    expect(pct(rows, "Tussock Propagito")).toBeCloseTo(100, 5);
  });
});

describe("joining to EDEXO's own species tree", () => {
  it("strips the colour, which EDEXO's tree does not carry", () => {
    expect(speciesNameOf("Tussock Pennata - Yellow")).toBe("Tussock Pennata");
    expect(speciesNameOf("Bacterium Aurasus - Teal")).toBe("Bacterium Aurasus");
  });

  it("leaves a name that has no colour untouched", () => {
    expect(speciesNameOf("Amphora Plant")).toBe("Amphora Plant");
  });

  it("links to Canonn by their own id", () => {
    expect(bioforgeUrl("$Codex_Ent_Tussocks_01_F_Name;")).toBe(
      "https://bioforge.canonn.tech/?entryid=%24Codex_Ent_Tussocks_01_F_Name%3B",
    );
  });
});

describe("colour is a consequence, not a rival", () => {
  /** Aurasus as Canonn keys it: one species, several colours, each its own entry. */
  const aurasus = (colour: string, star: string, count: number): BioforgeEntry => ({
    ...PENNATA,
    id: `$Codex_Ent_Bacterial_01_${star[0]}_Name;`,
    name: `Bacterium Aurasus - ${colour}`,
    count,
    reward: 1_000_000,
    localStars: [star],
    regions: [],
  });

  const FOUR = [
    aurasus("Green", "F (White) Star", 4000),
    aurasus("Lime", "K (Yellow-Orange) Star", 3600),
    aurasus("Emerald", "M (Red dwarf) Star", 2600),
    aurasus("Teal", "G (White-Yellow) Star", 1700),
  ];
  const RIVAL: BioforgeEntry = { ...PENNATA, name: "Frutexa Acus - Green", count: 6000, regions: [] };

  it("does not let a species compete with itself", () => {
    /*
     * The real defect this was written for. Against the owner's own files a body at 150 K returned
     * Aurasus four times — Green 9.8 %, Lime 8.8 %, Emerald 6.4 %, Teal 4.2 % — and every one of
     * those rows lost to species Canonn happens to have recorded in fewer colours. Summed, Aurasus
     * is the strongest candidate on the body; split, it looked like the fourth.
     */
    const rows = bioforgeSpeciesChances([...FOUR, RIVAL], AMBIGUOUS);
    const aur = rows.find((r) => r.species === "Bacterium Aurasus");
    const fru = rows.find((r) => r.species === "Frutexa Acus");
    expect(aur?.percent).toBeCloseTo((11900 / 17900) * 100, 1);
    expect(aur!.percent).toBeGreaterThan(fru!.percent);
  });

  it("still totals 100 across species", () => {
    const rows = bioforgeSpeciesChances([...FOUR, RIVAL], AMBIGUOUS);
    expect(rows.reduce((a, r) => a + r.percent, 0)).toBeCloseTo(100, 5);
  });

  it("names the colour for the star the body actually orbits", () => {
    const rows = bioforgeSpeciesChances(FOUR, { ...AMBIGUOUS, parentStarClass: "M (Red dwarf) Star" });
    const aur = rows.find((r) => r.species === "Bacterium Aurasus")!;
    expect(bioforgeColourFor(aur.variants, "M (Red dwarf) Star")?.name).toBe("Emerald");
  });

  it("says nothing when the star is unknown", () => {
    // A body orbiting a barycentre that names no single star. Every colour pays the same, so a
    // wrong one costs the commander nothing and costs EDEXO its credibility.
    const rows = bioforgeSpeciesChances(FOUR, AMBIGUOUS);
    const aur = rows.find((r) => r.species === "Bacterium Aurasus")!;
    expect(bioforgeColourFor(aur.variants, null)).toBeNull();
  });

  it("says nothing for a star class Canonn has never recorded for it", () => {
    const rows = bioforgeSpeciesChances(FOUR, { ...AMBIGUOUS, parentStarClass: "Black Hole" });
    const aur = rows.find((r) => r.species === "Bacterium Aurasus")!;
    expect(bioforgeColourFor(aur.variants, "Black Hole")).toBeNull();
  });
});
