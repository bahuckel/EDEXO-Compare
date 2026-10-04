/**
 * Which species of a genus (Phase A.6, owner 2026-10-02): src/server/genusBodySplit.ts against the
 * shipped table, data/exomastery/genus-body-split.json.
 */
import { describe, expect, it } from "vitest";
import {
  applyGenusBodySplit,
  atmosphereKey,
  bodyFacts,
  genusBodyShares,
  volcanismKind,
} from "../src/server/genusBodySplit.js";
import type { PlanetScan, SpeciesMatch } from "../src/shared/types.js";

const root = process.cwd();
const ST = (c: string) => `sinuous_tuber_sinuous_tubers_${c}`;
const SINUOUS = ["albidum", "blatteum", "caeruleum", "lindigoticum", "prasinum", "roseum", "violaceum", "viride"].map(ST);

const scan = (o: Partial<PlanetScan>): PlanetScan =>
  ({ PlanetClass: "High metal content body", SurfaceTemperature: 450, AtmosphereType: "None", Volcanism: "", ...o }) as PlanetScan;

function match(id: string, genus: string, genusDataDir: string, pct: number): SpeciesMatch {
  return {
    entry: { id, displayName: id, genus, genusDataDir, criteria: {} },
    reasons: [],
    presenceProbabilityPercent: pct,
  } as unknown as SpeciesMatch;
}

describe("reading the body in the table's terms", () => {
  it("speaks the journal's and Spansh's spellings alike", () => {
    expect(atmosphereKey("SulphurDioxide")).toBe("sulphur dioxide");
    expect(atmosphereKey("Thin Sulphur dioxide")).toBe("sulphur dioxide");
    expect(atmosphereKey("NeonRich")).toBe("neon-rich");
    expect(atmosphereKey("Thin Neon-rich")).toBe("neon-rich");
    expect(atmosphereKey("None")).toBe("none");
    expect(atmosphereKey("")).toBe("none");
    expect(volcanismKind("major silicate vapour geysers volcanism")).toBe("silicate");
    expect(volcanismKind("Rocky Magma")).toBe("rocky");
    expect(volcanismKind("")).toBe("none");
    expect(bodyFacts(scan({ PlanetClass: "Rocky body", SurfaceTemperature: 299 }))).toMatchObject({ type: "rocky", temp25: "11" });
  });
});

describe("the split, against the confirmed bodies it was built from", () => {
  it("Sinuous Tubers: HMC with silicate volcanism is Prasinum; a rocky body with rocky volcanism is Roseum", () => {
    const hmc = genusBodyShares(root, "sinuous-tubers", SINUOUS, scan({ Volcanism: "minor silicate vapour geysers volcanism" }), null)!;
    expect([...hmc].sort((a, b) => b[1] - a[1])[0]![0]).toBe(ST("prasinum"));
    const rocky = genusBodyShares(
      root,
      "sinuous-tubers",
      SINUOUS,
      scan({ PlanetClass: "Rocky body", Volcanism: "rocky magma volcanism", SurfaceTemperature: 330 }),
      null,
    )!;
    expect([...rocky].sort((a, b) => b[1] - a[1])[0]![0]).toBe(ST("roseum"));
  });

  it("Brain Trees: the hot pair follows the region (Puniceum in Norma Expanse, Ostrinum in the Inner Orion Spur)", () => {
    const ids = ["brain_trees_brain_tree_ostrinum", "brain_trees_brain_tree_puniceum"];
    const hot = scan({ SurfaceTemperature: 800, Volcanism: "metallic magma volcanism" });
    const norma = genusBodyShares(root, "brain-tree", ids, hot, "Norma Expanse")!;
    const orion = genusBodyShares(root, "brain-tree", ids, hot, "Inner Orion Spur")!;
    expect(norma.get(ids[1]!)!).toBeGreaterThan(0.9);
    expect(orion.get(ids[0]!)!).toBeGreaterThan(0.9);
  });

  it("Sinuous Tubers read the facts per region: Prasinum is a rocky one in Inner Scutum-Centaurus", () => {
    // Galaxy-wide it is 99 % high-metal-content (Empyrean Straits), and gave it 0.0 % on these bodies.
    const rocky = scan({ PlanetClass: "Rocky body", Volcanism: "minor metallic magma volcanism", SurfaceTemperature: 240 });
    const isc = genusBodyShares(root, "sinuous-tubers", SINUOUS, rocky, "Inner Scutum-Centaurus Arm")!;
    expect(isc.get(ST("prasinum"))!).toBeGreaterThan(0.05);
    const straits = genusBodyShares(root, "sinuous-tubers", SINUOUS, rocky, "Empyrean Straits")!;
    expect(straits.get(ST("prasinum"))!).toBeLessThan(isc.get(ST("prasinum"))!);
  });

  it("a thinly logged region's own favourite is not lost to the galaxy's shares", () => {
    // Inner Orion-Perseus Conflux: 46 Sinuous Tubers systems, Viride the commonest, 2 % galaxy-wide.
    const body = scan({ Volcanism: "major rocky magma volcanism", SurfaceTemperature: 263, AtmosphereType: "CarbonDioxide" });
    const s = genusBodyShares(root, "sinuous-tubers", SINUOUS, body, "Inner Orion-Perseus Conflux")!;
    expect(s.get(ST("viride"))!).toBeGreaterThan(0.01);
  });

  it("shares sum to one, and a genus it does not cover is left alone", () => {
    const s = genusBodyShares(root, "sinuous-tubers", SINUOUS, scan({}), "Empyrean Straits")!;
    expect([...s.values()].reduce((a, x) => a + x, 0)).toBeCloseTo(1, 6);
    expect(genusBodyShares(root, "bacterium", ["bacterium_bacterium_aurasus"], scan({}), null)).toBeNull();
    expect(genusBodyShares(root, "recepta", ["recepta_recepta_umbrux"], scan({}), null)).toBeNull();
  });
});

describe("applying it to a body's candidates", () => {
  it("keeps the genus's total chance, re-splits it, and demotes the long shots but never the best", () => {
    const ms = SINUOUS.map((id) => match(id, "Sinuous Tubers", "sinuous-tubers", 10));
    applyGenusBodySplit(ms, scan({ Volcanism: "minor silicate vapour geysers volcanism" }), null, root, new Set());
    const total = ms.reduce((a, m) => a + (m.presenceProbabilityPercent ?? 0), 0);
    expect(total).toBeCloseTo(80, 0);
    const shown = ms.filter((m) => !m.unlikely);
    expect(shown.map((m) => m.entry.id)).toContain(ST("prasinum"));
    expect(shown.length).toBeLessThan(ms.length);
    for (const m of ms.filter((x) => x.unlikely)) expect(m.genusSharePercent!).toBeLessThan(15);
  });

  it("never demotes what the commander has sampled here", () => {
    const ms = SINUOUS.map((id) => match(id, "Sinuous Tubers", "sinuous-tubers", 10));
    applyGenusBodySplit(ms, scan({ Volcanism: "minor silicate vapour geysers volcanism" }), null, root, new Set([ST("violaceum")]));
    expect(ms.find((m) => m.entry.id === ST("violaceum"))!.unlikely).toBeFalsy();
  });
});
