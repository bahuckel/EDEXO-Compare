/**
 * The game's limits behind the codex's rounded numbers (2026-10-03), shared by the matcher and the
 * Encyclopedia's spawn-condition cards so the two never disagree on a body at the edge.
 */
import { EARTH_G_MS2 } from "./journalPhysics.js";

/**
 * A codex gravity limit in g is the game's limit in m/s², rounded (2026-10-03). 0.15 g is 1.5 m/s²
 * (0.1530 g) and 0.275 g is 2.7 m/s² (0.2753 g): the corpus has 271 Tubus bodies between 0.150 and
 * 0.153 g and none further, Osseus pumice 22 between 0.275 and 0.2753, Stratum tectonicas' 0.61 runs to
 * 0.611 (6.0 m/s²). Tubus rosarium at 0.150 g on the owner's Dryio Flyuae OT-Y c1-103 3 b was demoted
 * for it. So the limit is read back to the m/s² it came from, at a tenth.
 */
export function gameGravityLimitG(maxG: number | undefined): number | undefined {
  if (maxG === undefined || !Number.isFinite(maxG)) return maxG;
  const ms2 = Math.round(maxG * EARTH_G_MS2 * 10) / 10;
  return Math.max(maxG, ms2 / EARTH_G_MS2);
}

/**
 * A codex ceiling of 195 K is 195.5 K in the game (2026-10-03). On thin carbon dioxide bodies every
 * species capped at 195 K runs on past it and stops: 3,700 corpus bodies of 24 species between 195
 * and 195.5 K (Aleoida gravis 513, Tussock triticum 397, Osseus pellebantus 396 …), a handful beyond.
 * Fungoida gelata and Frutexa acus at 195 K on CO₂ were demoted for it (EDDN ScanOrganic set).
 */
export function gameTemperatureCeilingK(maxK: number): number;
export function gameTemperatureCeilingK(maxK: number | undefined): number | undefined;
export function gameTemperatureCeilingK(maxK: number | undefined): number | undefined {
  return maxK === 195 ? 195.5 : maxK;
}
