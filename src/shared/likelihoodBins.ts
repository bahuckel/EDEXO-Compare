/**
 * Shared shape for the histograms the ranking model reads.
 *
 * The scorer built in step 3b/5 answers "how much does this body look like the bodies this species
 * grows on" with a weighted similarity. That is not a probability, and §25.3 measured what it costs:
 * it cannot be normalised across the candidates on a body, so it cannot say which of them is more
 * likely — only how close each one is to its own average.
 *
 * A histogram can. Counting how many of a species' observed bodies fall in each bin of a parameter
 * gives P(value | species) directly, and those multiply across parameters into P(body | species) —
 * the quantity Bayes needs. The bin edges are **global per parameter**, cut at quantiles of every
 * body in the corpus, so every species is counted on the same ruler and their likelihoods are
 * comparable. Edges ship once in `data/exomastery/histogram-edges.json`; the counts ride in each
 * profile, which is roughly 47 paths × 16 numbers per species.
 */

/**
 * Bins per numeric parameter.
 *
 * Sixteen against a corpus where the median species has a few hundred bodies: enough resolution to
 * separate a narrow species from a broad one, few enough that a 200-body species still averages
 * more than ten observations a bin before smoothing.
 */
export const HISTOGRAM_BINS = 16;

/** Parameter path → the `HISTOGRAM_BINS - 1` interior edges, ascending. */
export type HistogramEdges = Record<string, number[]>;

/** Parameter path → one count per bin, `HISTOGRAM_BINS` long. */
export type SpeciesHistograms = Record<string, number[]>;

export interface HistogramEdgesFile {
  formatVersion: 1;
  builtAt: string;
  bins: number;
  /** Bodies behind the edges, for reporting. */
  samples: number;
  edges: HistogramEdges;
}

/**
 * Which bin a value falls in: 0 below the first edge, `edges.length` at or above the last.
 *
 * Edges are inclusive on the left of the bin above them, matching the feeder's own binning so a
 * value counted into bin 4 at build time is read out of bin 4 at match time.
 */
export function histogramBin(edges: number[], value: number): number {
  let i = 0;
  while (i < edges.length && value > edges[i]!) i++;
  return i;
}
