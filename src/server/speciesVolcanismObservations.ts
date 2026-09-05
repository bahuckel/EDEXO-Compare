/**
 * Has the corpus watched this species grow with this volcanism — or with none?
 *
 * The fourth field to ask, after the host star (§27), the planet class (§40) and the temperature
 * (§41), and the one where the codex is furthest from the record in a way that matters:
 *
 *   **Fumerola extremus** — codex needs silicate / iron / rock / rocky. 10 of its 43 bodies (23 %)
 *   are metallic magma, which that list does not admit.
 *
 * Only the *type* claim is overruled here, and that is a measurement rather than a preference. The
 * codex also claims *that* there is volcanism at all, and Bacterium tela makes that look equally
 * wrong — 177 of its 214 observed bodies have none. Overruling it was built and rejected: it found
 * **one** more species and cost **0.96 candidates of ambiguity on every body and 6.6 points of
 * precision**, because "requires volcanism" is doing real work as a gate across many species at
 * once. §42 has the numbers.
 *
 * The comparison is on the type, not the intensity. "Minor Metallic Magma", "Major Metallic Magma"
 * and the journal's "metallic magma volcanism" are one mechanism written three ways — the same
 * vocabulary problem as §27 and §40, in a field where the game itself supplies the adjectives.
 */
import type { SpeciesEntry } from "../shared/types.js";
import { loadExomasteryProfile } from "./exomasteryProfile.js";
import { getProjectRoot } from "./paths.js";

const VOLCANISM_PATH = "body.volcanismType";

/** The key for "this body has no volcanism", shared by both vocabularies. */
export const NO_VOLCANISM = "none";

/**
 * Bodies the corpus needs before it overrules the codex list of volcanism types.
 *
 * Five, not the twenty the planet class and temperature use (§40, §41). Those two overrule a
 * distribution with a distribution; this overrules a fragment list with a count, and the counts are
 * an order of magnitude smaller — Fumerola extremus has 43 observed bodies in total, of which 10 are
 * the metallic magma its codex row omits. At twenty this rescue fires on nothing at all. Swept, with
 * ambiguity and precision flat across the range:
 *
 * | floor | recall | ambiguity |
 * |---|---|---|
 * | 1 | 96.5 % | 7.48 |
 * | 3 | 96.5 % | 7.47 |
 * | **5** | **96.5 %** | **7.46** |
 * | 20 | 96.0 % | 7.45 (rescues nothing) |
 *
 * **Re-swept after the §45 hydration pass grew the corpus by 34 %** and none of the six floors
 * moved: every upward step cost recall and bought nothing on ambiguity. The one exception proves
 * the shape — doubling the planet-class floor to 40 buys 0.12 candidates for **nine species**.
 */
export const MIN_VOLCANISM_OBSERVATIONS = 5;

/**
 * Type without intensity: `Minor Metallic Magma`, `Major Metallic Magma` and
 * `metallic magma volcanism` all become `metallic magma`; anything empty or "no volcanism" becomes
 * {@link NO_VOLCANISM}.
 */
export function volcanismKey(value: string | null | undefined): string {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return NO_VOLCANISM;
  if (raw.includes("no volcanism")) return NO_VOLCANISM;
  return raw
    .replace(/\bvolcanism\b/g, " ")
    .replace(/^\s*(minor|major)\s+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^\s*(minor|major)\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface VolcanismObservation {
  observations: number;
  total: number;
  /** The bucketed key that matched — `none` when the corpus mostly sees this species on quiet ground. */
  key: string;
}

let rootOverride: string | null = null;

/** Test seam — the matcher has no project root to pass down, so it asks {@link getProjectRoot}. */
export function setVolcanismObservationsRootForTests(root: string | null): void {
  rootOverride = root;
}

/**
 * How often this species has been recorded with this volcanism, or null when it has not been often
 * enough to overrule the codex.
 */
export function observedWithVolcanism(
  entry: SpeciesEntry,
  volcanism: string | null | undefined,
  rootArg?: string,
): VolcanismObservation | null {
  const key = volcanismKey(volcanism);
  const root = rootArg ?? rootOverride ?? getProjectRoot();
  const counts = loadExomasteryProfile(root, entry)?.categorical?.[VOLCANISM_PATH];
  if (!counts) return null;

  let observations = 0;
  let total = 0;
  for (const [label, n] of Object.entries(counts)) {
    if (!Number.isFinite(n) || n <= 0) continue;
    total += n;
    if (volcanismKey(label) === key) observations += n;
  }
  if (total <= 0 || observations < MIN_VOLCANISM_OBSERVATIONS) return null;
  return { observations, total, key };
}
