/**
 * Which genera, before a DSS (Phase A.8, owner 2026-10-02): src/server/genusPrior.ts against the
 * shipped table, data/exomastery/genus-prior.json.
 */
import { describe, expect, it } from "vitest";
import { applyGenusPrior, genusPriorCells, genusPriorFor, genusPriorKey, vetoUnseenGenera } from "../src/server/genusPrior.js";
import type { PlanetScan, SpeciesMatch } from "../src/shared/types.js";

const root = process.cwd();
const hmc = (o: Partial<PlanetScan> = {}): PlanetScan =>
  ({ PlanetClass: "High metal content body", SurfaceTemperature: 260, AtmosphereType: "SulphurDioxide", Volcanism: "", ...o }) as PlanetScan;

function match(id: string, genus: string, pct: number): SpeciesMatch {
  return { entry: { id, displayName: id, genus, genusDataDir: genus.toLowerCase(), criteria: {} }, reasons: [], presenceProbabilityPercent: pct } as unknown as SpeciesMatch;
}

describe("the table's keys", () => {
  it("spells a genus one way however it is written", () => {
    expect(genusPriorKey("Brain Tree")).toBe(genusPriorKey("Brain Trees"));
    expect(genusPriorKey("Sinuous Tuber")).toBe(genusPriorKey("Sinuous Tubers"));
    expect(genusPriorKey("Bacterium")).toBe("bacter");
  });

  it("reads the journal's spellings into the dump's cells, finest first", () => {
    expect(genusPriorCells(hmc({ Volcanism: "minor rocky magma volcanism" }), 1, "K")).toEqual([
      "L0|hmc|1|sulphur dioxide|13|K|rocky",
      "L1|hmc|1|sulphur dioxide|13|K",
      "L2|hmc|1|sulphur dioxide|13",
      "L3|hmc|1|sulphur dioxide",
      "L4|hmc|1",
      "L5|1",
    ]);
    expect(genusPriorCells(hmc(), 9, "Neutron Star")[0]).toBe("L0|hmc|5|sulphur dioxide|13|N|none");
  });

  it("finds a well-filled cell for a common body", () => {
    const p = genusPriorFor(root, hmc(), 1, "K")!;
    expect(p.n).toBeGreaterThanOrEqual(100);
    expect(p.p[genusPriorKey("Bacterium")]).toBeGreaterThan(0.5);
  });
});

describe("re-splitting a body's chance between genera", () => {
  const body = { genusHints: null, biologicalSignals: 1 };

  it("keeps the body's total and the shares inside each genus", () => {
    const ms = [match("bacterium_a", "Bacterium", 30), match("bacterium_b", "Bacterium", 10), match("stratum_t", "Stratum", 60)];
    applyGenusPrior(ms, body, hmc(), { parentStarType: "K" }, root);
    const total = ms.reduce((a, m) => a + m.presenceProbabilityPercent!, 0);
    expect(total).toBeCloseTo(100, 0);
    expect(ms[0]!.presenceProbabilityPercent! / ms[1]!.presenceProbabilityPercent!).toBeCloseTo(3, 1);
    // On a one-signal HMC the dump says Bacterium far more often than Stratum.
    expect(ms[0]!.presenceProbabilityPercent! + ms[1]!.presenceProbabilityPercent!).toBeGreaterThan(ms[2]!.presenceProbabilityPercent!);
  });

  it("does nothing once a DSS has named the genera, or without a signal count", () => {
    const ms = [match("bacterium_a", "Bacterium", 40), match("stratum_t", "Stratum", 60)];
    applyGenusPrior(ms, { genusHints: [{ Genus: "x", Genus_Localised: "Stratum" }], biologicalSignals: 1 }, hmc(), null, root);
    applyGenusPrior(ms, { genusHints: null, biologicalSignals: null }, hmc(), null, root);
    expect(ms.map((m) => m.presenceProbabilityPercent)).toEqual([40, 60]);
  });
});


describe("hiding a genus such bodies almost never carry, before a DSS (owner, 2026-10-02, Weqea DF-L b49-4 C 6)", () => {
  const c6 = () => hmc({ SurfaceTemperature: 183.39, AtmosphereType: "CarbonDioxide", Volcanism: "" });
  const body = { genusHints: null, biologicalSignals: 4 };

  /*
    Owner, 2026-10-03 ("no misses"): the limits are now where only 0.01 % of a genus's own real bodies
    fall, not 0.25 %. On C 6's kind of body (5,332 in the dump) Osseus is on 0.3 %, Concha 0.1 % and
    Fungoida 2.9 % — real, if small, so all eight stay before the DSS, the long shots low in the list.
  */
  it("keeps every genus C 6's kind of body really carries, however small", () => {
    const ms = [
      match("stratum_t", "Stratum", 100),
      match("bacterium_a", "Bacterium", 89),
      match("frutexa_m", "Frutexa", 63),
      match("tussock_p", "Tussock", 38),
      match("fungoida_g", "Fungoida", 13),
      match("osseus_f", "Osseus", 11),
      match("concha_r", "Concha", 9),
      match("aleoida_c", "Aleoida", 8),
    ];
    vetoUnseenGenera(ms, body, c6(), { parentStarType: "M" }, root, new Set());
    expect(ms.filter((m) => !m.unlikely).map((m) => m.entry.genus)).toEqual([
      "Stratum",
      "Bacterium",
      "Frutexa",
      "Tussock",
      "Fungoida",
      "Osseus",
      "Concha",
      "Aleoida",
    ]);
  });

  it("hides a rare genus only where it does not grow, and never what was sampled here", () => {
    // Fumerola needs volcanism and C 6 has none: under even its own small limit there.
    const quiet = [match("stratum_t", "Stratum", 100), match("fumerola_x", "Fumerola", 10), match("osseus_f", "Osseus", 11)];
    vetoUnseenGenera(quiet, body, c6(), { parentStarType: "M" }, root, new Set(["osseus_f"]));
    expect(quiet.find((m) => m.entry.genus === "Fumerola")!.unlikely).toBe(true);
    expect(quiet.find((m) => m.entry.genus === "Osseus")!.unlikely).toBeFalsy();
    // On an icy body with water volcanism it grows, and it stays however small its chance.
    const icy = (o: Partial<PlanetScan> = {}) =>
      ({ PlanetClass: "Icy body", SurfaceTemperature: 120, AtmosphereType: "Nitrogen", Volcanism: "minor water geysers volcanism", ...o }) as PlanetScan;
    const live = [match("bacterium_a", "Bacterium", 90), match("fumerola_x", "Fumerola", 3)];
    vetoUnseenGenera(live, { genusHints: null, biologicalSignals: 2 }, icy(), { parentStarType: "K" }, root, new Set());
    expect(live.find((m) => m.entry.genus === "Fumerola")!.unlikely).toBeFalsy();
  });

  it("does nothing after a DSS", () => {
    const ms = [match("stratum_t", "Stratum", 100), match("osseus_f", "Osseus", 11)];
    vetoUnseenGenera(ms, { genusHints: [{ Genus: "x", Genus_Localised: "Stratum" }], biologicalSignals: 4 }, c6(), { parentStarType: "M" }, root, new Set());
    expect(ms.every((m) => !m.unlikely)).toBe(true);
  });
});
