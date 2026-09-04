/**
 * Which genera actually turn up together, and what that says about the genera on this body.
 *
 * The game places one genus per biological signal and never the same genus twice, so a body with
 * `k` signals carries exactly `k` distinct genera. When the matcher offers more candidates than
 * there are signals — 68 % of FSS-only bodies — the commander is told "k of these" and left to
 * guess which k. The corpus answers that: 10,371 bodies whose genus sets are known, of which 8,505
 * carry more than one genus. Fonticulua is never observed beside Frutexa, Stratum, Concha, Clypeus,
 * Cactoida, Tubus or Aleoida; Fungoida beside Osseus is 2.9x more common than chance.
 *
 * The model is deliberately the smallest one that can use that: a weight per candidate subset of
 * size `k`, built from the prevalence of each genus and the pairwise lift between its members, then
 * normalised across every subset the body allows. The per-genus number that comes out is the share
 * of that weight sitting on subsets containing the genus, so the numbers sum to `k` rather than to 1
 * — a body with 3 signals distributes 3 present genera, not one.
 *
 * Two rules it obeys, both from the owner:
 *
 *  - **Never a wall.** Lift is smoothed and clamped, so a pair never observed together lands at the
 *    clamp floor rather than at zero. A candidate the gates admitted stays admitted; this only
 *    orders the list. Absence in a 10,371-body corpus is weak evidence, not proof.
 *  - **Rarity is not unreliability.** A genus the corpus has never recorded takes the median
 *    prevalence and neutral lift instead of a penalty, because a missing row says something about
 *    our data and nothing about the galaxy.
 */

export interface GenusCooccurrenceTable {
  formatVersion: 1;
  builtAt: string;
  /** Bodies carrying at least one genus that maps to a species row in the app. */
  bodies: number;
  /** Keyed by `genusDataDir`, the app's own genus key. */
  genera: Record<string, { label: string; bodies: number }>;
  /** `"<a>|<b>"` with the two keys sorted — bodies carrying both. */
  pairs: Record<string, number>;
  /** How many distinct genera each body carried, as a histogram of set size. */
  setSizes: Record<string, number>;
  /** Corpus species labels with no row in the app's species tree, recorded rather than dropped. */
  unmappedLabels: string[];
}

export interface GenusLikelihood {
  /** `genusDataDir`. */
  genus: string;
  /**
   * Share of the subset weight on subsets containing this genus. Sums to the signal count across
   * the candidate list, so it reads as "expected number of this genus present" — which for a genus
   * is the same as the probability it is present, since the game never repeats one.
   */
  probability: number;
  /** True when the corpus holds no body for this genus and the median prevalence stood in. */
  unmeasured: boolean;
}

export interface GenusLikelihoodResult {
  likelihoods: GenusLikelihood[];
  /** Subsets weighed. 1 means the constraint forced the answer rather than the model choosing it. */
  subsets: number;
  /** True when the candidate list was too large to enumerate and prevalence alone was used. */
  approximated: boolean;
  /** Genera taken as present — DSS hints or on-foot scans — which every subset had to contain. */
  known: string[];
}

/**
 * Pair smoothing, as a share of the corpus.
 *
 * How hard a pair count has to argue before it moves the answer. It is a fraction rather than a body
 * count so it keeps its meaning as the corpus grows, and 0.15 is measured, not chosen: on 37,176
 * held-out cases the value sweeps flat between 0.12 and 0.25 and falls away on both sides.
 *
 * | smoothing | mean rank | top-1 | top-3 |
 * |---|---|---|---|
 * | prevalence only | 2.388 | 51.4 % | 78.5 % |
 * | 0.02 | 2.336 | 49.2 % | 81.4 % |
 * | **0.15** | **2.249** | **55.5 %** | **83.6 %** |
 * | 0.40 | 2.289 | 55.0 % | 82.1 % |
 *
 * Light smoothing is *worse than no pair term at all* on top-1, which is the finding worth keeping:
 * the pair counts that carry real signal are the ones backed by thousands of bodies — Fonticulua
 * never beside Frutexa, Stratum, Concha, Clypeus, Cactoida, Tubus or Aleoida — and the long tail of
 * small counts is noise that outvotes them when it is allowed to. Fourteen bodies do not make a
 * rule; §15.2 said so about species, and it is just as true about pairs.
 */
export const PAIR_SMOOTHING_FRACTION = 0.15;

/**
 * How far a single pair may move the answer, either way.
 *
 * A guard rather than a tuned value: at the smoothing above nothing on this corpus comes near it, so
 * it never binds and the sweep is flat across every clamp tried. It earns its place on the corpus we
 * do not have yet — a small or lopsided one, where a handful of bodies could otherwise hand one pair
 * enough multiplier to overrule the physical match that produced the candidates.
 */
export const LIFT_CLAMP = 4;

/**
 * Subsets we are willing to enumerate.
 *
 * C(n, k) peaks in the middle, and the observed worst case is 14 candidate genera against 7 signals
 * — 3,432 subsets, well inside this. The cap exists so an unexpected list cannot stall a snapshot
 * build; past it the pair term is dropped and prevalence alone is reported.
 */
export const SUBSET_CAP = 200_000;

