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
import { regionalSpeciesCount } from "./regionSpeciesData.js";
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
 * Re-swept 2026-09-17 on the current model — after the volcanism term landed and the regional prior
 * moved to 0.25, either of which could have moved the optimum. 585 species over 2,126 candidate
 * rows:
 *
 * | damping | mean rank | top-1 | top-3 | calibration |
 * |---|---|---|---|---|
 * | 0.05 | 3.328 | 174 (29.7 %) | 371 (63.4 %) | 0.0084 |
 * | 0.10 | 3.070 | 187 (32.0 %) | 383 (65.5 %) | 0.0047 |
 * | **0.15** | **3.094** | **202 (34.5 %)** | **386 (66.0 %)** | **0.0069** |
 * | 0.20 | 3.137 | 207 (35.4 %) | 379 (64.8 %) | 0.0103 |
 * | 0.25 | 3.193 | 211 (36.1 %) | 365 (62.4 %) | 0.0155 |
 * | 0.40 | 3.332 | 203 (34.7 %) | 365 (62.4 %) | 0.0307 |
 *
 * It held. Top-3 peaks here and nowhere else; 0.10 takes mean rank by 0.024 and gives up fifteen
 * bodies of top-1 for it; and every step above buys top-1 by letting the likelihood shout, with the
 * calibration gap climbing monotonically — 0.0069 here against 0.0307 at 0.40, which is what
 * over-trusting twenty-seven correlated parameters looks like from the outside.
 *
 * Undamped still beats the similarity scorer it replaces; the damping is worth about three points
 * of top-1 on top of that.
 */
export const TERM_DAMPING = 0.15;

/**
 * What the atmosphere is worth, in terms.
 *
 * Its gases are fractions of one envelope summing to a hundred, so a term per gas lets a single fact
 * vote as many times as the game happened to name gases — and on a two-gas body most of those terms
 * are "0 % of something neither species uses", which agrees with nearly every candidate. Pooled to
 * the mean and then given this many terms' weight, swept on the probe like {@link TERM_DAMPING}:
 *
 * Re-swept 2026-09-17 on the current model, 585 species over 2,126 candidate rows:
 *
 * | weight | mean rank | top-1 | top-3 | calibration | B3 |
 * |---|---|---|---|---|---|
 * | 0, dead | 3.116 | 175 (29.9 %) | 377 (64.4 %) | 0.0071 | 0.0073 |
 * | 1 | 3.058 | 191 (32.6 %) | 382 (65.3 %) | 0.0070 | 0.0069 |
 * | 2 | 3.067 | 197 (33.7 %) | 383 (65.5 %) | 0.0039 | 0.0092 |
 * | **3** | **3.094** | **202 (34.5 %)** | **386 (66.0 %)** | **0.0069** | **0.0111** |
 * | 4 | 3.161 | 200 (34.2 %) | 379 (64.8 %) | 0.0157 | 0.0100 |
 * | 5 | 3.186 | 199 (34.0 %) | 376 (64.3 %) | 0.0085 | 0.0092 |
 * | 6 | 3.226 | 198 (33.8 %) | 375 (64.1 %) | 0.0102 | 0.0113 |
 *
 * Three held. It takes both top-1 and top-3 outright, and past it every column gives way at once,
 * which is the shape of a term being asked to carry more than it knows. Two has the best
 * calibration in the table at 0.0039 and it was not taken: the column reads 0.0071, 0.0070, 0.0039,
 * 0.0069, 0.0157, 0.0085, 0.0102 — it bounces rather than trends, so 0.0039 is a low draw and not a
 * property of that weight. Compare the regional prior, where the same column climbs monotonically
 * across five points and the trade is real.
 *
 * **The term is worth 27 bodies of top-1** — 175 dead against 202 — which is the largest single
 * contribution in this file.
 */
export const ATMOSPHERE_TERM_WEIGHT = 3;

