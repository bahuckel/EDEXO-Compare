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

export type CategoricalCounts = Record<string, number>;
/** path → value → count. The shape `ExomasteryProfileV1.categorical` already ships in. */
export type CategoricalTable = Record<string, CategoricalCounts>;

/** Determinism per parameter path, in the range −1 … 1. Higher means the parameter decides more. */
export type ParameterImportance = Record<string, number>;

/**
 * Collapse a value to the bucket the game plausibly keys on.
 *
 * Anything finer is noise that flattens the measurement: 88 spectral classes make a species that
 * only ever grows on F-type stars look undecided. The buckets are deliberately coarse — O B A F G K
 * M L T Y plus N for neutron and D for white dwarf — because that is the resolution at which the
 * question "does star type matter for this species" has an answer.
 */
export function bucketCategoricalValue(path: string, value: string): string {
  const low = path.toLowerCase();
  const v = value.trim();
  if (!v) return "";

  if (low.includes("host_star") || low.includes("spectral") || low.includes("startype")) {
    const t = v.toUpperCase();
    if (t.startsWith("N")) return "N"; // neutron
    if (t.startsWith("D")) return "D"; // white dwarf
    if (/^(TTS|T TAURI)/.test(t)) return "TTS";
    const first = t.charAt(0);
    return "OBAFGKMLTY".includes(first) ? first : "other";
  }

  if (low.includes("atmosphere") && !low.includes("composition")) {
    // "Thin Carbon dioxide", "Hot thin Carbon dioxide" and "Carbon dioxide-rich" are one gas to the
    // question being asked here; pressure is measured separately and far better as a number.
    let t = v.toLowerCase();
    t = t.replace(/^(hot\s+)?(thin|thick)\s+/, "");
    t = t.replace(/-rich$/, "").replace(/\s+atmosphere$/, "");
    return t.trim() || "none";
  }

  if (low.includes("volcanism")) {
    // "Minor rocky magma volcanism" and "Major rocky magma volcanism" are the same mechanism.
    const t = v.toLowerCase().replace(/^(minor|major)\s+/, "");
    return t.trim() || "none";
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
