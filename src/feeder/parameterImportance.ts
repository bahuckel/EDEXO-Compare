/**
 * How much each parameter actually decides where a species grows — measured, never declared.
 *
 * The owner's rule, in his words: *"if 100 % of all scanned plants match only 1–2 star types, that
 * is a very deterministic outcome — star is considered important **automatically**. We base our
 * findings on math. We don't need to know what the rules are; we use data to determine what rules
 * are in place in the game engine itself."*
 *
 * So: concentration. A parameter is important for a species when that species' observed values pile
 * up on a few buckets, and unimportant when they spread. Entropy measures exactly that.
 *
 * Two corrections, both found by running it rather than by reasoning about it:
 *
 * **1. Measure against the background, not against zero.** Volcanism scores 0.969 and terraforming
 * state 0.977 on raw concentration — apparently the two most decisive parameters in the corpus. They
 * are nothing of the kind: ~97 % of all bodies are "No volcanism" and "Not terraformable", so every
 * species looks concentrated because the galaxy is. Scoring against the pooled distribution of every
 * body with biology removes that, and gives negatives their meaning for free — a species spread
 * *wider* than the background is one this parameter provably does not constrain, which is §11.1's
 * "push it to very low priority" derived instead of declared.
 *
 * **2. Bucket to what the game keys on.** Star type scored a misleading 0.275 because the corpus
 * holds 88 distinct spectral classes (F2, F6, A6…). The engine keys on the type, not the subclass.
 * See {@link bucketCategoricalValue}.
 *
 * What comes out, unprompted: atmosphere type and planet class rank at the top — the owner's own
 * main factors, confirmed rather than assumed — and tidal lock falls to the bottom.
 */

import { hostStarClassKey } from "../shared/hostStarClass.js";

export type CategoricalCounts = Record<string, number>;
/** path → value → count. The shape `ExomasteryProfileV1.categorical` already ships in. */
export type CategoricalTable = Record<string, CategoricalCounts>;

/** Determinism per parameter path, in the range −1 … 1. Higher means the parameter decides more. */
export type ParameterImportance = Record<string, number>;

/**
 * What a body with no volcanism is called, on both sides of the comparison.
 *
 * The corpus already writes this exact label — 706 of Bacterium tela's 833 bodies carry it — so a
 * scan reporting an empty `Volcanism` says the same word rather than saying nothing.
 * {@link bucketCategoricalValue} folds it onto `none`.
 */
export const NO_VOLCANISM = "No volcanism";

/**
 * Collapse a value to the bucket the game plausibly keys on.
 *
 * Anything finer is noise that flattens the measurement: 88 spectral classes make a species that
 * only ever grows on F-type stars look undecided. The buckets are deliberately coarse — O B A F G K
 * M L T Y plus N for neutron and D for white dwarf — because that is the resolution at which the
 * question "does star type matter for this species" has an answer.
 */
/**
 * Collapse a value to the bucket the game plausibly keys on.
 *
 * Anything finer is noise that flattens the measurement: 88 spectral classes make a species that
 * only ever grows on F-type stars look undecided. The buckets are deliberately coarse — O B A F G K
 * M L T Y plus N for neutron and D for white dwarf — because that is the resolution at which the
 * question "does star type matter for this species" has an answer.
 *
 * ### Both sides must land on the same token, and for a long time three fields did not
 *
 * This function is called twice for every comparison: once on what the journal wrote and once on
 * what the corpus stored, and the two sources have never spelled anything the same way. Measured
 * 2026-09-21, eight values could never match:
 *
 * ```
 *   journal                      corpus                       before
 *   High metal content body      High metal content world     never matched
 *   Rocky ice body               Rocky Ice world              never matched
 *   Metal rich body              Metal-rich body              never matched
 *   CarbonDioxide                Thin Carbon dioxide          never matched
 *   SulphurDioxide               Thin Sulphur dioxide         never matched
 *   NeonRich / ArgonRich / …     Thin Neon-rich               never matched
 *   "" (a quiet body)            No volcanism                 never matched
 * ```
 *
 * Single-word gases matched and multi-word ones did not; `Rocky` and `Icy` matched and the other
 * three classes did not, **High metal content among them, the most common bio class of all**. This is
 * §42's volcanism bug in three more places, and it is worse than a silent term: `logSmoothed(0,
 * total, …)` scales with the species' own sample count, so a term that never matches is a penalty
 * **proportional to how much corpus data the species has**. On an HMC body Stratum tectonicas scored
 * −8.97 on its own home class against a thinner-sampled rival's −7.09.
 *
 * So every branch now squashes to letters and digits before comparing, and the nouns and suffixes
 * that only one side writes — `world` against `body`, `-rich` against `Rich` — come off. The fold is
 * pinned in `tests/parameterImportance.test.ts` from both directions: the pairs that must meet, and
 * the pairs that must stay apart.
 */