/**
 * How many genera have to be known before the pair term is allowed to speak.
 *
 * Measured, and it is the finding that decides what this model is worth. Hiding one genus of a body
 * and asking the model to name it, over 37,176 held-out cases:
 *
 * | genera already known | prevalence alone | with pairs |
 * |---|---|---|
 * | 1 | top-1 40.4 % | 40.4 % |
 * | 3 | 58.6 % | 56.6 % |
 * | 4 | 55.6 % | 54.8 % |
 * | **5** | 45.2 % | **52.6 %** |
 * | 6 | 45.2 % | **55.2 %** |
 * | 7 | 42.7 % | **60.5 %** |
 *
 * Pairwise evidence accumulates: one known genus constrains almost nothing, and it takes five before
 * the constraint beats the simple fact that some genera are common and some are not. Below the
 * threshold the pair term is not merely useless, it is slightly harmful — so it is switched off
 * rather than left on for the look of the thing.
 *
 * The commander rarely reaches this state before landing, because DSS reveals every genus at once.
 * It is reached on a body sampled on foot without mapping it, and by anything downstream that
 * narrows the set. That is a narrow use, and it is the one the measurement supports.
 */
export const PAIR_TERM_MIN_KNOWN = 5;

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** Prevalence among bodies carrying biology, with the median standing in for a genus never recorded. */
function prevalences(table: GenusCooccurrenceTable, candidates: string[]): Map<string, number> {
  const known = Object.values(table.genera)
    .map((g) => g.bodies / table.bodies)
    .sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)]! : 0.1;
  const out = new Map<string, number>();
  for (const g of candidates) {
    const row = table.genera[g];
    out.set(g, row && row.bodies > 0 ? row.bodies / table.bodies : median);
  }
  return out;
}

/**
 * Observed co-occurrence over chance, smoothed and clamped.
 *
 * Chance here means "if the two genera landed on bodies independently", which is the null the
 * question is asking about: given that this body carries biology at all, does knowing one genus is
 * present make the other more or less likely.
 */
export function pairLift(
  table: GenusCooccurrenceTable,
  a: string,
  b: string,
  smoothing: number = PAIR_SMOOTHING_FRACTION * table.bodies,
  clamp: number = LIFT_CLAMP,
): number {
  const ra = table.genera[a];
  const rb = table.genera[b];
  if (!ra || !rb || table.bodies <= 0) return 1;
  const expected = (ra.bodies * rb.bodies) / table.bodies;
  const observed = table.pairs[pairKey(a, b)] ?? 0;
  const lift = (observed + smoothing) / (expected + smoothing);
  return Math.max(1 / clamp, Math.min(clamp, lift));
}

export interface GenusLikelihoodOptions {
  /** Off to weigh every genus equally — the null the probe measures the prevalence term against. */
  usePrevalence?: boolean;
  /** Off to drop the co-occurrence term — the null the probe measures the pair term against. */
  usePairs?: boolean;
  /**
   * Probe seam: sweep the smoothing rather than guess it, in bodies. Defaults to
   * {@link PAIR_SMOOTHING_FRACTION} of the corpus.
   */
  pairSmoothing?: number;
  /** Probe seam: sweep the clamp rather than guess it. Defaults to {@link LIFT_CLAMP}. */
  liftClamp?: number;
}

/**
 * How likely each candidate genus is to be one of the `k` actually present.
 *
 * Returns null when the question does not arise: no signal count, no candidates, or fewer candidates
 * than signals — which is a data defect the certainty line already reports, not something to rank.
 */
export function genusLikelihoods(
  table: GenusCooccurrenceTable,
  candidates: string[],
  signalCount: number,
  known: string[] = [],
  options: GenusLikelihoodOptions = {},
): GenusLikelihoodResult | null {
  const usePrevalence = options.usePrevalence !== false;
  const cands = [...new Set(candidates)].sort();
  const k = Math.trunc(signalCount);
  if (cands.length === 0 || k <= 0 || cands.length < k) return null;

  // A genus already seen on this body is present, whatever the corpus says about its company.
  const fixed = [...new Set(known)].filter((g) => cands.includes(g));
  if (fixed.length > k) return null;

  // Enough of the body known for the pair term to have earned its place — see PAIR_TERM_MIN_KNOWN.
  const usePairs = options.usePairs ?? fixed.length >= PAIR_TERM_MIN_KNOWN;

  const p = usePrevalence ? prevalences(table, cands) : new Map<string, number>(cands.map((g) => [g, 1]));
  const free = cands.filter((g) => !fixed.includes(g));
  const need = k - fixed.length;

  if (choose(free.length, need) > SUBSET_CAP) {
    const total = free.reduce((s, g) => s + p.get(g)!, 0);
    return {
      likelihoods: cands.map((g) => ({
        genus: g,
        probability: fixed.includes(g) ? 1 : total > 0 ? (p.get(g)! / total) * need : 0,
        unmeasured: !table.genera[g],
      })),
      subsets: 0,
      approximated: true,
      known: fixed,
    };
  }

  const weightIn = new Map<string, number>(cands.map((g) => [g, 0]));
  let totalWeight = 0;
  let subsets = 0;

  const pick: string[] = [];
  const walk = (start: number): void => {
    if (pick.length === need) {
      const members = [...fixed, ...pick];
      let w = 1;
      for (const g of members) w *= p.get(g)!;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          if (usePairs) {
            w *= pairLift(
              table,
              members[i]!,
              members[j]!,
              options.pairSmoothing ?? PAIR_SMOOTHING_FRACTION * table.bodies,
              options.liftClamp ?? LIFT_CLAMP,
            );
          }
        }
      }
      totalWeight += w;
      subsets++;
      for (const g of members) weightIn.set(g, weightIn.get(g)! + w);
      return;
    }
    for (let i = start; i < free.length; i++) {
      pick.push(free[i]!);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);

  if (totalWeight <= 0 || subsets === 0) return null;

  return {
    likelihoods: cands
      .map((g) => ({
        genus: g,
        probability: weightIn.get(g)! / totalWeight,
        unmeasured: !table.genera[g],
      }))
      .sort((a, b) => b.probability - a.probability || a.genus.localeCompare(b.genus)),
    subsets,
    approximated: false,
    known: fixed,
  };
}
