/**
 * `AtmosphereType` names the dominant gas. It cannot say how much of the air that gas is, and for
 * three species that is the only thing that decides them.
 *
 * The owner, on being shown that Fonticulua upupam was being offered on campestris's worlds and the
 * other way round: *"we already discussed this like a week ago … it was pressure + percent of gas in
 * the atmosphere that counted."* He was right, and the profiles have held the rule since the feeder
 * built them:
 *
 * ```
 *                        the gas its codex row names        pressure atm
 * Fonticulua campestris  argon  51.97 – 100.00 %   761     0.0010 – 0.0801
 * Fonticulua upupam      argon   0.36 –  49.68 %    56     0.0221 – 0.0862
 * Bacterium acies        neon   85.36 – 100.00 %   213     0.0010 – 0.0033
 * Fonticulua segmentatus neon    0.24 –   0.53 %    16     0.0017 – 0.0033
 * ```
 *
 * Two pairs, each sharing one folded label, each with argon or neon ranges that **do not touch**.
 *
 * The label is not merely a poor proxy — it means the opposite of what it reads like. Across 8,000
 * journal scans that name an atmosphere, the gas in a `…Rich` label is always the **minority**:
 *
 * ```
 *                    plain label        "…Rich" label        mean in "…Rich"
 * Neon               50.29 – 100 %      0.13 – 49.74 %              5.5 %
 * Argon              43.21 – 100 %      0.10 – 47.76 %              3.0 %
 * CarbonDioxide      44.37 – 100 %      0.11 – 46.24 %             11.6 %
 * Methane            32.97 – 100 %      0.10 – 49.99 %             21.7 %
 * ```
 *
 * `NeonRich` air is nitrogen with a neon trace. So the fix is not to stop folding `-rich` — four
 * species reach their bodies only because of it — but to let a row state the share it needs, read
 * from `AtmosphereComposition`, which is present on **100 %** of those 8,000 scans, AutoScan
 * included.
 *
 * Thresholds are 50 % because that is where the game itself changes the label, and because every
 * observed body of all four species sits on one side of it with room to spare.
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

/** A thin icy moon, the shape every body in this test takes. */
function body(over: Partial<PlanetScan>): PlanetScan {
  return {
    BodyName: "probe",
    BodyID: 1,
    StarSystem: "probe",
    SystemAddress: 1,
    PlanetClass: "Icy body",
    SurfaceGravity: 0.26,
    SurfaceTemperature: 62,
    SurfacePressure: 5000,
    Landable: true,
    ...over,
  } as PlanetScan;
}

function verdict(entry: SpeciesEntry, scan: PlanetScan) {
  const est = estimatedTemperatureRangeForScan(scan);
  const t = scan.SurfaceTemperature!;
  return speciesMatchesCriteria(entry, scan, { minK: t, maxK: t }, est, { surfacePressureAtm: 0.05 });
}

/**
 * The two bodies the whole thing turns on, with real journal compositions.
 *
 * Both are labelled for the gas they are *not* made of — which is what the game means by `Rich`.
 */
const ARGON_RICH_NITROGEN = body({
  AtmosphereType: "ArgonRich",
  Atmosphere: "thin argon rich atmosphere",
  atmosphereComposition: [
    { Name: "Nitrogen", Percent: 64.0 },
    { Name: "Argon", Percent: 33.8 },
    { Name: "Oxygen", Percent: 2.2 },
  ],
});

const ARGON_DOMINANT = body({
  AtmosphereType: "Argon",
  Atmosphere: "thin argon atmosphere",
  atmosphereComposition: [
    { Name: "Argon", Percent: 99.2 },
    { Name: "Nitrogen", Percent: 0.8 },
  ],
});

const NEON_RICH_NITROGEN = body({
  AtmosphereType: "NeonRich",
  Atmosphere: "thin neon rich atmosphere",
  SurfaceTemperature: 62,
  atmosphereComposition: [
    { Name: "Nitrogen", Percent: 99.6 },
    { Name: "Neon", Percent: 0.4 },
  ],
});

const NEON_DOMINANT = body({
  AtmosphereType: "Neon",
  Atmosphere: "thin neon atmosphere",
  SurfaceGravity: 0.35,
  SurfaceTemperature: 32,
  atmosphereComposition: [{ Name: "Neon", Percent: 100 }],
});

/** The body from §2 that passed the 5 % required-gas floor on a trace of neon. */
const HELIUM_WITH_NEON_TRACE = body({
  AtmosphereType: "Helium",
  Atmosphere: "thin helium atmosphere",
  SurfaceGravity: 0.35,
  SurfaceTemperature: 32,
  atmosphereComposition: [
    { Name: "Helium", Percent: 93.0 },
    { Name: "Neon", Percent: 6.7 },
  ],
});

