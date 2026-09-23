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
import { observationFloor } from "./observationFloors.js";
import { loadHistogramEdges } from "./likelihoodData.js";

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
 *
 * **Re-swept after the §45 hydration pass grew the corpus by 34 %** and none of the six floors
 * moved: every upward step cost recall and bought nothing on ambiguity. The one exception proves
 * the shape — doubling the planet-class floor to 40 buys 0.12 candidates for **nine species**.
 *
 * **Re-swept 2026-09-09** against a corpus twice the size, and this floor held: neither step away
 * from it bought decidability without costing recall. The full table and the one near-miss (the
 * atmosphere floor at 20) are in speciesAtmosphereObservations.ts; the runner is
 * scripts/floor-sweep.ts.
 */ export const MIN_TEMPERATURE_OBSERVATIONS = observationFloor("TEMPERATURE", 20);

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

/**
 * Kelvin either side of the body within which a sighting counts as "at this temperature".
 *
 * The scale of the codex's own rounding and of the 2 % tolerance the flat gate already allows
 * (3.8 K at 190 K). Wide enough that Stratum paleas at 162.1 K finds the 33 bodies recorded at
 * 162.6-165 K; narrow enough that Stratum cucumisis at 184 K finds none of its bodies, which sit at
 * 191 K and above.
 */
export const NEAR_TEMPERATURE_WINDOW_K = 3;

/**
 * Sightings of this species within {@link NEAR_TEMPERATURE_WINDOW_K} of `kelvin` **and on the far
 * side of a codex edge** — the question to ask when the display bin straddles that edge.
 *
 * Read from the profile's fine histogram, cut on the global edges in `histogram-edges.json`, which
 * are dense exactly where the codex edges sit (159-195 K). Each bin's count is spread evenly across
 * its width and only the part inside the window and beyond the edge is credited. Null when the
 * profile carries no fine histogram, so the caller falls back rather than reading silence as zero.
 */
export function observedNearTemperature(
  entry: SpeciesEntry,
  kelvin: number,
  edge: { below?: number; above?: number },
  rootArg?: string,
): number | null {
  if (!Number.isFinite(kelvin)) return null;
  const root = rootArg ?? rootOverride ?? getProjectRoot();
  const profile = loadExomasteryProfile(root, entry);
  const counts = profile?.histograms?.[TEMPERATURE_PATH];
  const edges = loadHistogramEdges(root)?.edges?.[TEMPERATURE_PATH];
  if (!counts || !edges || counts.length !== edges.length + 1) return null;
  const numeric = profile?.numerics?.[TEMPERATURE_PATH] as { min?: number; max?: number } | undefined;

  // The side of the edge the body is on, and the window around it.
  let lo = kelvin - NEAR_TEMPERATURE_WINDOW_K;
  let hi = kelvin + NEAR_TEMPERATURE_WINDOW_K;
  if (edge.below !== undefined) hi = Math.min(hi, edge.below);
  if (edge.above !== undefined) lo = Math.max(lo, edge.above);
  if (!(hi > lo)) return 0;

  let credited = 0;
  for (let i = 0; i < counts.length; i++) {
    const n = counts[i] ?? 0;
    if (!n) continue;
    // Open end bins are bounded by the species' own observed extremes.
    const bLo = i === 0 ? (numeric?.min ?? edges[0]!) : edges[i - 1]!;
    const bHi = i === edges.length ? (numeric?.max ?? edges[edges.length - 1]!) : edges[i]!;
    const width = bHi - bLo;
    if (!(width > 0)) continue;
    /*
      A fine bin that itself straddles the codex edge says nothing about which side its bodies are
      on. The global edges fall exactly on a codex edge only at 165 K; 170, 175, 180, 190 and 195 K
      each sit inside a bin. Tussock ignis (codex 160–170 K) has 55 bodies in 169–171.7 K and none at
      170 K or above in any source, and spreading those 55 evenly credited ~34 sightings beyond the
      edge — enough to show ignis beside serrati on 472 serrati bodies at 171–173 K.

      So a straddling bin is credited only when the next bin, wholly beyond the edge, holds at least
      one sighting: the species demonstrably grows past the edge and the straddling bin's share is
      believable. Concha renibus passes (4 bodies at 174–177.5 K, below its 180 K carbon-dioxide
      edge — the commander's own renibus sits at 178 K); ignis does not (none at 171.7–174 K).
    */
    const straddles =
      (edge.below !== undefined && bHi > edge.below && bLo < edge.below) ||
      (edge.above !== undefined && bLo < edge.above && bHi > edge.above);
    if (straddles) {
      const beyond = edge.below !== undefined ? counts[i - 1] : counts[i + 1];
      if (!beyond) continue;
    }
    const overlap = Math.min(hi, bHi) - Math.max(lo, bLo);
    if (overlap > 0) credited += (n * overlap) / width;
  }
  return credited;
}
