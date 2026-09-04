import type { SpeciesMatch } from "../shared/types.js";
import { deckAbsolutePercentFromScore } from "./exomasteryPathHygiene.js";

function roundPct(x: number): number {
  return Math.round(Math.max(0, Math.min(100, x)) * 10) / 10;
}

/**
 * Below this many distinct feeder bodies, a habitat-quality of 0 says more about the sample than
 * about the species, so it is not allowed to demote anything. Two profiles currently ship with a
 * single observed body; one body cannot establish where a species does not grow.
 */
export const MIN_SAMPLES_TO_DEMOTE_ON_HABITAT = 20;

/**
 * Marks strict matches whose exomastery habitat quality is exactly 0 — the body resembles nothing
 * the species has been observed on.
 *
 * These used to be deleted. They are now demoted: the candidate stays in the list, sorts last and
 * carries {@link SpeciesMatch.exomasteryHabitatUnlikely} so the UI can label it. A profile is a
 * sample of where a species *has* been seen, never proof of where it cannot be, and the samples are
 * thin — 11 of 79 shipped profiles have fewer than 20 bodies. Deleting on that evidence hid real
 * finds; a low rank costs the reader one line.
 */
export function markExomasteryZeroHabitatMatches(matches: SpeciesMatch[]): SpeciesMatch[] {
  return matches.map((m) => {
    if (m.dssNearestTemperatureMatch || m.dssPhysicalSlackMatch) return m;
    if (!m.exomasteryProfilePresent || m.exomasteryHabitatQuality !== 0) return m;
    const n = m.exomasteryProfileSampleCount;
    if (typeof n !== "number" || n < MIN_SAMPLES_TO_DEMOTE_ON_HABITAT) return m;
    return { ...m, exomasteryHabitatUnlikely: true };
  });
}

/**
 * `exomasterySimilarityPercent` = absolute % from deck score (linear vs {@link DECK_SCORE_FULL_SCALE}).
 * `exomasteryGenusRelativePercent` = this candidate's share of the group's combined deck-chip scores
 * (same-genus siblings on this body only; null when solo). Proportional, not min–max — percentages sum ~100
 * across the group. Not codex certainty or spawn probability.
 */
export function applyExomasteryGenusCompetitivePercent(matches: SpeciesMatch[]): void {
  const byDir = new Map<string, SpeciesMatch[]>();
  for (const m of matches) {
    const k = m.entry.genusDataDir;
    const list = byDir.get(k) ?? [];
    list.push(m);
    byDir.set(k, list);
  }

  for (const group of byDir.values()) {
    for (const m of group) {
      if (m.exomasteryProfilePresent) {
        m.exomasterySimilarityPercent = null;
        m.exomasteryGenusRelativePercent = null;
      }
    }

    const cand = group.filter(
      (m) =>
        m.exomasteryProfilePresent &&
        m.exomasteryHabitatQuality != null &&
        Number.isFinite(m.exomasteryHabitatQuality) &&
        m.exomasteryHabitatQuality > 0 &&
        m.exomasteryOtherMatchCardScore != null &&
        Number.isFinite(m.exomasteryOtherMatchCardScore),
    );
    if (cand.length === 0) continue;

    const weights = cand.map((m) => Math.max(0, m.exomasteryOtherMatchCardScore as number));
    const sumW = weights.reduce((a, b) => a + b, 0);

    for (let i = 0; i < cand.length; i++) {
      const m = cand[i]!;
      const w = weights[i]!;
      const S = m.exomasteryOtherMatchCardScore as number;
      m.exomasterySimilarityPercent = deckAbsolutePercentFromScore(S);
      if (cand.length >= 2) {
        m.exomasteryGenusRelativePercent =
          sumW > 1e-9 ? roundPct((100 * w) / sumW) : roundPct(100 / cand.length);
      } else {
        m.exomasteryGenusRelativePercent = null;
      }
    }
  }
}
