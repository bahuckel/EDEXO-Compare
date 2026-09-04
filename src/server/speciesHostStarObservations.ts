/**
 * What the corpus has actually seen a species growing under.
 *
 * The genus JSON carries two claims about host stars — a codex fragment list and a colour-variant
 * table — and both are community records rather than measurements. The colour table has no A-type
 * variant for Stratum araneamus, and 48 % of the 21 bodies the corpus holds for that species orbit
 * an A-type star. Left alone, a claim about our own missing artwork demotes a species on the star it
 * most commonly lives under.
 *
 * So observation gets the last word, in both directions:
 *
 *  - **Seen there** — the codex claim is overruled. The species grows there; the gap is ours.
 *  - **Never seen there, on a species whose host star measurably decides where it grows** — the row
 *    is demoted into the unlikely tier. Never removed: absence in 31 bodies is evidence, not proof,
 *    and §6 took every wall out of this matcher.
 *
 * Thin profiles say nothing either way. Below {@link HOST_STAR_MIN_SAMPLES} observations the module
 * declines to answer, and the matcher behaves exactly as it did before — rarity is not
 * unreliability (§15.2).
 */
import type { SpeciesEntry } from "../shared/types.js";
import { hostStarClassKey } from "../shared/hostStarClass.js";
import { loadExomasteryProfile } from "./exomasteryProfile.js";
import { getProjectRoot } from "./paths.js";

/** The profile path the feeder writes host stars to. */
const HOST_STAR_PATH = "exo.host_star_spectral_primary";

/**
 * Observations below which the profile is not asked about host stars.
 *
 * The same floor the per-atmosphere bands use, for the same reason: fourteen bodies are evidence a
 * species grows somewhere and not evidence of where it does not.
 */
export const HOST_STAR_MIN_SAMPLES = 20;

/**
 * How deterministic the host star has to be for its absence to demote a row.
 *
 * Measured determinism against the pooled background, the step 6 quantity. Across 75 species the
 * mean is 0.134 and the distribution is long-tailed: Fonticulua digitos 0.375, Electricae pluma
 * 0.344, Stratum araneamus 0.339, down to Concha renibus at −0.068.
 *
 * Swept through `npm run probe`, with recall held at 90.1 % throughout:
 *
 * | threshold | ambiguity | precision | decidable |
 * |---|---|---|---|
 * | 0.15 | 6.71 | 43.6 % | 404 |
 * | **0.20** | **6.77** | **43.6 %** | **417** |
 * | 0.25 | 6.96 | 42.8 % | 389 |
 * | 0.30 | 7.14 | 41.7 % | 389 |
 *
 * 0.2 sits at the top of the range and takes in the species whose host star genuinely constrains
 * them — the twelve above the line — while leaving the indifferent majority alone.
 */
export const HOST_STAR_MIN_DETERMINISM = 0.2;

export interface HostStarObservations {
  /** Observations behind the distribution. */
  total: number;
  /** Class key → observations, bucketed by {@link hostStarClassKey}. */
  byClass: Record<string, number>;
  /** Measured determinism for the host-star parameter, or null when the profile predates it. */
  determinism: number | null;
}

const cache = new Map<string, HostStarObservations | null>();

/**
 * Test seam: where profiles are read from.
 *
 * The matcher has no project root to pass down — it is handed a scan and a species row — so this
 * module asks {@link getProjectRoot} for one. A test that builds its own species tree needs to say
 * where it put it.
 */
let rootOverride: string | null = null;

export function setHostStarObservationsRootForTests(root: string | null): void {
  rootOverride = root;
  cache.clear();
}

function resolveRoot(root?: string): string {
  return root ?? rootOverride ?? getProjectRoot();
}

export function speciesHostStarObservations(
  entry: SpeciesEntry,
  rootArg?: string,
): HostStarObservations | null {
  const root = resolveRoot(rootArg);
  const key = `${root}::${entry.id}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let out: HostStarObservations | null = null;
  const profile = loadExomasteryProfile(root, entry);
  const counts = profile?.categorical?.[HOST_STAR_PATH];
  if (counts) {
    const byClass: Record<string, number> = {};
    let total = 0;
    for (const [label, n] of Object.entries(counts)) {
      if (!Number.isFinite(n) || n <= 0) continue;
      const cls = hostStarClassKey(label);
      if (!cls) continue;
      byClass[cls] = (byClass[cls] ?? 0) + n;
      total += n;
    }
    const determinism = profile?.parameterImportance?.[HOST_STAR_PATH];
    if (total > 0) {
      out = {
        total,
        byClass,
        determinism: typeof determinism === "number" && Number.isFinite(determinism) ? determinism : null,
      };
    }
  }
  cache.set(key, out);
  return out;
}

/** Test seam — profiles are cached per root, and a test that writes one needs the next read to see it. */
export function clearHostStarObservationsCacheForTests(): void {
  cache.clear();
}

export type HostStarVerdict =
  /** The corpus has too little to say — the matcher should behave as though this module did not exist. */
  | { kind: "unknown" }
  /** Observed on this host class. `share` is that class' share of the species' observations. */
  | { kind: "observed"; share: number; observations: number; total: number }
  /** Barely or never observed on this host class, on a species whose host star measurably matters. */
  | { kind: "never"; total: number; observations: number; classes: string[]; determinism: number };

/**
 * What the corpus says about this species under this host star.
 *
 * `never` is only returned when the profile is thick enough to be worth believing *and* the host
 * star is measurably one of the things deciding where this species grows. A species indifferent to
 * its star — most of them — returns `unknown` however many classes it has never been seen on.
 */
export function hostStarVerdict(
  entry: SpeciesEntry,
  hostStarType: string | null | undefined,
  root?: string,
): HostStarVerdict {
  const cls = hostStarClassKey(hostStarType);
  if (!cls) return { kind: "unknown" };
  const obs = speciesHostStarObservations(entry, root);
  if (!obs || obs.total < HOST_STAR_MIN_SAMPLES) return { kind: "unknown" };

  /**
   * One observation is enough to call a host class somewhere the species grows.
   *
   * Requiring a share instead was measured and rejected: at 5 % it takes recall from 90.1 % to
   * 88.7 %, at 10 % to 87.6 %, for a third of a point of ambiguity each time. Electricae pluma has
   * exactly one M-type body among its 31 and that row keeps it on 138 M-star bodies — which reads
   * like a false positive until you remember the corpus really did see it there once. Recall is the
   * floor (acceptance rule 2), so the single observation wins.
   */
  const seen = obs.byClass[cls] ?? 0;
  if (seen > 0) return { kind: "observed", share: seen / obs.total, observations: seen, total: obs.total };

  const d = obs.determinism;
  if (d == null || d < HOST_STAR_MIN_DETERMINISM) return { kind: "unknown" };
  return {
    kind: "never",
    total: obs.total,
    observations: seen,
    classes: Object.entries(obs.byClass)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k),
    determinism: d,
  };
}
