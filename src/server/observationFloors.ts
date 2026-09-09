/**
 * How much corpus evidence it takes before the observed data overrules the codex.
 *
 * Each dimension carries its own floor, and each is documented where it is declared, with the sweep
 * that chose it. They are grouped here only so a sweep can move one without hand-editing constants
 * in five files — which is how a sweep gets a wrong answer: one edit missed, one run mislabelled.
 *
 * `EDEXO_FLOOR_<NAME>` overrides a floor for one process. It exists for `scripts/floor-sweep.ts` and
 * is not a supported setting: the shipped numbers are the ones measured against this corpus, and a
 * commander who guesses at them will quietly get worse predictions with nothing to say so. A bad
 * value is ignored rather than obeyed, because a typo silently disabling a gate is worse than a
 * floor that did not move.
 */

/** Reads `EDEXO_FLOOR_<name>`, falling back to the measured default. */
export function observationFloor(name: string, fallback: number): number {
  const raw = process.env[`EDEXO_FLOOR_${name}`];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  // Non-negative integers only. A floor of 0 is meaningful — it means "always trust the corpus" —
  // so it must survive, which rules out the usual `|| fallback`.
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    console.warn(
      `ED Exo Compare — ignoring EDEXO_FLOOR_${name}="${raw}"; want a non-negative integer. Using ${fallback}.`,
    );
    return fallback;
  }
  return n;
}
