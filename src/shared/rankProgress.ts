/**
 * Exploration and Exobiology rank, and about how many credits to the next one (guild tester report,
 * 2026-09-30: "the in-game progress bar doesn't give any numerical details").
 *
 * Frontier does not publish the thresholds, and the community tables were partly guesses after
 * Update 14 moved them (owner's choice, 2026-09-30: derive, don't tabulate). So each commander's own
 * journal answers it: the game writes the rank's `Progress` % at every login, and `Promotion` when a
 * rank is reached. Credits earned from the promotion (0 %) to a later reading of p % are p % of the
 * rank's band; the rest of the band, less what was sold since that reading, is what is left.
 *
 *   band ≈ credits earned between the two readings ÷ (difference in %)
 *
 * With no promotion in the journals (it happened before the oldest one), the first and last readings
 * of the current rank are used instead. Too small a difference (under {@link MIN_STEP_PCT} points)
 * gives no estimate — a 1 % reading is a rounded integer and would swing it wildly.
 */
import type { IncomeCategory, IncomeEvent } from "./incomeCategories.js";

/** One `Rank`, `Progress` or `Promotion` line, the two ranks this app cares about. */
export interface RankLine {
  at: string;
  event: "Rank" | "Progress" | "Promotion";
  explore?: number;
  exobio?: number;
}

export type RankKind = "explore" | "exobio";

export interface RankEstimateDTO {
  kind: RankKind;
  rank: number;
  name: string;
  /** Null at Elite V. */
  next: string | null;
  /** The game's last reading (integer %), and when it was taken. */
  progressPct: number | null;
  progressAt: string | null;
  /** With what was sold since that reading added: an estimate. */
  estimatedPct: number | null;
  /** About how many credits to the next rank; null when the journal cannot say yet. */
  creditsToNext: number | null;
  /** The whole rank's size, as estimated. */
  bandCredits: number | null;
  /** What the estimate is measured from: the promotion, or the first reading of this rank. */
  basis: "promotion" | "readings" | null;
  basisAt: string | null;
}

export const RANK_NAMES: Record<RankKind, string[]> = {
  explore: [
    "Aimless",
    "Mostly Aimless",
    "Scout",
    "Surveyor",
    "Trailblazer",
    "Pathfinder",
    "Ranger",
    "Pioneer",
    "Elite",
    "Elite I",
    "Elite II",
    "Elite III",
    "Elite IV",
    "Elite V",
  ],
  exobio: [
    "Directionless",
    "Mostly Directionless",
    "Compiler",
    "Collector",
    "Cataloguer",
    "Taxonomist",
    "Ecologist",
    "Geneticist",
    "Elite",
    "Elite I",
    "Elite II",
    "Elite III",
    "Elite IV",
    "Elite V",
  ],
};

const CATEGORY: Record<RankKind, IncomeCategory> = { explore: "exploration", exobio: "exobiology" };
export const MIN_STEP_PCT = 3;

const t = (iso: string) => Date.parse(iso);

export function estimateRank(lines: readonly RankLine[], income: readonly IncomeEvent[], kind: RankKind): RankEstimateDTO | null {
  const own = lines
    .filter((l) => typeof l[kind] === "number" && Number.isFinite(t(l.at)))
    .sort((a, b) => t(a.at) - t(b.at));
  const rankLines = own.filter((l) => l.event === "Rank" || l.event === "Promotion");
  if (!rankLines.length) return null;
  const rank = rankLines[rankLines.length - 1]![kind]!;
  const names = RANK_NAMES[kind];
  const name = names[rank] ?? `Rank ${rank}`;
  const next = rank + 1 < names.length ? names[rank + 1]! : null;

  // Where the current rank began: its promotion if the journals have it, else the first line that
  // already says this rank after the last line that said another.
  const promotion = [...own].reverse().find((l) => l.event === "Promotion" && l[kind] === rank) ?? null;
  let startAt: number;
  if (promotion) startAt = t(promotion.at);
  else {
    let i = rankLines.length - 1;
    while (i > 0 && rankLines[i - 1]![kind] === rank) i--;
    startAt = t(rankLines[i]!.at);
  }
  const readings = own.filter((l) => l.event === "Progress" && t(l.at) >= startAt);
  const last = readings[readings.length - 1] ?? null;

  const base: RankEstimateDTO = {
    kind,
    rank,
    name,
    next,
    progressPct: last ? last[kind]! : null,
    progressAt: last?.at ?? null,
    estimatedPct: null,
    creditsToNext: null,
    bandCredits: null,
    basis: null,
    basisAt: null,
  };
  if (!next || !last) return base;

  const anchor = promotion
    ? { at: t(promotion.at), pct: 0, iso: promotion.at, basis: "promotion" as const }
    : { at: t(readings[0]!.at), pct: readings[0]![kind]!, iso: readings[0]!.at, basis: "readings" as const };
  const step = last[kind]! - anchor.pct;
  if (step < MIN_STEP_PCT) return base;

  const cat = CATEGORY[kind];
  const earned = (from: number, to: number) =>
    income.reduce((sum, r) => {
      if (r.category !== cat) return sum;
      const at = t(r.at);
      return at > from && at <= to ? sum + r.credits : sum;
    }, 0);
  const lastAt = t(last.at);
  const band = earned(anchor.at, lastAt) / (step / 100);
  if (!(band > 0)) return base;
  const since = earned(lastAt, Infinity);
  const estimatedPct = Math.min(100, last[kind]! + (since / band) * 100);
  return {
    ...base,
    estimatedPct,
    creditsToNext: Math.max(0, band * (1 - last[kind]! / 100) - since),
    bandCredits: band,
    basis: anchor.basis,
    basisAt: anchor.iso,
  };
}
