/**
 * Odds measured on a year of EDDN finds and the Spansh dump's DSS lists, laid over the ranking model where
 * the model is measurably wrong (owner, 2026-10-10: "build both leads, then re-measure"; the evidence is in
 * docs/perf/deep-dive/REPORT-20261010.md).
 *
 * The model scores a body field by field against each species' profile. Two cases it cannot see:
 *
 *  - **Recepta on carbon dioxide or oxygen** grows only where sulphur dioxide is mixed in (the 1 % rule in
 *    matchSpecies), and past that line how often it is there depends on how much: 24 % at 1.0-1.1 % SO₂,
 *    86-100 % from 1.75 %. The model treats every body past the line alike.
 *  - **Bacterium tela** grows on hot bodies or on volcanic ones (its rule), and its profile is mostly hot
 *    and calm, so the model fines its cold volcanic bodies: 3.7 % on one-signal cold volcanic neon bodies
 *    where it is a third of the Bacterium.
 *
 * Both are applied after the model has shared out the body's probability, and both keep what the model
 * got right: Recepta's split among its three species, and Bacterium's total, of which tela's and
 * omentum's measured shares are all that changes (omentum since 2026-10-10, the same evidence for it).
 */
import type { PlanetScan, SpeciesMatch } from "../shared/types.js";
import { gasSharePercent } from "../shared/atmosphereGasShare.js";
import { atmosphereTypeKeyOf } from "../shared/scanAtmosphereMatch.js";

/**
 * Recepta on a thin carbon dioxide (or oxygen) body: how often it is there by the sulphur dioxide share,
 * over the 1,541 such bodies past the 1 % line with a DSS and a journal scan (1,112 with Recepta). Upper
 * bound of each band, its rate in %. Over 3 % all 24 bodies had it; held at 95 rather than certain.
 */
export const RECEPTA_BY_SO2: readonly (readonly [number, number])[] = [
  [1.1, 24],
  [1.2, 52],
  [1.35, 62],
  [1.5, 75],
  [1.75, 79],
  [2.0, 86],
  [3.0, 89],
  [Infinity, 95],
];

/**
 * Bacterium tela's share of the Bacterium on bodies that meet its rule, by atmosphere and branch ("hot":
 * 300 K or more; "cold": below, with volcanism; "cold-nmagma": below, with nitrogen or ammonia magma,
 * where omentum takes its own share too), from the EDDN bodies where a Bacterium was logged (50,144 hot
 * or volcanic). Atmospheres with too few bodies are left to the model.
 */
export const TELA_SHARE: Readonly<Record<string, number>> = {
  "sulphurdioxide|hot": 53,
  "sulphurdioxide|cold": 70,
  "carbondioxide|hot": 55,
  "water|hot": 48,
  "neonrich|cold": 47,
  "neonrich|cold-nmagma": 48,
  "methane|cold": 37,
  "methane|cold-nmagma": 29,
  "neon|cold": 32,
  "neon|cold-nmagma": 30,
  "argon|cold": 30,
  "argon|cold-nmagma": 30,
  "helium|cold": 28,
};

/**
 * Bacterium omentum's share of the Bacterium on bodies with nitrogen or ammonia magma (its rule), by
 * atmosphere: 8,340 EDDN bodies (2026-10-10, owner: "build it, then re-measure"). Nearly a third
 * everywhere, half on neon-rich, where acies (neon at least 50 %) cannot grow.
 */
export const OMENTUM_SHARE: Readonly<Record<string, number>> = {
  neon: 33,
  neonrich: 52,
  argon: 31,
  methane: 30,
};

function receptaRate(so2: number): number | null {
  if (!(so2 > 1)) return null;
  for (const [upTo, rate] of RECEPTA_BY_SO2) if (so2 <= upTo) return rate;
  return null;
}

function hasVolcanism(scan: PlanetScan): boolean {
  const v = String(scan.Volcanism ?? "").trim().toLowerCase();
  return v !== "" && !v.startsWith("no ");
}

/** Lays the measured odds over the model's `presenceProbabilityPercent` / `genusSharePercent` on the shown rows. */
export function applyMeasuredOdds(shown: SpeciesMatch[], scan: PlanetScan): void {
  const atmo = atmosphereTypeKeyOf(scan);

  // Recepta where sulphur dioxide is a trace in another gas: the genus at its measured rate, the species
  // split as the model has it.
  if (atmo === "carbondioxide" || atmo === "oxygen") {
    const rate = receptaRate(gasSharePercent(scan, "SulphurDioxide") ?? 0);
    const rows = shown.filter((m) => m.entry.genusDataDir === "recepta");
    if (rate != null && rows.length) {
      const shares = rows.map((m) => m.genusSharePercent ?? 100 / rows.length);
      const sum = shares.reduce((a, s) => a + s, 0) || 1;
      rows.forEach((m, i) => {
        m.presenceProbabilityPercent = Math.round((rate * shares[i]!) / sum * 10) / 10;
      });
    }
  }

  // Measured shares of the Bacterium (tela, omentum); the other Bacterium rows keep their order and the rest.
  const t = Number(scan.SurfaceTemperature);
  const volc = String(scan.Volcanism ?? "").toLowerCase();
  const nmagma = /nitrogen magma|ammonia magma/.test(volc);
  const branch = Number.isFinite(t) && t >= 300 ? "hot" : hasVolcanism(scan) ? (nmagma ? "cold-nmagma" : "cold") : null;
  const fixed = new Map<string, number>();
  const telaShare = branch ? (TELA_SHARE[`${atmo}|${branch}`] ?? (branch === "cold-nmagma" ? TELA_SHARE[`${atmo}|cold`] : undefined)) : undefined;
  if (telaShare !== undefined) fixed.set("bacterium_bacterium_tela", telaShare);
  if (nmagma && OMENTUM_SHARE[atmo] !== undefined) fixed.set("bacterium_bacterium_omentum", OMENTUM_SHARE[atmo]!);
  const bac = shown.filter((m) => m.entry.genusDataDir === "bacterium");
  const set = bac.filter((m) => fixed.has(m.entry.id));
  const others = bac.filter((m) => !fixed.has(m.entry.id));
  if (!set.length || bac.length < 2) return;
  const round = (x: number) => Math.round(x * 10) / 10;
  // Shares of the rows present; with no other Bacterium row, the set ones split the whole between them.
  let fixedSum = set.reduce((a, m) => a + fixed.get(m.entry.id)!, 0);
  const scale = others.length === 0 || fixedSum > 100 ? 100 / fixedSum : 1;
  fixedSum *= scale;
  const total = bac.reduce((a, m) => a + (m.presenceProbabilityPercent ?? 0), 0);
  const othersTotal = others.reduce((a, m) => a + (m.presenceProbabilityPercent ?? 0), 0);
  const othersShare = others.reduce((a, m) => a + (m.genusSharePercent ?? 0), 0);
  for (const m of set) {
    const sh = fixed.get(m.entry.id)! * scale;
    if (total > 0) m.presenceProbabilityPercent = round((total * sh) / 100);
    m.genusSharePercent = round(sh);
  }
  for (const m of others) {
    if (total > 0) {
      const w = othersTotal > 0 ? (m.presenceProbabilityPercent ?? 0) / othersTotal : 1 / others.length;
      m.presenceProbabilityPercent = round(total * (1 - fixedSum / 100) * w);
    }
    const w = othersShare > 0 ? (m.genusSharePercent ?? 0) / othersShare : 1 / others.length;
    m.genusSharePercent = round((100 - fixedSum) * w);
  }
}