/**
 * What volcanism is worth, in terms.
 *
 * It is one fact, not eight like the atmosphere, so the question here is only how hard it should
 * pull. Swept on `npx tsx scripts/rank-probe.ts --model` — **on the posterior**, which matters:
 * without `--model` the probe ranks by habitat similarity, a score the panel does not use, and this
 * term was first reported against that one. Over 585 species on 2,126 scored candidate rows:
 *
 * | weight | mean rank | top-1 | top-3 | calibration | B3 |
 * |---|---|---|---|---|---|
 * | 0, dead | 3.326 | 195 (33.3 %) | 362 (61.9 %) | 0.0026 | 0.0097 |
 * | 0.5 | 3.320 | 196 (33.5 %) | 363 (62.1 %) | 0.0024 | 0.0096 |
 * | 1 | 3.311 | 198 (33.8 %) | 363 (62.1 %) | 0.0028 | 0.0099 |
 * | **2** | **3.303** | **199 (34.0 %)** | **363 (62.1 %)** | **0.0024** | **0.0107** |
 * | 3 | 3.304 | 200 (34.2 %) | 362 (61.9 %) | 0.0024 | 0.0107 |
 * | 4 | 3.304 | 200 (34.2 %) | 362 (61.9 %) | 0.0019 | 0.0103 |
 * | 5 | 3.301 | 200 (34.2 %) | 362 (61.9 %) | 0.0025 | 0.0093 |
 * | 8 | 3.299 | 200 (34.2 %) | 361 (61.7 %) | 0.0023 | 0.0085 |
 *
 * Two is the knee, and a modest one. Top-3 is at its maximum there and does not reach it again;
 * mean rank is within 0.004 of the floor the whole curve ever finds; and everything past 3 is drift
 * of one or two bodies, which on 585 is not a result. Where the curve is this flat the smaller
 * weight is the honest choice, because it claims less for the same answer.
 *
 * **The whole term is worth about four bodies of top-1** — 195 to 199 — and roughly 0.02 of mean
 * rank. Real, in the right direction, and small. It is worth having because the bodies it moves are
 * the ones the commander cannot resolve any other way: volcanism is on 5.7 % of landable bio bodies
 * galaxy-wide, so most of this corpus never asks the question, and on the bodies that do ask it the
 * corpus separates the species sharply — Bacterium verrata is 26 of 26 volcanic against a 19.1 %
 * ambient, aurasus 6,889 of 6,889 quiet.
 *
 * The B3 column wobbles by 0.001 with no pattern; its top bins hold 19 and 68 rows and that is
 * noise, not a signal about the weight. The overall calibration does not degrade at any weight,
 * which corrects what was reported when this term first landed: the 0.0572 → 0.0641 drift seen then
 * was measured on the habitat scorer, not on the posterior.
 */
export const VOLCANISM_TERM_WEIGHT = 2;

/**
 * How far the region is allowed to speak, against the corpus-wide prior it replaces.
 *
 * `0` is the galaxy-wide prior alone, `1` the regional count alone. It lives here rather than in
 * `snapshot.ts` because `rank-probe` has to read the same number the panel does — when the probe
 * defaulted this to off it was measuring a configuration the app has never run, which is how a
 * comparison against "off" came to be presented as a live option.
 *
 * Swept on `rank-probe --region-weight=`, 585 ranked species over 2,126 candidate rows. The
 * calibration column is the one the earlier sweep did not carry, and it is what moved the answer:
 *
 * | weight | mean rank | top-1 | top-3 | calibration |
 * |---|---|---|---|---|
 * | 0, corpus only | 3.303 | 199 (34.0 %) | 363 (62.1 %) | 0.0024 |
 * | **0.25** | **3.094** | **202 (34.5 %)** | **386 (66.0 %)** | **0.0069** |
 * | 0.5 (was) | 3.072 | 205 (35.0 %) | 382 (65.3 %) | 0.0108 |
 * | 0.75 | 3.075 | 214 (36.6 %) | 389 (66.5 %) | 0.0127 |
 * | 1 | 3.087 | 220 (37.6 %) | 389 (66.5 %) | 0.0190 |
 *
 * **Top-3 is all but saturated at 0.25** — 386 of the 389 the curve ever reaches — so the cheapest
 * setting buys nearly all of "the right answer is visible without scrolling". Everything above it
 * buys top-1 specifically, and pays for it in the one number on the card that has been checked
 * against reality: as a root-mean-square gap, "Chance here" is out by about 8 points at 0.25, 10 at
 * 0.5 and 14 at 1.
 *
 * The blend is `w · log(regionalCount + 0.5) + (1 − w) · corpusLogPrior`. A log count spans ten log
 * units from 12,760 recordings down to none, while the damped likelihood — everything the body
 * itself says — contributes one or two. At full weight the posterior stops being a posterior and
 * becomes a regional popularity lookup with the body's physics as a tiebreaker, which is exactly
 * what the calibration column reports.
 *
 * Moving from 0.5 to 0.25 costs 3 bodies of top-1 and returns 4 of top-3, and takes the calibration
 * gap down by a third. The regional counts come from bodies commanders *chose* to map, so the
 * lighter hand is also the more honest one: a species merely unpopular to scan here should not be
 * ranked away for it. Revisit if the corpus ever carries complete labels.
 */
