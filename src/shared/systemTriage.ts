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
 *
 * ## The genus-level version was measured and REJECTED (§26.4)
 *
 * An earlier attempt ordered bodies by expected value computed from **genus** co-occurrence, before
 * the species-level model existed. It was built, measured, and refused: it read the system **4 M
 * credits low on average**, because a genus's value is not the value of the species actually on the
 * body and the error does not cancel. Sequencing mattered more than the idea — expected value only
 * became honest once {@link TriageCandidate.probability} was a calibrated *species* probability.
 *
 * If you are tempted to add a cheaper genus-only estimate for bodies the model cannot score: that is
 * the thing that was already tried. Leave such rows unscored and let `coverage` say so.
 */
import type { BodyComputed } from "./types.js";


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
  /** Needed by {@link TriageRisk}: a DSS names the genus, so it only helps when genera differ. */
  genus: string;
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

/**
 * A9's "value at risk" — is this body's number solid, or is it a lottery ticket?
 *
 * Expected value is honest **in aggregate**: the probabilities sum to the biological signal count, so
 * a system's total is a fair expectation. What it cannot tell you is *what you are flying down for*.
 * A body showing 4 M because one 15 %-likely species is worth 25 M is a completely different
 * proposition from a body showing 4 M because four near-certain species are worth 1 M each — and the
 * triage table draws them identically.
 *
 * When most of the value rests on one unlikely candidate, the cheap move is to **map the body
 * first**. A DSS names the genus for the cost of a few probes, and §35's within-genus view then
 * answers the rest — far cheaper than landing, sampling, and finding the 1 M species instead of the
 * 25 M one.
 *
 * **The thresholds are definitions, not tuned parameters.** "Most of the value" means more than half
 * of it; "unlikely" means less likely than not. Neither is swept against the probe, because neither
 * is a claim about the world — they are what the two English words mean. The probability they are
 * applied to is the calibrated one (§32.3), and no new percentage reaches the UI (§18 rule 3).
 *
 * **The advice has to be actionable, which is a third condition.** A DSS names the *genus*. If every
 * candidate on the body is the same genus, mapping costs probes and tells the commander nothing they
 * did not already know — the question was always which *species* of that genus, and §35 answers that
 * after landing, not before. Honest note: measured on the current corpus this condition excludes
 * **none** of the bodies the other two flag, so it is a guard rather than a filter. It stays because
 * the alternative is advice that is true about the risk and useless as an instruction, and nothing
 * about the corpus guarantees the overlap stays empty.
 *
 * So the flag means: *most of this number rests on one unlikely species, and a map would tell you
 * whether it is there.*
 *
 * Measured on 1,091 bodies with a value: it fires on **38 (3.5 %)**, carrying **2.2 %** of the
 * corpus's expected value. Rare enough to mean something when it appears. The shape of a hit, from
 * that run:
 *
 *   Body 10 — 8.5 M expected, **63 % of it resting on Stratum cucumisis at 33 %**, while the
 *   likeliest species on the body is Bacterium cerbrus. Two different genera, so one DSS decides
 *   whether the 8.5 M was real.
 */
export interface TriageRisk {
  /** Expected credits carried by the single largest contributor. */
  topContribution: number;
  /** That contributor's share of the row's expected value, 0-1. Zero when there is no value. */
  concentration: number;
  /**
   * The species carrying that slice — **not** necessarily {@link TriageRow.best}, which is the
   * *likeliest* candidate. The whole point of this flag is that on a risky body they differ.
   */
  topSpecies: string | null;
  /** True when most of the value rests on one unlikely species and a map would settle it. */
  mapFirst: boolean;
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
  /** Whether the number above is solid or a lottery ticket. See {@link TriageRisk}. */
  risk: TriageRisk;
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
  /** The single biggest slice of the expected value — not the same row as `best` (see TriageRisk). */
  let topContribution = 0;
  let topContributor: TriageCandidate | null = null;

  for (const c of body.candidates) {
    const price = c.priceCredits ?? 0;
    totalWeight += 1;
    if (c.probability == null || !Number.isFinite(c.probability)) continue;
    scoredWeight += 1;
    const contribution = c.probability * price * body.multiplier;
    expected += contribution;
    if (contribution > topContribution) {
      topContribution = contribution;
      topContributor = c;
    }
    if (!best || (best.probability ?? -1) < c.probability) best = c;
  }