export function bucketCategoricalValue(path: string, value: string): string {
  const low = path.toLowerCase();
  const v = value.trim();
  const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");

  if (low.includes("volcanism")) {
    /*
      "Minor rocky magma volcanism" and "Major rocky magma volcanism" are the same mechanism.

      The two sides also spell it differently and always have: a journal says
      `minor nitrogen magma volcanism` and the corpus profile says `Minor Nitrogen Magma`. Stripping
      only the intensity left `nitrogen magma volcanism` against `nitrogen magma`, so the buckets
      never once matched and the volcanism term contributed nothing to any posterior, on any body.

      An empty `Volcanism` is the journal's way of writing "No volcanism" and belongs on `none` with
      it — it used to fall out on the empty-string guard above this branch and match nothing.
    */
    if (!v) return "none";
    let t = v.toLowerCase().replace(/^(minor|major)\s+/, "");
    t = t.replace(/\s*volcanism\s*$/, "").trim();
    if (!t || t === "no" || t === "none") return "none";
    return t;
  }

  if (!v) return "";

  if (low.includes("host_star") || low.includes("spectral") || low.includes("startype")) {
    // EDSM spells the exotic hosts out — "White Dwarf (DA) Star", "Black Hole" — and reading the
    // first letter put every white dwarf in "other" and every black hole among the B-type stars.
    return hostStarClassKey(v) ?? "other";
  }

  if (low.includes("subtype") || low.includes("planetclass")) {
    // The journal says "High metal content body", the corpus "High metal content world"; one writes
    // "Metal rich", the other "Metal-rich". Same rock, and the trailing noun carries no information.
    return squash(v).replace(/(world|body)$/, "");
  }

  if (low.includes("atmosphere") && !low.includes("composition")) {
    // "Thin Carbon dioxide", "Hot thin Carbon dioxide", "Carbon dioxide-rich" and the journal's
    // "CarbonDioxide" are one gas to the question being asked here; pressure is measured separately
    // and far better as a number. `-rich` and the journal's glued `Rich` both come off, as the
    // corpus spelling's already did.
    let t = v.toLowerCase().replace(/^(hot\s+)?(thin|thick)\s+/, "");
    t = t.replace(/\s+atmosphere$/, "");
    return squash(t).replace(/rich$/, "") || "none";
  }

  return v;
}

export function bucketCounts(path: string, counts: CategoricalCounts): CategoricalCounts {
  const out: CategoricalCounts = {};
  for (const [value, n] of Object.entries(counts)) {
    if (!(n > 0)) continue;
    const key = bucketCategoricalValue(path, value);
    if (!key) continue;
    out[key] = (out[key] ?? 0) + n;
  }
  return out;
}

/** Shannon entropy in nats. 0 when every observation shares a value. */
export function entropy(counts: CategoricalCounts): number {
  const values = Object.values(counts).filter((n) => n > 0);
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0 || values.length <= 1) return 0;
  let h = 0;
  for (const n of values) {
    const p = n / total;
    h -= p * Math.log(p);
  }
  return h;
}

/**
 * How much more concentrated this species is than the galaxy, on this parameter.
 *
 * `(H(background) − H(species)) / log(buckets)` — how much of the uncertainty *available* in this
 * parameter is removed by knowing the species. Positive when the species is tighter than the galaxy,
 * zero when it is spread the same way, negative when it is spread wider: §11.1's "push it back to a
 * very low priority", arrived at by arithmetic rather than by a list.
 *
 * **Normalised by the maximum possible entropy, not by the background's own.** Dividing by `H(q)` is
 * the obvious form and it is wrong in the same direction the raw measure was: when the background is
 * itself concentrated, `H(q)` is tiny and every species scores near 1. Terraforming state is the
 * case that exposes it — 97 % of bodies are "Not terraformable", so `1 − H(p)/H(q)` ranked it 0.819,
 * second only to atmosphere, for a parameter that tells you almost nothing. Against `log(K)` it
 * falls to where it belongs, because a background with little entropy has little to give.
 *
 * Null when the parameter has one bucket in the whole corpus — then it cannot distinguish anything.
 */
