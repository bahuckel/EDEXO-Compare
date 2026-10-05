/**
 * Which of Concha labiata and renibus leads, when both are shown (2026-10-05, owner: "could do now").
 *
 * The pair is shown together on about a quarter of confirmed Concha bodies, and nothing in the body
 * separates them well enough to hide either — but gravity orders them. Over 1,057 confirmed bodies
 * where the app shows exactly these two (Spansh dump × EDSM + EDAstro codex, frequency-weighted),
 * labiata is the answer on most bodies under 0.124 g and renibus on most above, and the ranking
 * model put the right one first on only 71 %. Leading by gravity puts it first on 82-84 %, held out
 * (the threshold chosen on half the bodies, 0.124 g in both halves, and tested on the other half).
 *
 * **Order only.** It runs after every floor and only swaps the two rows' chances, so nothing is
 * hidden or added: a list of labiata + renibus stays exactly that list.
 */
import type { PlanetScan, SpeciesMatch } from "../shared/types.js";

/** Below this surface gravity (in g) labiata leads; at or above it, renibus. */
export const CONCHA_LABIATA_BELOW_G = 0.124;

const LABIATA = "concha_concha_labiata";
const RENIBUS = "concha_concha_renibus";
const G = 9.80665;

export function orderConchaPair(matches: SpeciesMatch[], scan: PlanetScan | null): void {
  const ms2 = scan?.SurfaceGravity;
  if (ms2 == null || !Number.isFinite(ms2)) return;
  const shown = matches.filter((m) => !m.unlikely);
  const lab = shown.find((m) => m.entry.id === LABIATA);
  const ren = shown.find((m) => m.entry.id === RENIBUS);
  if (!lab || !ren) return;
  if (shown.some((m) => m.entry.genusDataDir === "concha" && m !== lab && m !== ren)) return;
  const lp = lab.presenceProbabilityPercent;
  const rp = ren.presenceProbabilityPercent;
  if (lp == null || rp == null) return;
  const labiataShouldLead = ms2 / G < CONCHA_LABIATA_BELOW_G;
  if (labiataShouldLead === lp >= rp) return;
  lab.presenceProbabilityPercent = rp;
  ren.presenceProbabilityPercent = lp;
  const ls = lab.genusSharePercent;
  lab.genusSharePercent = ren.genusSharePercent;
  ren.genusSharePercent = ls;
}