  const minutes = onSiteMinutes(body.signalCount, timing);
  const concentration = expected > 0 ? topContribution / expected : 0;
  // A DSS names the genus, so it only settles anything when the scored candidates span more than one.
  const scoredGenera = new Set(body.candidates.filter((c) => c.probability != null).map((c) => c.genus));
  return {
    ...body,
    expectedCredits: Math.round(expected),
    coverage: totalWeight > 0 ? scoredWeight / totalWeight : 0,
    onSiteMinutes: minutes,
    creditsPerMinute: minutes > 0 ? expected / minutes : 0,
    best,
    risk: {
      topContribution: Math.round(topContribution),
      concentration,
      topSpecies: topContributor?.displayName ?? null,
      // "Most of it" and "less likely than not" — see TriageRisk. A body the game has already
      // pinned down (§4.3's certainty) has nothing left for a DSS to narrow, and neither does one
      // whose candidates are all the same genus.
      mapFirst:
        !body.certain &&
        scoredGenera.size > 1 &&
        concentration > 0.5 &&
        (topContributor?.probability ?? 0) < 0.5,
    },
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

/**
 * Snapshot bodies → the shape the triage maths takes. Shown candidates only.
 *
 * Lived in the client's "Worth the trip?" modal until that screen was retired; the second screen
 * kept using it, so it moved here rather than leaving a deleted panel as somebody's import path.
 * Both sides of the cycle with `types.ts` are `import type`, so nothing is imported at runtime.
 */
export function triageInputsFromBodies(bodies: BodyComputed[]): TriageBodyInput[] {
  return bodies
    .filter((b) => (b.state.biologicalSignals ?? 0) > 0 || b.matches.length > 0)
    .map((b) => {
      const shown = b.matches.filter((m) => !m.unlikely);
      return {
        bodyKey: b.state.key,
        bodyName: b.tabLabel || b.state.bodyName || b.state.key,
        signalCount: b.state.biologicalSignals ?? null,
        distanceLs: b.mergedScan?.distanceFromArrivalLs ?? null,
        multiplier: (b.exoPayoutRange?.mult ?? 1) as 1 | 5,
        certain: b.genusCertainty?.status === "certain",
        candidates: shown.map((m) => ({
          speciesId: m.entry.id,
          displayName: m.entry.displayName,
          genus: m.entry.genus,
          probability:
            typeof m.presenceProbabilityPercent === "number" && Number.isFinite(m.presenceProbabilityPercent)
              ? m.presenceProbabilityPercent / 100
              : null,
          priceCredits: m.priceCredits ?? null,
        })),
      };
    });
}

/**
 * How far each biological body in this system sits from the arrival star, and how that compares.
 *
 * The replacement for the "Worth the trip?" panel (A2). That panel ranked a system's bodies by
 * expected credits per on-site minute, and the owner's verdict was that it was not implemented as
 * intended — the number it ranked by is an aggregate, and what actually decides whether to go is
 * the flight. The flight is the one leg the journals cannot time ({@link ON_SITE_ONLY}), so the
 * honest form of it is the raw distance the game states, compared against the other bodies worth
 * landing on.
 *
 * Which is a per-planet fact, not a table: it belongs on the screen the commander is already
 * looking at when they decide.
 *
 * Only bodies with biology are ranked — a system's nearest body is rarely the nearest one worth
 * flying to — and only those whose distance the journal actually carries. Equal distances share a
 * rank, because two moons of the same planet are the same trip.
 */
export interface ArrivalTrip {
  /** Light-seconds from the arrival star, or null when no scan has said. */
  distanceLs: number | null;
  /** 1-based position among this system's ranked biological bodies, nearest first. */
  rank: number | null;
  /** How many biological bodies carry a distance to be ranked against. */
  ranked: number;
}

export function arrivalTripRanks(bodies: BodyComputed[]): Map<string, ArrivalTrip> {
  const bio = bodies.filter((b) => (b.state.biologicalSignals ?? 0) > 0 || b.matches.length > 0);
  const withDistance = bio
    .map((b) => ({ key: b.state.key, ls: b.mergedScan?.distanceFromArrivalLs }))
    .filter((r): r is { key: string; ls: number } => typeof r.ls === "number" && Number.isFinite(r.ls))
    .sort((a, b) => a.ls - b.ls);

  const rankByKey = new Map<string, number>();
  let rank = 0;
  let previous: number | null = null;
  withDistance.forEach((r, i) => {
    if (previous == null || r.ls !== previous) rank = i + 1;
    previous = r.ls;
    rankByKey.set(r.key, rank);
  });

  const out = new Map<string, ArrivalTrip>();
  for (const b of bio) {
    const ls = b.mergedScan?.distanceFromArrivalLs;
    const known = typeof ls === "number" && Number.isFinite(ls);
    out.set(b.state.key, {
      distanceLs: known ? ls : null,
      rank: known ? (rankByKey.get(b.state.key) ?? null) : null,
      ranked: withDistance.length,
    });
  }
  return out;
}
