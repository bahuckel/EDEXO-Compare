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
export function onSiteMinutes(signalCount: number | null): number {
  const k = signalCount != null && Number.isFinite(signalCount) && signalCount > 0 ? signalCount : 1;
  return LANDING_MINUTES + k * SAMPLING_MINUTES_PER_GENUS;
}

/**
 * One body's worth, and how much of it rests on candidates the model could score.
 *
 * `coverage` is the honest caveat: a body whose candidates are mostly unscored has an expected value
 * built from the few that were, and the row says so rather than quietly reading low.
 */
export function triageRow(body: TriageBodyInput): TriageRow {
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

  const minutes = onSiteMinutes(body.signalCount);
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
export function triageSystem(bodies: TriageBodyInput[], sort: TriageSort = "value"): TriageRow[] {
  const rows = bodies.map(triageRow);
  const distance = (r: TriageRow) => (r.distanceLs == null ? Number.POSITIVE_INFINITY : r.distanceLs);
  return rows.sort((a, b) => {
    if (sort === "distance") return distance(a) - distance(b) || b.expectedCredits - a.expectedCredits;
    if (sort === "perMinute") return b.creditsPerMinute - a.creditsPerMinute || distance(a) - distance(b);
    return b.expectedCredits - a.expectedCredits || distance(a) - distance(b);
  });
}
