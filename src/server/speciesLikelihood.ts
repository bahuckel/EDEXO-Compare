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
import { histogramBin, type HistogramEdgesFile, type SpeciesHistograms } from "../shared/likelihoodBins.js";
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
import { bodyTypeLogPrior } from "./bodyTypePrior.js";

/**
 * How hard each parameter is allowed to pull.
 *
 * 1.0 is textbook naive Bayes and it overclaims here, because twenty-seven numeric parameters are
 * nowhere near independent — radius, mass and gravity are three views of one fact — so the product
 * lets a body's size vote three times. The exponent applies to every log term.
 *
 * **Re-swept 2026-09-21, and this time the model underneath it changed.** Three categorical terms
 * had never matched between the journal's spelling and the corpus's (§C1j, and see
 * `bucketCategoricalValue`), so every earlier sweep on this page tuned a model that was missing the
 * planet class on most bodies, carbon dioxide and sulphur dioxide entirely, and volcanism on every
 * quiet body. With those terms alive the likelihood carries more weight per unit and the optimum
 * moves down. 642 ranked species over 1,991 candidate rows, at atmosphere 2 / volcanism 3:
 *
 * | damping | mean rank | top-1 | top-3 | calibration |
 * |---|---|---|---|---|
 * | 0.08 | 3.097 | 191 (29.8 %) | 427 | 0.0111 |
 * | 0.10 | 3.009 | 202 (31.5 %) | **439** | 0.0108 |
 * | **0.11** | **2.995** | **208 (32.4 %)** | **438** | **0.0110** |
 * | 0.12 | 2.997 | 208 (32.4 %) | 434 | 0.0126 |
 * | 0.15 | 3.000 | 215 (33.5 %) | 427 | 0.0161 |
 * | 0.18 | 3.023 | 219 (34.1 %) | 430 | 0.0159 |
 * | 0.22 | 3.044 | 225 (35.0 %) | 429 | 0.0175 |
 *
 * Top-1 still climbs monotonically with damping and calibration still degrades with it — the same
 * trade the old sweep found, moved. 0.11 takes mean rank and sits one body off the top-3 maximum
 * with the best calibration in the table.
 *
 * Against the model as it shipped before the fix (damping 0.15, atmosphere 3, volcanism 2:
 * 3.037 / 215 / 432 / 0.0125): mean rank and calibration improve, top-3 gains six, and the two
 * genera the dead terms hurt most recover — Stratum 95 → 101, Bacterium 45 → 51. **Top-1 gives up
 * seven.** `damping 0.13, atmosphere 2, volcanism 4` was the alternative on the table and holds
 * top-1 at 213 with top-3 and calibration level; it was not taken because the calibration of
 * "Chance here" is the one number on the card that has been checked against reality.
 */
export const TERM_DAMPING = 0.11;

/**
 * What the atmosphere is worth, in terms.
 *
 * Its gases are fractions of one envelope summing to a hundred, so a term per gas lets a single fact
 * vote as many times as the game happened to name gases — and on a two-gas body most of those terms
 * are "0 % of something neither species uses", which agrees with nearly every candidate. Pooled to
 * the mean and then given this many terms' weight.
 *
 * **Re-swept 2026-09-21 after the bucketing fix (§C1j), which is what moved it.** `CarbonDioxide`
 * and `SulphurDioxide` never once matched the corpus's `Thin Carbon dioxide` and `Thin Sulphur
 * dioxide`, so this term was dead on two of the commonest bio atmospheres and the old weight of 3
 * was compensating for a term that fired on a fraction of the bodies it should have. At damping
 * 0.12, 642 species over 1,991 rows:
 *
 * | weight | mean rank | top-1 | top-3 | calibration |
 * |---|---|---|---|---|
 * | 0, dead | 3.106 | 187 (29.1 %) | 414 | 0.0099 |
 * | 1 | 3.033 | 199 (31.0 %) | 425 | 0.0099 |
 * | **2** | **3.011** | **207 (32.2 %)** | **432** | **0.0118** |
 * | 3 (was) | 3.020 | 208 (32.4 %) | 430 | 0.0135 |
 * | 4 | 3.031 | 216 (33.6 %) | 427 | 0.0165 |
 * | 5 | 3.079 | 213 (33.2 %) | 426 | 0.0186 |
 *
 * Two takes mean rank and top-3 and calibrates better than three; top-1 is a single body apart. The
 * term is still worth a great deal — **45 bodies of top-1 between dead and 2** — it simply needs
 * less weight now that it works.
 */
