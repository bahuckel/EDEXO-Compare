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

/** Edges for every parameter the pooled corpus can support. */
export function buildGlobalEdges(pooled: Map<string, number[]>): HistogramEdges {
  const out: HistogramEdges = {};
  for (const [path, values] of pooled) {
    const edges = globalEdges(values);
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
