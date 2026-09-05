/**
 * P(species | this body), for the candidates the matcher offered.
 *
 * The habitat scorer answers a different question and §25.3 measured the gap: a weighted similarity
 * says how close a body is to a species' own average, which cannot be compared between two species
 * because each is measured against itself. Ranking needs one quantity on one scale for all of them.
 *
 * Bayes gives it, if the pieces exist:
 *
 *   log P(s | body)  =  log P(s)  +  Σ_p log P(value_p | s)  −  log P(body)
 *
 * `P(value_p | s)` comes from the per-species histograms the feeder now writes on globally shared
 * bin edges (§7.2 tier 1), and from the categorical counts already in every profile. `P(s)` is the
 * corpus prevalence. `log P(body)` is the same for every candidate on the body, so it cancels when
 * the scores are normalised across them — which is exactly why this can be normalised and the
 * similarity score could not.
 *
 * Two deliberate departures from textbook naive Bayes:
 *
 *  - **The terms are damped.** Twenty-seven numeric parameters are nowhere near independent — radius,
 *    mass and gravity are three views of one fact — so multiplying them all at full strength lets a
 *    body's size vote three times and drives the posterior to 0 or 1 on nothing. {@link TERM_DAMPING}
 *    is swept in the probe rather than assumed.
 *  - **Nothing is ever zero.** A bin a species has never been seen in gets Laplace smoothing, so an
 *    unusual body ranks a species low instead of removing it. Same rule as everywhere else in this
 *    matcher since §6: rank, never wall.
 */
import type {
  ExplorationScanRecord,
  JournalHostStarObservation,
  PlanetScan,
  SpeciesEntry,
} from "../shared/types.js";
import { histogramBin, type HistogramEdgesFile } from "../shared/likelihoodBins.js";
import { speciesPrior, type SpeciesPrevalenceFile } from "../shared/speciesPrior.js";
import { bucketCategoricalValue } from "../feeder/parameterImportance.js";
import {
  loadExomasteryProfile,
  valueForCategoricalPath,
  valueForNumericPath,
  type ExomasteryProfileV1,
} from "./exomasteryProfile.js";
import { shouldOmitExomasterySciencePath } from "./exomasteryPathHygiene.js";
import { loadHistogramEdges, loadSpeciesPrevalence } from "./likelihoodData.js";
import { getProjectRoot } from "./paths.js";

/**
 * How hard each parameter is allowed to pull.
 *
 * 1.0 is textbook naive Bayes and it overclaims here, because twenty-seven numeric parameters are
 * nowhere near independent — radius, mass and gravity are three views of one fact — so the product
 * lets a body's size vote three times. The exponent applies to every log term, so 0.15 leaves the
 * likelihood weighing about a sixth of what it would unchecked, which is enough to move the ranking
 * without letting it overrule the prior.
 *
 * Swept in `npm run rank-probe`, over 398 species on 1,577 candidate rows:
 *
 * | damping | mean rank | top-1 | top-3 |
 * |---|---|---|---|
 * | 0.10 | 3.281 | 35.7 % | 66.1 % |
 * | **0.15** | **3.266** | **36.2 %** | **66.3 %** |
 * | 0.25 | 3.374 | 35.7 % | 66.3 % |
 * | 0.60 | 3.693 | 33.9 % | 60.3 % |
 * | 1.00 | 3.786 | 32.9 % | 59.8 % |
 *
 * Undamped still beats the similarity scorer it replaces; the damping is worth about three points
 * of top-1 on top of that.
 */
export const TERM_DAMPING = 0.15;

/** Laplace smoothing, in pseudo-observations per bin. */
export const BIN_SMOOTHING = 0.5;

/**
 * Observations a profile needs before it is scored at all.
 *
 * One, now that the codex envelope exists. A single observation used to imply infinite precision —
 * all the probability in one bin and near zero everywhere else — so the model declined below 20
 * rather than publish that. §16.1's envelope supplies the width the observation cannot, in
 * proportion to how thin it is, and a rare species can be ranked instead of skipped. §15.2: a low
 * sample count is rarity, not unreliability.
 */
export const MIN_PROFILE_SAMPLES = 1;

export interface SpeciesLikelihood {
  /** Log posterior up to the constant `log P(body)`; comparable across candidates on one body. */
  logScore: number;
  /** Parameters that contributed a term. Zero means the profile could say nothing about this body. */
  terms: number;
  /** log P(species) — the corpus prior, before any of the body's physics. */
  logPrior: number;
}

function logSmoothed(count: number, total: number, categories: number): number {
  return Math.log((count + BIN_SMOOTHING) / (total + BIN_SMOOTHING * categories));
}

/**
 * The evidence one body gives for one species, before normalisation.
 *
 * Returns null when the species has no profile, too few observations, or nothing measurable about
 * this body — all of which mean "no opinion" rather than "unlikely", and the caller must treat them
 * that way.
 */
