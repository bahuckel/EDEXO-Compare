/**
 * Per-species histograms, on one global ruler.
 *
 * Tier 1 of §7.2, and the input §2.4's ranking model was blocked on. The profile already carries a
 * rollup per numeric — min, max, mean, mode — and a rollup cannot answer "how often does this
 * species sit *here*". A histogram can, and the model needs exactly that: `P(value | species)`, one
 * factor per parameter, multiplied.
 *
 * The edges are cut at quantiles of the pooled corpus rather than per species, which is the whole
 * point. A species' own quantiles would make every species look identically spread; shared edges
 * make a narrow species narrow *against the galaxy* — and they let two species' likelihoods be
 * compared on the same body, which is the only comparison ranking cares about.
 */
import {
  HISTOGRAM_BINS,
  histogramBin,
  type HistogramEdges,
  type SpeciesHistograms,
} from "../shared/likelihoodBins.js";

/**
 * Values a parameter needs across the whole corpus before it gets edges at all.
 *
 * Below this the quantiles are noise dressed as structure. A parameter without edges is simply
 * absent from the model, which is the honest failure: no term rather than a wrong one.
 */
export const MIN_SAMPLES_FOR_EDGES = 200;

/**
 * Observations a species needs on a parameter before its histogram is written.
 *
 * One. A histogram of a single body is a spike, and on its own it would claim the species grows at
 * exactly that gravity and nowhere else — which is why the model used to decline below twenty. The
 * codex envelope (§16.1) supplies the width instead, in proportion to how thin the profile is, so
 * the spike becomes "near the one point we have, inside the range the codex allows". Withholding the
 * observation entirely would throw away the only thing known about a rare species.
 */
export const MIN_SAMPLES_FOR_HISTOGRAM = 1;

/**
 * Interior edges at equal-population quantiles of the pooled values.
 *
 * Returns `[]` when the parameter cannot be cut into distinct bins — a value that is constant, or
 * nearly so, across the corpus tells the model nothing and would otherwise produce edges that
 * collide and silently merge bins.
 */
export function globalEdges(values: number[], bins = HISTOGRAM_BINS): number[] {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length < MIN_SAMPLES_FOR_EDGES) return [];
  const edges: number[] = [];
  for (let i = 1; i < bins; i++) {
    edges.push(clean[Math.min(clean.length - 1, Math.floor((i / bins) * clean.length))]!);
  }
  const distinct = [...new Set(edges)];
  return distinct.length === edges.length ? edges : [];
}

/** One count per bin for this species' observations of one parameter. */
export function histogramOf(values: number[], edges: number[], bins = HISTOGRAM_BINS): number[] {
  const counts = new Array<number>(bins).fill(0);
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    counts[histogramBin(edges, v)]! += 1;
  }
  return counts;
}

/**
 * Interior edges at equal width across the pooled range.
 *
 * Quantiles put the bins where the *rows* are, which is right for a parameter whose corpus is spread
 * and badly wrong for one whose corpus is a few tight clusters. Rock fraction is the second kind:
 * Frutexa acus alone contributes 3,612 bodies within half a percentage point of 91 % rock, so the
 * quantile cut spent twelve of sixteen bins on 90.64-91.21 and left everything from 69 % to 90.6 %
 * in a single bin. Acus (85.31-97.28 %) and metallicum (64.25-72 %) do not overlap on this axis at
 * all, and that one fat bin held both — a body at 85.9 % rock scored 224 acus against 14 metallicum
 * where the true ratio is every acus against none.
 *
 * Equal width cannot collapse like that: the bin a value lands in depends on the value, not on how
 * many rows some other species contributed nearby.
 */
export function equalWidthEdges(values: number[], bins = HISTOGRAM_BINS): number[] {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < MIN_SAMPLES_FOR_EDGES) return [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of clean) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(hi > lo)) return [];
  const edges: number[] = [];
  for (let i = 1; i < bins; i++) edges.push(lo + ((hi - lo) * i) / bins);
  const distinct = [...new Set(edges)];
  return distinct.length === edges.length ? edges : [];
}

/**
 * Parameters cut at equal width rather than at quantiles.
 *
 * The crust split and the atmosphere gases: percentages of a whole, and the two families of path
 * measured to collapse under quantiles. Every other numeric is spread widely enough across the corpus
 * that quantiles do what they are there for — see {@link equalWidthEdges}.
 *
 * Atmospheres collapse harder than the crust did. A gas is usually one of a few repeated values —
 * 100 % nitrogen, 98 % carbon dioxide — so the pooled quantiles land on the same number many times
 * over, the distinct-edge check fails, and `globalEdges` returns nothing at all. That is why the
 * shipped `histogram-edges.json` had **no atmosphere paths whatsoever**: not a term the model scored
 * badly, a term it never had.
 */
function usesEqualWidthEdges(path: string): boolean {
  return /^body\.solidComposition\.(rock|metal)$/i.test(path) || /^body\.atmosphereComposition\./i.test(path);
}