export const ATMOSPHERE_TERM_WEIGHT = 2;

/**
 * What volcanism is worth, in terms.
 *
 * It is one fact, not eight like the atmosphere, so the question here is only how hard it should
 * pull.
 *
 * **Re-swept 2026-09-21, and it is worth far more than it was.** An empty `Volcanism` — what the
 * journal writes on a quiet body, which is most of the galaxy — fell out on the empty-string guard
 * in `bucketCategoricalValue` and matched nothing, so this term was dead on exactly the bodies where
 * "this species is only ever found on quiet ground" is the most common thing it could say. At
 * damping 0.12, atmosphere 2:
 *
 * | weight | mean rank | top-1 | top-3 | calibration |
 * |---|---|---|---|---|
 * | 0, dead | 3.039 | 203 (31.6 %) | 430 | 0.0120 |
 * | 1 | 3.025 | 205 (31.9 %) | 431 | 0.0123 |
 * | 2 (was) | 3.011 | 207 (32.2 %) | 432 | 0.0118 |
 * | **3** | **2.997** | **208 (32.4 %)** | **434** | **0.0126** |
 * | 4 | 2.994 | 209 (32.6 %) | 434 | 0.0127 |
 * | 6 | 2.989 | 211 (32.9 %) | 434 | 0.0134 |
 *
 * Top-3 reaches its maximum at three and does not improve again; mean rank and top-1 keep creeping
 * by a body or two while calibration slowly gives way, which is drift rather than a result. Where
 * the curve is this flat the smaller weight is the honest choice, as it was when this was 2.
 *
 * The whole term is now worth **five bodies of top-1 and four of top-3** between dead and 3, against
 * "about four bodies of top-1" when half of it could not fire.
 */
export const VOLCANISM_TERM_WEIGHT = 3;

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
  /**
   * The likelihood **before** damping, after any per-term shaping.
   *
   * `logScore` is `logPrior + damping * logLik`. Exposed because the damping cannot be chosen from
   * one candidate alone: how far apart the candidates on a body are is a property of the body, and
   * only {@link rankSpeciesOnBody} can see all of them. See its `adaptive` seam.
   */
  logLik: number;
}

function logSmoothed(count: number, total: number, categories: number): number {
  return Math.log((count + BIN_SMOOTHING) / (total + BIN_SMOOTHING * categories));
}

/**
 * How peaked one histogram is, 0 (perfectly flat) to 1 (every observation in one bin).
 *
 * `1 − H/log(bins)`, the same normalised entropy the §C1 measurements report as "flatness" inverted:
 * Stratum paleas reads 0.031 against araneamus's 1.000. Probe seam only — see `informativeness`.
 */