export function determinismVsBackground(
  species: CategoricalCounts,
  background: CategoricalCounts,
): number | null {
  const buckets = Object.values(background).filter((n) => n > 0).length;
  if (buckets <= 1) return null;
  const maxEntropy = Math.log(buckets);
  const d = (entropy(background) - entropy(species)) / maxEntropy;
  return Math.max(-1, Math.min(1, d));
}

/** Pool every species' observations into one distribution per parameter — the background. */
export function poolBackground(tables: (CategoricalTable | undefined)[]): CategoricalTable {
  const out: CategoricalTable = {};
  for (const table of tables) {
    if (!table) continue;
    for (const [path, counts] of Object.entries(table)) {
      const bucketed = bucketCounts(path, counts);
      const acc = (out[path] ??= {});
      for (const [k, n] of Object.entries(bucketed)) acc[k] = (acc[k] ?? 0) + n;
    }
  }
  return out;
}

/**
 * Determinism for one species against the pooled background.
 *
 * A species with fewer observations than {@link MIN_SAMPLES_FOR_IMPORTANCE} is left out entirely
 * rather than scored badly: three sightings on one atmosphere is not evidence that the atmosphere
 * decides anything, and the consumer falls back to its default weighting. Rarity is not
 * unreliability — a thin profile may still *support* a match, it just may not tell us what matters.
 */
export const MIN_SAMPLES_FOR_IMPORTANCE = 20;

export function buildParameterImportance(
  categorical: CategoricalTable | undefined,
  background: CategoricalTable,
): ParameterImportance | undefined {
  if (!categorical) return undefined;
  const out: ParameterImportance = {};
  for (const [path, counts] of Object.entries(categorical)) {
    const bucketed = bucketCounts(path, counts);
    const n = Object.values(bucketed).reduce((a, b) => a + b, 0);
    if (n < MIN_SAMPLES_FOR_IMPORTANCE) continue;
    const bg = background[path];
    if (!bg) continue;
    const d = determinismVsBackground(bucketed, bg);
    if (d == null) continue;
    out[path] = Math.round(d * 1000) / 1000;
  }
  return Object.keys(out).length ? out : undefined;
}

// ---------------------------------------------------------------------------------------------
// Numeric parameters
// ---------------------------------------------------------------------------------------------

/**
 * Bins for a numeric parameter, taken as quantiles of the pooled background.
 *
 * Fixed-width bins would measure the shape of the galaxy rather than the shape of the species: half
 * of them would be empty for a parameter like surface pressure that spans four orders of magnitude.
 * Quantile bins make the background *uniform by construction*, which does two useful things — the
 * measure below reduces to `1 − H(species)/log(k)`, and it lands numerics on exactly the same scale
 * as the categorical measure, which is what lets the two be compared at all.
 */
export type NumericBins = number[];

export const NUMERIC_BIN_COUNT = 10;

export function quantileBins(values: number[], k = NUMERIC_BIN_COUNT): NumericBins {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length < k) return [];
  const edges: number[] = [];
  for (let i = 1; i < k; i++) {
    const idx = Math.min(clean.length - 1, Math.floor((i / k) * clean.length));
    edges.push(clean[idx]!);
  }
  // Ties collapse bins; a parameter whose background is mostly one value cannot be measured this way.
  const distinct = [...new Set(edges)];
  return distinct.length === edges.length ? edges : [];
}

export function binIndex(edges: NumericBins, v: number): number {
  let i = 0;
  while (i < edges.length && v > edges[i]!) i++;
  return i;
}

/**
 * Determinism for a numeric parameter, on the same scale as {@link determinismVsBackground}.
 *
 * Because the bins are background quantiles the background is uniform, so this is exactly "how much
 * of the available uncertainty does knowing the species remove". Null when the corpus could not
 * produce usable bins, or the species has too few readings for its spread to mean anything.
 */
export function numericDeterminism(values: number[], edges: NumericBins): number | null {
  if (edges.length === 0) return null;
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < MIN_SAMPLES_FOR_IMPORTANCE) return null;
  const counts: CategoricalCounts = {};
  for (const v of clean) {
    const b = String(binIndex(edges, v));
    counts[b] = (counts[b] ?? 0) + 1;
  }
  const maxEntropy = Math.log(edges.length + 1);
  const d = (maxEntropy - entropy(counts)) / maxEntropy;
  return Math.max(-1, Math.min(1, d));
}