/**
 * Ice, left out of the model on purpose.
 *
 * The three fractions sum to a hundred, so any two of them carry the whole crust and the third is
 * the same fact counted again — and the terms are summed as if independent. Ice is the one to drop:
 * on the landable bodies biology grows on it is almost always zero, and where it is not, the body's
 * own class already says so. Quantile edges collapsed on it and it had no edges at all, so the model
 * has never scored it; measured with all three, ordering gained nothing over rock and metal alone
 * (mean rank 3.248 against 3.257, top-3 62.5 % against 62.9 %) and the reliability of "Chance here"
 * lost a third of its accuracy (0.0072 against 0.0050). A term that says what two other terms
 * already said only makes the model more certain, never more right.
 */
function isExcludedCompositionPath(path: string): boolean {
  return /^body\.solidComposition\.ice$/i.test(path);
}

/** How far a quantile edge may move to land on a codex value. */
export const SNAP_TO_CODEX_K = 2;

/**
 * Move the nearest edge onto each codex value within {@link SNAP_TO_CODEX_K}, keeping the bin count.
 *
 * The temperature rescue at a codex edge asks the fine histogram which side of the edge a species'
 * bodies are on, and a bin that straddles the edge cannot say. Quantile edges land wherever the
 * corpus puts them: on 2026-09-18 they fell exactly on 165, 167 and 169 K — corpus temperatures
 * cluster on whole kelvin — and the rescue worked by that luck. A rebuild on 2026-09-24 moved the 165
 * edge to 165.16 K, the paleas bin became 162.9-165.2 K, and the commander's own paleas at 162.1 K
 * lost its rescue. Snapping makes the edges the rescue needs part of the ruler, not an accident of it.
 */
export function snapEdgesToValues(edges: number[], values: readonly number[], within = SNAP_TO_CODEX_K): number[] {
  const out = [...edges];
  const taken = new Set<number>();
  for (const v of [...new Set(values)].sort((a, b) => a - b)) {
    let best = -1;
    for (let i = 0; i < out.length; i++) {
      if (taken.has(i)) continue;
      if (best < 0 || Math.abs(out[i]! - v) < Math.abs(out[best]! - v)) best = i;
    }
    if (best < 0 || Math.abs(out[best]! - v) > within) continue;
    const trial = [...out];
    trial[best] = v;
    // Only if the edges stay strictly increasing — a snap may never merge or reorder bins.
    if (trial.every((e, i) => i === 0 || e > trial[i - 1]!)) {
      out[best] = v;
      taken.add(best);
    }
  }
  return out;
}

/**
 * Edges for every parameter the pooled corpus can support.
 *
 * `snapTo` names codex values per path (the species rows' temperature limits) that an edge should
 * sit on exactly — see {@link snapEdgesToValues}.
 */
export function buildGlobalEdges(
  pooled: Map<string, number[]>,
  snapTo?: Readonly<Record<string, readonly number[]>>,
): HistogramEdges {
  const out: HistogramEdges = {};
  for (const [path, values] of pooled) {
    if (isExcludedCompositionPath(path)) continue;
    let edges = usesEqualWidthEdges(path) ? equalWidthEdges(values) : globalEdges(values);
    const snap = snapTo?.[path];
    if (edges.length && snap?.length) edges = snapEdgesToValues(edges, snap);
    if (edges.length) out[path] = edges;
  }
  return out;
}

/** Histograms for one species, skipping parameters with no edges or too few observations. */
export function buildSpeciesHistograms(
  samples: Map<string, number[]>,
  edges: HistogramEdges,
): SpeciesHistograms {
  const out: SpeciesHistograms = {};
  for (const [path, values] of samples) {
    const e = edges[path];
    if (!e || values.length < MIN_SAMPLES_FOR_HISTOGRAM) continue;
    out[path] = histogramOf(values, e);
  }
  return out;
}

/**
 * Bins for the chart, over the species' own range rather than the galaxy's.
 *
 * The model's histogram uses globally shared quantile edges so two species can be compared, and that
 * is exactly wrong for drawing one: a species living between 50 K and 124 K sits inside a single
 * global bin, and the chart becomes one featureless block — the summary B7 was raised to replace,
 * redrawn as a bar. Equal-width bins across the species' own min…max show where inside its range it
 * actually sits, which is the review tool the owner asked for.
 */
export const DISPLAY_BINS = 16;

export interface DisplayHistogram {
  min: number;
  max: number;
  /** {@link DISPLAY_BINS} equal-width counts across `min`…`max`. */
  counts: number[];
}

export function displayHistogramOf(values: number[], bins = DISPLAY_BINS): DisplayHistogram | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < MIN_SAMPLES_FOR_HISTOGRAM) return null;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  // One observation, or many identical ones: there is a value but no distribution to draw.
  if (!(max > min)) return null;
  const counts = new Array<number>(bins).fill(0);
  const span = max - min;
  for (const v of clean) {
    const i = Math.min(bins - 1, Math.floor(((v - min) / span) * bins));
    counts[i]! += 1;
  }
  return { min, max, counts };
}

export function buildDisplayHistograms(samples: Map<string, number[]>): Record<string, DisplayHistogram> {
  const out: Record<string, DisplayHistogram> = {};
  for (const [path, values] of samples) {
    const h = displayHistogramOf(values);
    if (h) out[path] = h;
  }
  return out;
}