function histogramInformativeness(counts: number[], total: number, bins: number): number {
  if (total <= 0 || bins <= 1) return 0;
  let entropy = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    entropy -= p * Math.log(p);
  }
  return Math.min(1, Math.max(0, 1 - entropy / Math.log(bins)));
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
    /**
     * Probe seam (C1): score each term against an ambient instead of in absolute terms.
     *
     * A term today is `log P(value | species)`, which is near `log(1/16)` everywhere for a species
     * whose histogram is flat. That is not "no evidence" — it is a moderate, *constant* score that a
     * species with a large prior can coast on, which is exactly Stratum paleas. Subtracting the
     * ambient's own log-probability for the same bin turns the term into a log ratio: a flat species
     * lands at zero, and a peaked sibling claiming the bin scores positively against it.
     *
     * The ambient is supplied rather than assumed, because which one is right is the question. The
     * genus is the candidate here — the rival species on a body are siblings, and "does this body
     * look more like paleas than like a generic Stratum" is the question the panel is really asking.
     */
    ambient?: { histograms?: SpeciesHistograms; categorical?: Record<string, Record<string, number>> } | null;
    /**
     * Probe seam (C1): the literal proposal in BACKLOG §C1 — weight a species' evidence by how
     * peaked its own histogram is, so a flat one cannot outvote a confident sibling.
     *
     * Kept separate from {@link ambient} because it is a different claim, and measuring it was the
     * point: every term here is a negative log, so scaling a flat species' terms *down* makes its
     * total *less* negative. See the sweep in `docs/archive/BACKLOG.md` §C1.
     */
    informativeness?: boolean;
    /**
     * Probe seam (C1): how hard a peaked species' claim on this body is amplified, 0 = off.
     *
     * Needs {@link ambient}. `lpAbs + k · informativeness · (lpAbs − lpAmbient)` — see the numeric
     * loop for why the sign matters and why replacing the term outright does the reverse.
     */
    claimWeight?: number;
    /**
     * Probe seam (C1e): how far to move the prior from the galaxy-wide share toward the share among
     * bodies of this kind, 0…1. See `bodyTypePrior.ts`.
     */
    bodyTypePriorWeight?: number;
    /** Probe seam (C1e): bodies a cell needs before it is believed. Default {@link MIN_CELL}. */
    bodyTypeMinCell?: number;
    /** Probe seam (C1f): which prior table to read — a `build-artifacts/body-type-prior-<v>.json`. */
    bodyTypeVariant?: string;
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
      const bin = histogramBin(edges, v);
      const lpAbs = logSmoothed(counts[bin] ?? 0, total, edgesFile.bins);
      let lpAmbient: number | null = null;
      const ambientCounts = opts?.ambient?.histograms?.[path];
      if (ambientCounts && ambientCounts.length === edgesFile.bins) {
        const ambientTotal = ambientCounts.reduce((a, b) => a + b, 0);
        if (ambientTotal > 0) {
          lpAmbient = logSmoothed(ambientCounts[bin] ?? 0, ambientTotal, edgesFile.bins);
        }
      }
      let lp = lpAbs;
      const claim = opts?.claimWeight ?? 0;
      if (claim > 0 && lpAmbient != null) {
        /*
          The correctly-signed form of §C1. The log ratio is *added* to the absolute term rather than
          replacing it, and scaled by how peaked the species' own histogram is. A flat species has
          informativeness near zero, so nothing is added and it keeps the floor it already pays; a
          peaked sibling standing on its own peak is amplified, and amplified against it off-peak.
          Replacing the term instead — `--ambient` — cancels that floor, which is the opposite.
        */
        lp = lpAbs + claim * histogramInformativeness(counts, total, edgesFile.bins) * (lpAbs - lpAmbient);
      } else if (lpAmbient != null) {
        lp = lpAbs - lpAmbient;
      }
      let weight = 1;
      if (opts?.informativeness) weight = histogramInformativeness(counts, total, edgesFile.bins);
      if (/^body\.atmosphereComposition\./i.test(path)) {
        atmoLog += weight * lp;
        atmoTerms++;
        continue;
      }
      logLik += weight * lp;
      terms += weight;
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
    let lp = logSmoothed(hit, total, categories);
    const ambientCat = opts?.ambient?.categorical?.[path];
    if (ambientCat) {
      let ambientTotal = 0;
      let ambientHit = 0;
      let ambientCategories = 0;
      for (const [label, n] of Object.entries(ambientCat)) {
        if (!Number.isFinite(n) || n <= 0) continue;
        ambientTotal += n;
        ambientCategories++;
        if (bucketCategoricalValue(path, label) === want) ambientHit += n;
      }
      if (ambientTotal > 0 && ambientCategories > 0) {
        lp -= logSmoothed(ambientHit, ambientTotal, ambientCategories);
      }
    }
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
  /*
    Probe seam (C1e): the prior, conditioned on what kind of body this is.

    Blended rather than swapped so the weight can be swept: 0 is today's galaxy-wide prior, 1 is the
    joint count alone. The cell is a share like the corpus prior is a share, so the two are on the
    same scale and the blend is a plain mixture — unlike the regional prior, which is a log *count*
    and needs its own weight for that reason.
  */
  const btWeight = Math.min(1, Math.max(0, opts?.bodyTypePriorWeight ?? 0));
  const bodyTypeHit =
    btWeight > 0
      ? bodyTypeLogPrior(
          scan,
          entry.id,
          root,
          opts?.bodyTypeMinCell,
          opts?.bodyTypeVariant,
          entry.genusDataDir,
        )
      : null;
  const regionWeight = Math.min(1, Math.max(0, opts?.regionPriorWeight ?? 1));
  const basePrior =
    bodyTypeHit != null ? btWeight * bodyTypeHit.logShare + (1 - btWeight) * corpusLogPrior : corpusLogPrior;
  const logPrior = opts?.noPrior
    ? 0
    : regionalCount != null
      ? // Half a system of smoothing: a species not yet recorded here is rare, not impossible.
        regionWeight * Math.log(regionalCount + 0.5) + (1 - regionWeight) * basePrior
      : basePrior;
  // Averaging rescales the likelihood, so multiply back by a typical term count to keep it on the
  // same footing as the prior and leave `damping` meaning what it meant before.
  const TYPICAL_TERMS = 14;
  const shaped = opts?.perTerm && terms > 0 ? (logLik / terms) * TYPICAL_TERMS : logLik;
  return { logScore: logPrior + damping * shaped, terms, logPrior, logLik: shaped };
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
    /** Probe seam (C1). Per *candidate*, because the right ambient is the candidate's own genus. */
    ambientFor?: (
      entry: SpeciesEntry,
    ) => { histograms?: SpeciesHistograms; categorical?: Record<string, Record<string, number>> } | null;
    informativeness?: boolean;
    bodyTypePriorWeight?: number;
    bodyTypeMinCell?: number;
    bodyTypeVariant?: string;
    /**
     * Probe seam (C1c): choose the damping from **how far apart the candidates are on this body**.
     *
     * `TERM_DAMPING` is one constant serving two opposite cases, and the field reports of 2026-09-21
     * caught it failing both ways. Stratum paleas is the truth where its own evidence is flat, so the
     * prior is the only thing getting it right and the likelihood should be damped *harder*; verrata
     * is the truth on a water-magma body where the evidence alone gives it 68.4 %, and the prior
     * drags it to third, so there the likelihood should be damped *less*.
     *
     * What separates the two is not a property of a species. It is a property of the body: whether
     * the candidates' evidence actually disagrees. Spread is the range of `logLik` across the
     * candidates, and damping ramps from `lo` at no disagreement to `hi` once the spread reaches
     * `scale`.
     *
     * Deliberately not per-species: `informativeness` was that idea and §C1 measured it failing for a
     * sign reason. This scales one number for the whole body, so it cannot hand a flat species an
     * advantage.
     */
    adaptive?: { lo: number; hi: number; scale: number; perTerm?: boolean; stat?: "range" | "topgap" };
  },
): { ranked: RankedSpecies<T>[]; unscored: T[] } {
  const ranked: RankedSpecies<T>[] = [];
  const unscored: T[] = [];

  for (const m of matches) {
    const likelihood = speciesLogScore(m.entry, scan, rec, journalHost, {
      ...opts,
      // With adaptive on, the per-species damping is irrelevant — the score is rebuilt below from a
      // spread only this function can see. Pass 1 so `logLik` comes back unshrunk either way.
      damping: opts?.adaptive ? 1 : opts?.damping,
      ambient: opts?.ambientFor?.(m.entry) ?? null,
    });
    if (!likelihood) unscored.push(m);
    else ranked.push({ match: m, likelihood, probability: 0 });
  }
  if (ranked.length === 0) return { ranked, unscored };

  /*
    Adaptive damping (probe seam). Re-derive every logScore from the spread this body actually shows.

    `speciesLogScore` already folded `damping` in, so the score is rebuilt rather than adjusted:
    logPrior + d * logLik, with one `d` for the whole body.
  */
  if (opts?.adaptive && ranked.length > 1) {
    const liks = ranked.map((r) => r.likelihood.logLik);
    /*
      Which spread. `range` is max − min and it disappointed for a reason worth keeping: it grows
      with the number of candidates and with how badly the *worst* one fits, neither of which is the
      question. A body with twelve candidates looks "decisive" because something on it is hopeless.

      `topgap` is the distance between the best and second-best likelihood — decisiveness measured
      where the decision actually happens.
    */
    const sorted = [...liks].sort((a, b) => b - a);
    let spread =
      opts.adaptive.stat === "topgap"
        ? (sorted[0] ?? 0) - (sorted[1] ?? sorted[0] ?? 0)
        : Math.max(...liks) - Math.min(...liks);
    if (opts.adaptive.perTerm) {
      // Per term, so a body scored on twenty parameters is not automatically "decisive" against one
      // scored on six. The term counts differ between candidates; the mean is the honest divisor.
      const meanTerms = ranked.reduce((n, r) => n + r.likelihood.terms, 0) / ranked.length;
      if (meanTerms > 0) spread /= meanTerms;
    }
    const { lo, hi, scale } = opts.adaptive;
    const d = scale > 0 ? lo + (hi - lo) * Math.min(1, spread / scale) : hi;
    for (const r of ranked) {
      r.likelihood.logScore = r.likelihood.logPrior + d * r.likelihood.logLik;
    }
  }

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