export const REGION_PRIOR_WEIGHT = 0.25;

/** Laplace smoothing, in pseudo-observations per bin. */
export const BIN_SMOOTHING = 0.5;

/**
 * Observations a profile needs before it is scored at all.
 *
 * One. A single observation used to imply infinite precision — all the probability in one bin and
 * near zero everywhere else — so the model declined below 20 rather than publish that. What supplies
 * the width the observation cannot is {@link BIN_SMOOTHING}: half a pseudo-observation in every one
 * of the sixteen shared bins, so a species seen once reads as a broad hint rather than a certainty,
 * and a rare species can be ranked instead of skipped. §15.2: a low sample count is rarity, not
 * unreliability.
 *
 * The earlier version of this comment credited §16.1's codex envelope. That envelope was built,
 * measured at **zero effect on every headline number**, and removed (§34.2) — Laplace smoothing was
 * already doing the whole job. Do not go looking for it.
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
    /** Probe seam: sweep {@link VOLCANISM_TERM_WEIGHT}. Zero drops the term entirely. */
    volcanismWeight?: number;
    /** Probe seam: sweep {@link ATMOSPHERE_TERM_WEIGHT}. Zero drops the pooled gas term. */
    atmosphereWeight?: number;
    /**
     * Probe seam: rank on how common the species is *in this region* instead of in the galaxy.
     *
     * The corpus prior asks "how much of all recorded biology is this species", which is the same
     * number over the whole galaxy. Region answers a narrower and far sharper question, and the
     * counts are already shipped — they are simply thresholded into a boolean by the absence gate
     * and discarded. Off by default until it is measured.
     */
    regionPrior?: boolean;
    /** klightspeed region index for the body's system; {@link regionPrior} does nothing without it. */
    regionIndex?: number | null;
    /**
     * How far to move from the corpus prior toward the regional one, 0…1.
     *
     * A log count and a log share are on different scales, and the count's range is the wider by
     * far — 12,760 recordings against none at all is ten log units, where the damped likelihood
     * contributes a fraction of that. At full weight the posterior stops being a posterior and
     * becomes a region lookup: ordering improves and the calibration of "Chance here" halves, which
     * is a bad trade for the one number in the panel that has been checked against reality.
     */
    regionPriorWeight?: number;
    /**
     * Probe seam: leave these paths out of the score.
     *
     * The terms are summed as if independent, and some of them are not. Six species split into two
     * temperature clusters ~200 K apart that are 99.8-100 % separated by atmosphere — carbon dioxide
     * cold, water hot — so `body.surfaceTemperature` and `body.atmosphereType` are very nearly the
     * same fact for them, counted twice. Dropping one measures how much of the other it was already
     * saying.
     */
    dropPaths?: Set<string>;
    /**
     * Probe seam: score the *average* term instead of their sum.
     *
     * The sum penalises a species for being measurable on more axes, because every term adds a log
     * probability and all of them are negative. Tubus compagibus scored on fifteen terms against
     * cavas's fourteen and lost the likelihood by 1.886 while holding the larger prior. Most of the
     * extra terms carry no information at all — dropping any one of the seventeen material paths
     * moves nothing — so the species with more data is fined for having it.
     */
    perTerm?: boolean;
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
  /*
    The atmosphere is one observation, not eight.

    Its gases are fractions of a single envelope and sum to a hundred, so summing a term per gas lets
    one fact vote as many times as the game happened to name gases — and on a two-gas body six of
    those terms are "0 % of a gas this species does not use either", which agree with almost every
    candidate and multiply confidence without separating anything. Scored that way the ordering
    improved sharply and the reliability of "Chance here" lost more than half its accuracy.

    Pooled and averaged instead: the gases share one term's worth of weight between them. The
    discrimination survives — a body with no argon still excludes an argon species, which is the
    whole point — and the posterior stops treating one atmosphere as eight independent agreements.
  */
  let atmoLog = 0;
  let atmoTerms = 0;
  if (edgesFile) {
    for (const [path, counts] of Object.entries(histograms)) {
      if (opts?.paths && !opts.paths.has(path)) continue;
      if (opts?.dropPaths?.has(path)) continue;
      if (shouldOmitExomasterySciencePath(path)) continue;
      const edges = edgesFile.edges[path];
      if (!edges || counts.length !== edgesFile.bins) continue;
      const v = valueForNumericPath(path, scan, rec);
      if (v == null) continue;
      const total = counts.reduce((a, b) => a + b, 0);
      if (total <= 0) continue;
      const lp = logSmoothed(counts[histogramBin(edges, v)] ?? 0, total, edgesFile.bins);
      if (/^body\.atmosphereComposition\./i.test(path)) {
        atmoLog += lp;
        atmoTerms++;
        continue;
      }
      logLik += lp;
      terms++;
    }
  }
  const atmoWeight = opts?.atmosphereWeight ?? ATMOSPHERE_TERM_WEIGHT;
  if (atmoTerms > 0 && atmoWeight > 0) {
    logLik += (atmoWeight * atmoLog) / atmoTerms;
    terms += atmoWeight;
  }

  for (const [path, counts] of Object.entries(profile.categorical ?? {})) {
    if (opts?.paths && !opts.paths.has(path)) continue;
    if (opts?.dropPaths?.has(path)) continue;
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
    if (total <= 0 || categories < 1) continue;
    const lp = logSmoothed(hit, total, categories);
    if (/volcanism/i.test(path)) {
      const w = opts?.volcanismWeight ?? VOLCANISM_TERM_WEIGHT;
      if (w <= 0) continue;
      logLik += w * lp;
      terms += w;
      continue;
    }
    logLik += lp;
    terms++;
  }

  if (terms === 0) return null;

  /*
    Which prior, and why the two cannot be mixed on one body.

    A regional log-prior is a log *count* and the corpus one is a log *share*; putting some
    candidates on one scale and the rest on the other would not be a weighting, it would be noise.
    So the region answers for every candidate or for none — and where it has no row, every candidate
    falls back together.
  */
  const regionalCount =
    opts?.regionPrior && opts.regionIndex != null
      ? regionalSpeciesCount(root, opts.regionIndex, entry.id)
      : null;
  const corpusLogPrior = Math.log(speciesPrior(prevalence, entry.id, 1 / 108));
  const regionWeight = Math.min(1, Math.max(0, opts?.regionPriorWeight ?? 1));
  const logPrior = opts?.noPrior
    ? 0
    : regionalCount != null
      ? // Half a system of smoothing: a species not yet recorded here is rare, not impossible.
        regionWeight * Math.log(regionalCount + 0.5) + (1 - regionWeight) * corpusLogPrior
      : corpusLogPrior;
  // Averaging rescales the likelihood, so multiply back by a typical term count to keep it on the
  // same footing as the prior and leave `damping` meaning what it meant before.
  const TYPICAL_TERMS = 14;
  const shaped = opts?.perTerm && terms > 0 ? (logLik / terms) * TYPICAL_TERMS : logLik;
  return { logScore: logPrior + damping * shaped, terms, logPrior };
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
    volcanismWeight?: number;
    atmosphereWeight?: number;
    regionPrior?: boolean;
    regionIndex?: number | null;
    regionPriorWeight?: number;
    dropPaths?: Set<string>;
    perTerm?: boolean;
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
