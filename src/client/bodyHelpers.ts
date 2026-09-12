/**
 * Body-level helpers used by the pane and the app shell (7.3).
 */
import type { BodyComputed, GenusHint } from "@shared/types";

/**
 * The feeder, in its own modal — INCLUDE-BODY-IDS §11.3.
 *
 * It was rendered inside Options, under the miss log and the EDSM panel, and the owner could not
 * find it. The panel itself was fine; only its address was wrong.
 *
 * The toolbar button that opens this is shown **only when a corpus exists on this machine**, which is
 * not a normal install. An always-visible entry would open an empty modal for almost everyone.
 */
export interface SpanshRouteSummaryDTO {
  format: "csv" | "json";
  rows: number;
  systems: number;
  bodies: number;
  species: number;
  genera: number;
  systemsWithCoords: number;
  bodiesWithId: number;
  source: string | null;
  destination: string | null;
  topSpecies: { label: string; rows: number }[];
  warnings: string[];
}

/**
 * "nearest", "2nd nearest", "3rd nearest" — this body's place in the queue of flights worth making.
 *
 * Only ever reaches the screen when there is something to compare against, so there is no wording
 * for a lone body: one biological body in a system is not nearest to anything.
 */
export function tripRankLabel(rank: number): string {
  if (rank === 1) return "nearest";
  const tens = rank % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][rank % 10] ?? "th";
  return `${rank}${suffix} nearest`;
}

/** FSS biological signal count for this body (denominator for candidate species; never use DSS-only genus count). */
export function candidateSpeciesDenomFromFss(state: BodyComputed["state"]): number {
  return state.biologicalSignals ?? 0;
}

export function genusHintIsDssOrphan(g: GenusHint, orphans: GenusHint[]): boolean {
  return orphans.some((o) => o.Genus === g.Genus && o.Genus_Localised === g.Genus_Localised);
}
