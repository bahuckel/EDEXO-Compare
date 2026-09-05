/**
 * Has the corpus watched this species grow at this temperature?
 *
 * The third field to ask the question, after the host star (§27) and planet class (§40), and the one
 * where the codex row is furthest from the record. The miss log's remaining absences are almost all
 * one shape:
 *
 *   Fungoida stabitis, codex band 180–195 K, found nine times between 425 K and 444 K. The corpus
 *   holds 945 bodies for it, spanning 79–467 K. Concha renibus is the same story on the same bodies.
 *
 * Temperature is the last hard wall of the five main factors: §6 ruled out walls and 3c(ii) softened
 * planet class and atmosphere, but a temperature outside the codex band by more than 2 % still
 * removes the row outright. That is why these are `absent` in the log rather than demoted, and why
 * this is worth more than the ambiguity it costs.
 *
 * The test is the observed histogram, not the observed min–max. A species seen at 79 K and 467 K has
 * not thereby been seen at every temperature between, and §24.3 measured what happens when observed
 * ranges are trusted as ranges: recall 92.3 % → 87.2 %. A populated bin is a real observation at that
 * temperature; the span between two extremes is not.
 */
import type { SpeciesEntry } from "../shared/types.js";
import { loadExomasteryProfile } from "./exomasteryProfile.js";
import { getProjectRoot } from "./paths.js";

const TEMPERATURE_PATH = "body.surfaceTemperature";

/**
 * Bodies the corpus needs in the bin containing this temperature before it overrules a codex band.
 *
 * The display histogram cuts a species' own range into sixteen, so a bin is a narrow slice and
 * twenty bodies in one is a cluster rather than a stray row. Swept in `npm run probe`:
 *
 * | floor | recall | ambiguity |
 * |---|---|---|
 * | 1 | 96.0 % | 7.73 |
 * | 5 | 96.0 % | 7.46 |
 * | **20** | **96.0 %** | **7.45** |
 * | 50 | 95.8 % | 7.44 |
 *
 * The same number the planet-class rescue landed on (§40), and the same floor the per-atmosphere
 * bands use (§24.1) — twenty is where this project keeps deciding a distribution becomes believable.
 */
export const MIN_TEMPERATURE_OBSERVATIONS = 20;

export interface TemperatureObservation {
  /** Bodies observed in the bin containing this temperature. */
  observations: number;
  /** Bodies behind the whole histogram. */
  total: number;
  binLowK: number;
  binHighK: number;
}

let rootOverride: string | null = null;

/** Test seam — the matcher has no project root to pass down, so it asks {@link getProjectRoot}. */
export function setTemperatureObservationsRootForTests(root: string | null): void {
  rootOverride = root;
}

/**
 * How often this species has been recorded at roughly this temperature, or null when it has not
 * been — or when the profile has no histogram to ask.
 */
export function observedAtTemperature(
  entry: SpeciesEntry,
  kelvin: number | null | undefined,
  rootArg?: string,
): TemperatureObservation | null {
  if (kelvin == null || !Number.isFinite(kelvin)) return null;
  const root = rootArg ?? rootOverride ?? getProjectRoot();
  const hist = loadExomasteryProfile(root, entry)?.displayHistograms?.[TEMPERATURE_PATH];
  if (!hist || hist.counts.length === 0 || !(hist.max > hist.min)) return null;
  if (kelvin < hist.min || kelvin > hist.max) return null;

  const bins = hist.counts.length;
  const step = (hist.max - hist.min) / bins;
  const i = Math.min(bins - 1, Math.floor((kelvin - hist.min) / step));
  const observations = hist.counts[i] ?? 0;
  if (observations < MIN_TEMPERATURE_OBSERVATIONS) return null;

  return {
    observations,
    total: hist.counts.reduce((a, b) => a + b, 0),
    binLowK: hist.min + step * i,
    binHighK: hist.min + step * (i + 1),
  };
}
