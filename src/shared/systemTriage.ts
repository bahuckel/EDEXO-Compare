/**
 * Which body in this system is worth the trip — B1, the screen the app did not have.
 *
 * Everything above this in the queue existed to make one number trustworthy: the chance a species is
 * on a body. With that calibrated (§32.3), a body's worth is arithmetic:
 *
 *   expected value = Σ over the candidates   P(present) × list price × first-footfall multiplier
 *
 * The probabilities already sum to the biological signal count, so this is the value of sampling
 * everything down there, not the value of one lucky guess.
 *
 * **Time is measured where it could be measured, and left out where it could not.** From 244
 * journals: approach and landing take a median 1.2 minutes (299 landings, p25 0.9, p75 1.8), and
 * sampling one genus takes 2.5 minutes (264 runs, p25 1.9, p75 4.2). Supercruise is not here, and
 * that is deliberate — see {@link ON_SITE_ONLY}.
 */

/**
 * Median minutes from dropping out of supercruise to touchdown. Measured, 299 landings.
 */
export const LANDING_MINUTES = 1.2;

/**
 * Median minutes to take three samples of one genus, first `ScanOrganic` to `Analyse`.
 * Measured, 264 runs.
 */
export const SAMPLING_MINUTES_PER_GENUS = 2.5;

/**
 * Why there is no supercruise term.
 *
 * B2 asked for value per minute including the flight, and the journal cannot supply it. Timing
 * `SupercruiseEntry` to `SupercruiseExit` measures the commander honking, running the FSS and
 * deciding where to go as much as it measures flying: the medians per distance band come out 3.0,
 * 9.4, 3.4, 3.5, 20.2 and 10.3 minutes going *outwards*, with quartiles from 1.2 to 19. There is no
 * distance signal in it to fit.
 *
 * So the minutes here are on-site minutes only, and distance is reported beside them as the raw
 * light-seconds the game states. A number the commander can weigh beats one this data cannot support.
 */
export const ON_SITE_ONLY = true;

/**
 * This commander's own timing, measured from their journals (B5).
 *
 * B5 asked for configurable thresholds. The one number on this screen that genuinely varies between
 * commanders is time — somebody who flies an Anaconda and takes their time is not somebody in a
 * Mandalay who does not — and the app can measure it instead of asking. The constants above are the
 * fallback for a commander with too little history to measure, not a default anyone has to override.
 */
export interface TriageTiming {
  landingMinutes: number;
  samplingMinutesPerGenus: number;
  /** Legs behind each median, so the UI can say whose numbers these are. */
  landings: number;
  runs: number;
}

/**
 * Legs needed before a commander's own median replaces the shipped one.
 *
 * Ten is enough for a median to be a median rather than an anecdote, and low enough that a commander
 * two evenings into exobiology is already being measured rather than assumed.
 */
export const MIN_TIMING_SAMPLES = 10;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/**
 * Medians from the raw legs, or null when there are too few of either to be worth believing.
 *
 * All-or-nothing on purpose: a screen that mixes this commander's landing time with a stranger's
 * sampling time is harder to reason about than one that says plainly whose numbers it is using.
 */
export function timingFromSamples(landing: number[], sampling: number[]): TriageTiming | null {
  const l = landing.filter((x) => Number.isFinite(x) && x > 0);
  const s = sampling.filter((x) => Number.isFinite(x) && x > 0);
  if (l.length < MIN_TIMING_SAMPLES || s.length < MIN_TIMING_SAMPLES) return null;
  return {
    landingMinutes: median(l),
    samplingMinutesPerGenus: median(s),
    landings: l.length,
    runs: s.length,
  };
}

export interface TriageCandidate {
  speciesId: string;
  displayName: string;
  /** Calibrated chance this species is on the body, 0-1. Null when the model had no opinion. */
  probability: number | null;
  /** List price before the first-footfall multiplier. */
  priceCredits: number | null;
}

export interface TriageBodyInput {
  bodyKey: string;
  bodyName: string;
  /** `FSSBodySignals` biological count, or null when the game has not said. */
  signalCount: number | null;
  /** Distance from the arrival star, light-seconds. */
  distanceLs: number | null;
  /** 5 when this commander gets the first-footfall bonus here, else 1. */
  multiplier: 1 | 5;
  candidates: TriageCandidate[];
  /** True when every candidate genus is present — the signal-count certainty of §4.3. */
  certain: boolean;
}