export function speciesLogScore(
  entry: SpeciesEntry,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  journalHost: JournalHostStarObservation | null | undefined,
  opts?: {
    root?: string;
    damping?: number;
    profile?: ExomasteryProfileV1 | null;
    paths?: Set<string>;
    /** Probe seam: drop the corpus prior, to measure what the likelihood is worth on its own. */
    noPrior?: boolean;
    /** Probe seam: sweep the floor below which a profile is not scored at all. */
    minSamples?: number;
  },
): SpeciesLikelihood | null {
  const root = opts?.root ?? getProjectRoot();
  const damping = opts?.damping ?? TERM_DAMPING;
  const profile = opts?.profile ?? loadExomasteryProfile(root, entry);
  if (!profile) return null;

  const edgesFile: HistogramEdgesFile | null = loadHistogramEdges(root);
  const prevalence: SpeciesPrevalenceFile | null = loadSpeciesPrevalence(root);
  const sampleCount = profile.sampleCount ?? 0;
  if (sampleCount < (opts?.minSamples ?? MIN_PROFILE_SAMPLES)) return null;

  let logLik = 0;
  let terms = 0;

  const histograms = profile.histograms ?? {};
  if (edgesFile) {
    for (const [path, counts] of Object.entries(histograms)) {
      if (opts?.paths && !opts.paths.has(path)) continue;
      if (shouldOmitExomasterySciencePath(path)) continue;
      const edges = edgesFile.edges[path];
      if (!edges || counts.length !== edgesFile.bins) continue;
      const v = valueForNumericPath(path, scan, rec);
      if (v == null) continue;
      const total = counts.reduce((a, b) => a + b, 0);
      if (total <= 0) continue;
      logLik += logSmoothed(counts[histogramBin(edges, v)] ?? 0, total, edgesFile.bins);
      terms++;
    }
  }

  for (const [path, counts] of Object.entries(profile.categorical ?? {})) {
    if (opts?.paths && !opts.paths.has(path)) continue;
    if (shouldOmitExomasterySciencePath(path)) continue;
    const raw = valueForCategoricalPath(path, scan, rec, journalHost);
    if (!raw) continue;
    // Bucketed on both sides: the profile stores EDSM's wording and the journal speaks its own, and
    // §27 is what happens when the two are compared as free text.
    const want = bucketCategoricalValue(path, raw);
    if (!want) continue;
    let total = 0;
    let hit = 0;
    let categories = 0;
    for (const [label, n] of Object.entries(counts)) {
      if (!Number.isFinite(n) || n <= 0) continue;
      total += n;
      categories++;
      if (bucketCategoricalValue(path, label) === want) hit += n;
    }
    if (total <= 0 || categories <= 1) continue;
    logLik += logSmoothed(hit, total, categories);
    terms++;
  }

  if (terms === 0) return null;

  const logPrior = opts?.noPrior ? 0 : Math.log(speciesPrior(prevalence, entry.id, 1 / 108));
  return { logScore: logPrior + damping * logLik, terms, logPrior };
}

export interface RankedSpecies<T> {
  match: T;
  likelihood: SpeciesLikelihood;
  /** Share of the body's total posterior — sums to 1 across the candidates that could be scored. */
  probability: number;
}

/**
 * Rank the candidates on one body against each other.
 *
 * Candidates the model cannot score are returned separately rather than pushed to the bottom: a
 * species with no profile is unmeasured, not unlikely, and sorting it below a scored one would be
 * the same mistake §15.2 warned about with thin samples.
 */
export function rankSpeciesOnBody<T extends { entry: SpeciesEntry }>(
  matches: T[],
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  journalHost: JournalHostStarObservation | null | undefined,
  opts?: {
    root?: string;
    damping?: number;
    paths?: Set<string>;
    noPrior?: boolean;
    minSamples?: number;
  },
): { ranked: RankedSpecies<T>[]; unscored: T[] } {
  const ranked: RankedSpecies<T>[] = [];
  const unscored: T[] = [];

  for (const m of matches) {
    const likelihood = speciesLogScore(m.entry, scan, rec, journalHost, opts);
    if (!likelihood) unscored.push(m);
    else ranked.push({ match: m, likelihood, probability: 0 });
  }
  if (ranked.length === 0) return { ranked, unscored };

  // Softmax in log space: subtract the maximum before exponentiating, or a body with twenty terms
  // underflows to zero everywhere and the ranking becomes the order of the input array.
  const max = Math.max(...ranked.map((r) => r.likelihood.logScore));
  let sum = 0;
  for (const r of ranked) {
    r.probability = Math.exp(r.likelihood.logScore - max);
    sum += r.probability;
  }
  for (const r of ranked) r.probability = sum > 0 ? r.probability / sum : 0;

  ranked.sort(
    (a, b) =>
      b.probability - a.probability || a.match.entry.displayName.localeCompare(b.match.entry.displayName),
  );
  return { ranked, unscored };
}