describe("the gas share that decides two pairs of species", () => {
  it("separates campestris and upupam on the same ArgonRich body", () => {
    /*
      The body that started it: `ArgonRich` by label, 64 % nitrogen and 33.8 % argon by composition,
      and unmistakably upupam's. Matching on the label alone leaves both plausible, which is exactly
      what was happening.
    */
    expect(verdict(find("Fonticulua upupam"), ARGON_RICH_NITROGEN).ok).toBe(true);
    expect(verdict(find("Fonticulua campestris"), ARGON_RICH_NITROGEN).ok).toBe(false);
  });

  it("separates them the other way on an argon-dominant body", () => {
    expect(verdict(find("Fonticulua campestris"), ARGON_DOMINANT).ok).toBe(true);
    expect(verdict(find("Fonticulua upupam"), ARGON_DOMINANT).ok).toBe(false);
  });

  it("keeps upupam off a nitrogen world with no argon at all", () => {
    /*
      The reason the band has a floor as well as a ceiling. Without it "argon under 50 %" is also
      satisfied by zero argon, and upupam would be offered on every pure nitrogen body — including
      Fonticulua lapida's.
    */
    const pureNitrogen = body({
      AtmosphereType: "Nitrogen",
      Atmosphere: "thin nitrogen atmosphere",
      atmosphereComposition: [{ Name: "Nitrogen", Percent: 100 }],
    });
    expect(verdict(find("Fonticulua upupam"), pureNitrogen).ok).toBe(false);
  });

  it("separates acies from segmentatus on their shared Neon label", () => {
    // NeonRich air is 0.4 % neon here — segmentatus's whole range is 0.24-0.53 %.
    expect(verdict(find("Bacterium acies"), NEON_RICH_NITROGEN).ok).toBe(false);
    expect(verdict(find("Fonticulua segmentatus"), NEON_RICH_NITROGEN).ok).toBe(true);
    expect(verdict(find("Bacterium acies"), NEON_DOMINANT).ok).toBe(true);
  });

  it("closes the helium body that passed on a 6.7 % trace of neon", () => {
    /*
      `atmosphereTypeRequiredAnyOf` accepts any gas at 5 % or more, which is the right floor for a
      genus rule and far too low for a species whose 213 bodies are 85 % neon or better.
    */
    expect(verdict(find("Bacterium acies"), HELIUM_WITH_NEON_TRACE).ok).toBe(false);
  });

  it("demotes rather than deletes, every time", () => {
    /*
      Soft, like every other atmosphere verdict. A hard wall would also put the row out of reach of
      `sampledHere`, which is how the commander overrules us when he is standing on the body.
    */
    for (const [name, scan] of [
      ["Fonticulua campestris", ARGON_RICH_NITROGEN],
      ["Fonticulua upupam", ARGON_DOMINANT],
      ["Bacterium acies", NEON_RICH_NITROGEN],
    ] as const) {
      const r = verdict(find(name), scan);
      expect(r.ok, name).toBe(false);
      expect(r.softOnly, name).toBe(true);
    }
  });

  it("says the number it measured, so the card can explain itself", () => {
    const detail = verdict(find("Fonticulua campestris"), ARGON_RICH_NITROGEN)
      .reasons.filter((f) => f.field === "AtmosphereType")
      .map((f) => f.detail)
      .join(" | ");
    expect(detail).toMatch(/33\.80 %/);
    expect(detail).toMatch(/at least 50 %/);
  });

  it("has no opinion when the scan carries no composition", () => {
    /*
      Every one of the 8,000 scans measured carries `AtmosphereComposition`, AutoScan included — but
      a cached or pre-Odyssey scan may not, and a rejection invented from missing data is worse than
      a rare body let through. The golden fixture's scans are exactly this case: `gen-match-fixture`
      does not copy the field, so none of these bands are exercised there.
    */
    const noComposition = body({ AtmosphereType: "ArgonRich", Atmosphere: "thin argon rich atmosphere" });
    expect(verdict(find("Fonticulua campestris"), noComposition).ok).toBe(true);
    expect(verdict(find("Fonticulua upupam"), noComposition).ok).toBe(true);
  });

  it("is opted into by the five rows the corpus can decide, and no others", () => {
    /*
      All 108 species were checked. Only two gases have a `-rich` population large enough to conclude
      anything from — argon at 2.9 % of argon habitats and neon at 14.5 % of neon ones. For carbon
      dioxide, ammonia, water, sulphur dioxide, methane, nitrogen and oxygen the `-rich` form is
      0.0-0.1 % of the corpus, so a species being zero on it says nothing and the fold cannot be
      wrong for them.

      Seven argon species look one-sided and are not: Tussock capillum is 62 bodies with 1.8
      expected on the rich side (p = 0.16), Fungoida bullarum 57 with 1.7 (p = 0.19), and it falls
      away from there. They simply have not had enough argon bodies for a 2.9 % event to appear.
      Listing them as findings would have been arithmetic dressed up as evidence.
    */
    const optedIn = db.species
      .filter((e) => (e.criteria.atmosphereGasSharePct ?? []).length > 0)
      .map((e) => e.displayName)
      .sort();
    expect(optedIn).toEqual([
      "Bacterium acies",
      "Bacterium vesicula",
      "Fonticulua campestris",
      "Fonticulua segmentatus",
      "Fonticulua upupam",
    ]);
  });

  it("separates vesicula from upupam on the same ArgonRich body", () => {
    /*
      880 of vesicula's 881 bodies are plain Thin Argon at 51.6-100 % argon and none is Argon-rich,
      where argon averages 3 % and the air is usually nitrogen. Under indifference that is p = 6e-12.
      Its `required_atmosphere_type` floor of 5 % was letting it through on 33.8 % argon — which is
      upupam's world, not its own.
    */
    expect(verdict(find("Bacterium vesicula"), ARGON_RICH_NITROGEN).ok).toBe(false);
    expect(verdict(find("Bacterium vesicula"), ARGON_DOMINANT).ok).toBe(true);
  });

  it("keeps segmentatus off acies' neon worlds, and acies off segmentatus'", () => {
    /*
      The other half of the acies fix. All 16 segmentatus bodies are Thin Neon-rich at 0.2-0.5 %
      neon — a nitrogen world carrying a trace — and its row said `Neon` and `Neon-rich`, both of
      which fold to `Neon`. So it matched the 50-100 % neon bodies where acies lives and it never
      has. Neon-rich is 14.5 % of neon habitats: 16 of 16 on it is p = 4e-14.
    */
    expect(verdict(find("Fonticulua segmentatus"), NEON_RICH_NITROGEN).ok).toBe(true);
    expect(verdict(find("Fonticulua segmentatus"), NEON_DOMINANT).ok).toBe(false);
    expect(verdict(find("Bacterium acies"), NEON_DOMINANT).ok).toBe(true);
    expect(verdict(find("Bacterium acies"), NEON_RICH_NITROGEN).ok).toBe(false);
  });

  it("does not shut segmentatus out of its own habitat with the floor", () => {
    // Neon is on all 16 of its bodies, so the 0.1 % floor is a requirement it meets — but a pure
    // nitrogen world with no neon at all is Fonticulua lapida's, and must not read as segmentatus.
    const pureNitrogen = body({
      AtmosphereType: "Nitrogen",
      Atmosphere: "thin nitrogen atmosphere",
      atmosphereComposition: [{ Name: "Nitrogen", Percent: 100 }],
    });
    expect(verdict(find("Fonticulua segmentatus"), pureNitrogen).ok).toBe(false);
  });

  it("parses the band out of the species file without folding the gas name", () => {
    expect(find("Fonticulua upupam").criteria.atmosphereGasSharePct).toEqual([
      { gas: "Argon", min: 0.1, max: 50 },
    ]);
    expect(find("Bacterium acies").criteria.atmosphereGasSharePct).toEqual([{ gas: "Neon", min: 50 }]);
  });

  it("agrees with the corpus it was measured from", () => {
    /*
      The evidence, not a memory of it. If a profile rebuild ever puts campestris below 50 % argon or
      upupam above it, these thresholds should be revisited rather than quietly kept.
    */
    const gasRange = (species: string, gas: string) => {
      const genus = species.split(/\s+/)[0]!.toLowerCase();
      const slug = species.toLowerCase().replace(/\s+/g, "_");
      const f = path.join(getSpeciesDataDir(root), genus, "exomastery", `${slug}_exomastery.json`);
      if (!existsSync(f)) return null;
      const j = JSON.parse(readFileSync(f, "utf8")) as {
        numerics?: Record<string, { min: number; max: number; count: number }>;
      };
      return j.numerics?.[`body.atmosphereComposition.${gas}`] ?? null;
    };

    const campestris = gasRange("Fonticulua campestris", "Argon")!;
    expect(campestris.min).toBeGreaterThan(50);

    const upupam = gasRange("Fonticulua upupam", "Argon")!;
    expect(upupam.max).toBeLessThan(50);
    expect(upupam.min).toBeGreaterThan(0.1);
    // Every one of its bodies carries argon, which is what the floor encodes.
    expect(upupam.count).toBe(56);

    const acies = gasRange("Bacterium acies", "Neon")!;
    expect(acies.min).toBeGreaterThan(50);
  });
});