export interface TriageRow extends TriageBodyInput {
  /** Σ P(present) × price × multiplier, in credits. */
  expectedCredits: number;
  /** The share of the expected value the model could actually account for, 0-1. */
  coverage: number;
  /** Landing plus one sampling run per signal. Supercruise excluded — see {@link ON_SITE_ONLY}. */
  onSiteMinutes: number;
  /** Expected credits per on-site minute. */
  creditsPerMinute: number;
  /** The likeliest candidate, for the one-line "what is down there". */
  best: TriageCandidate | null;
}

/**
 * On-site cost: one landing, plus one sampling run per genus the game says is down there.
 *
 * Without a signal count the body still costs a landing and at least one run, which is the floor
 * rather than a guess at how many genera are waiting.
 */
export function onSiteMinutes(signalCount: number | null, timing?: TriageTiming | null): number {
  const k = signalCount != null && Number.isFinite(signalCount) && signalCount > 0 ? signalCount : 1;
  const landing = timing?.landingMinutes ?? LANDING_MINUTES;
  const sampling = timing?.samplingMinutesPerGenus ?? SAMPLING_MINUTES_PER_GENUS;
  return landing + k * sampling;
}

/**
 * One body's worth, and how much of it rests on candidates the model could score.
 *
 * `coverage` is the honest caveat: a body whose candidates are mostly unscored has an expected value
 * built from the few that were, and the row says so rather than quietly reading low.
 */
export function triageRow(body: TriageBodyInput, timing?: TriageTiming | null): TriageRow {
  let expected = 0;
  let scoredWeight = 0;
  let totalWeight = 0;
  let best: TriageCandidate | null = null;

  for (const c of body.candidates) {
    const price = c.priceCredits ?? 0;
    totalWeight += 1;
    if (c.probability == null || !Number.isFinite(c.probability)) continue;
    scoredWeight += 1;
    expected += c.probability * price * body.multiplier;
    if (!best || (best.probability ?? -1) < c.probability) best = c;
  }

  const minutes = onSiteMinutes(body.signalCount, timing);
  return {
    ...body,
    expectedCredits: Math.round(expected),
    coverage: totalWeight > 0 ? scoredWeight / totalWeight : 0,
    onSiteMinutes: minutes,
    creditsPerMinute: minutes > 0 ? expected / minutes : 0,
    best,
  };
}

export type TriageSort = "value" | "perMinute" | "distance";

/**
 * The system, ordered.
 *
 * Ties break on distance, because between two bodies worth the same the near one is the answer, and
 * a body with no distance reading sorts last rather than first — an unknown is not a zero.
 */
export function triageSystem(
  bodies: TriageBodyInput[],
  sort: TriageSort = "value",
  timing?: TriageTiming | null,
): TriageRow[] {
  const rows = bodies.map((b) => triageRow(b, timing));
  const distance = (r: TriageRow) => (r.distanceLs == null ? Number.POSITIVE_INFINITY : r.distanceLs);
  return rows.sort((a, b) => {
    if (sort === "distance") return distance(a) - distance(b) || b.expectedCredits - a.expectedCredits;
    if (sort === "perMinute") return b.creditsPerMinute - a.creditsPerMinute || distance(a) - distance(b);
    return b.expectedCredits - a.expectedCredits || distance(a) - distance(b);
  });
}

/**
 * Each row's share of its own genus — B3's number.
 *
 * The body's posterior answers "which species is on this body". Once a DSS names the genus, the
 * question shrinks to "which species *of that genus*", and the answer is the same posterior
 * normalised inside the genus. Measured on 447 rows where the commander sampled the genus: rows
 * called 90-100 % came in at 95.9 %, 0-10 % at 8.7 %, mean squared gap 0.0026.
 *
 * A genus whose rows all scored zero gets nulls rather than an even split — no evidence is not the
 * same as evidence of a tie.
 */
export function genusShares<T extends { genus: string; probability: number }>(
  rows: T[],
): Map<T, number | null> {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.genus, (totals.get(r.genus) ?? 0) + r.probability);
  const out = new Map<T, number | null>();
  for (const r of rows) {
    const total = totals.get(r.genus) ?? 0;
    out.set(r, total > 0 ? r.probability / total : null);
  }
  return out;
}
