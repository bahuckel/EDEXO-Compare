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
 * got right: Recepta's split among its three species, and Bacterium's total, which tela's measured share
 * of is all that changes.
 */
import type { PlanetScan, SpeciesMatch } from "../shared/types.js";
import { gasSharePercent } from "../shared/atmosphereGasShare.js";

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
 * 300 K or more; "cold": below, with volcanism), from 50,144 EDDN bodies where a Bacterium was logged.
 * Atmospheres with too few bodies are left to the model.
 */
export const TELA_SHARE: Readonly<Record<string, number>> = {
  "sulphurdioxide|hot": 53,
  "sulphurdioxide|cold": 70,
  "carbondioxide|hot": 55,
  "water|hot": 48,
  "neonrich|cold": 47,
  "methane|cold": 34,
  "neon|cold": 31,
  "argon|cold": 30,
  "helium|cold": 28,
};

const key = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");

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
  const atmo = key(scan.AtmosphereType);

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

  // Tela's measured share of the Bacterium; the other Bacterium rows keep their order and the rest.
  const t = Number(scan.SurfaceTemperature);
  const branch = Number.isFinite(t) && t >= 300 ? "hot" : hasVolcanism(scan) ? "cold" : null;
  const share = branch ? TELA_SHARE[`${atmo}|${branch}`] : undefined;
  const bac = shown.filter((m) => m.entry.genusDataDir === "bacterium");
  const tela = bac.find((m) => m.entry.id === "bacterium_bacterium_tela");
  if (share === undefined || !tela || bac.length < 2) return;
  const total = bac.reduce((a, m) => a + (m.presenceProbabilityPercent ?? 0), 0);
  const others = bac.filter((m) => m !== tela);
  const othersTotal = others.reduce((a, m) => a + (m.presenceProbabilityPercent ?? 0), 0);
  const othersShare = others.reduce((a, m) => a + (m.genusSharePercent ?? 0), 0);
  const round = (x: number) => Math.round(x * 10) / 10;
  if (total > 0) {
    tela.presenceProbabilityPercent = round((total * share) / 100);
    for (const m of others) {
      const w = othersTotal > 0 ? (m.presenceProbabilityPercent ?? 0) / othersTotal : 1 / others.length;
      m.presenceProbabilityPercent = round(total * (1 - share / 100) * w);
    }
  }
  tela.genusSharePercent = share;
  for (const m of others) {
    const w = othersShare > 0 ? (m.genusSharePercent ?? 0) / othersShare : 1 / others.length;
    m.genusSharePercent = round((100 - share) * w);
  }
}
