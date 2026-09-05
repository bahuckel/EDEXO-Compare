/**
 * Has the corpus watched this species grow under this atmosphere?
 *
 * The sixth and last field to get the §27 treatment, and the miss log's final demotion:
 *
 *   **Osseus discus** — codex lists Water. Found on a Methane body. Of its 645 observed bodies,
 *   626 are Thin Water and **14 are Thin Methane**, which the codex row does not name.
 *
 * This is the most cautious of the six rescues, because it overrules the *best* of the codex lists.
 * §6 measured the atmosphere allow-list rejecting only **0.33 %** of observed habitats (103 of
 * 30,803), against the planet-class list's 4.14 %. Fourteen bodies in 645 is 2.2 % of one species —
 * a real tail, not a distribution the row got wrong — so the floor here is not about believing a
 * distribution, it is about ruling out a mislabel or a stray record.
 *
 * The other half of the safety is that this rescue does not stand alone. Osseus discus' methane
 * bodies sit at **80–107 K** while its water bodies sit at **397–451 K**; the temperature gate and
 * the per-atmosphere bands (§24.1) still have to agree before the row is shown. Handing back the
 * atmosphere does not hand back the body.
 *
 * The vocabulary problem is the same as everywhere else (§27, §40, §42): the corpus writes
 * `Thin Water` and `Hot thin Carbon dioxide`, the journal writes `Water` and `CarbonDioxide`, and
 * the pressure adjective is a different question from the composition.
 */
import type { SpeciesEntry } from "../shared/types.js";
import { atmosphereCompositionKey } from "../shared/scanAtmosphereMatch.js";
import { loadExomasteryProfile } from "./exomasteryProfile.js";
import { getProjectRoot } from "./paths.js";

const ATMOSPHERE_PATH = "body.atmosphereType";

/** The key for "this body has no atmosphere", shared by both vocabularies. */
export const NO_ATMOSPHERE = "";

/**
 * Bodies the corpus needs before it overrules a codex atmosphere list.
 *
 * Ten, the same as the gravity rescue (§43) and for the same reason — this counts bodies in a tail
 * rather than reading a distribution, and the tail this exists for holds fourteen. Swept:
 *
 * | floor | recall | ambiguity | precision |
 * |---|---|---|---|
 * | 5 | 97.1 % | 7.91 | 39.4 % |
 * | **10** | **97.1 %** | **7.48** | **42.0 %** |
 * | 20 | 96.9 % | 7.47 | 42.0 % (rescues nothing) |
 * | 50 | 96.9 % | 7.47 | 42.0 % (rescues nothing) |
 *
 * Five is the clearest cliff of any of the six sweeps: the same recall, eighteen more candidates on
 * the labelled bodies and 2.6 points of precision gone. That is what a floor is for.
 *
 * **Re-swept after the §45 hydration pass grew the corpus by 34 %** and none of the six floors
 * moved: every upward step cost recall and bought nothing on ambiguity. The one exception proves
 * the shape — doubling the planet-class floor to 40 buys 0.12 candidates for **nine species**.
 */
export const MIN_ATMOSPHERE_OBSERVATIONS = 10;

/**
 * Composition key for either vocabulary: `Thin Water` and `Water` both become `water`,
 * `Hot thin Carbon dioxide` and `CarbonDioxide` both become `carbondioxide`, and anything meaning
 * vacuum becomes {@link NO_ATMOSPHERE}.
 */
export function atmosphereObservationKey(value: string | null | undefined): string {
  let t = (value ?? "").trim().toLowerCase().replace(/_/g, " ");
  if (!t) return NO_ATMOSPHERE;
  if (t === "none" || t.includes("no atmosphere")) return NO_ATMOSPHERE;
  // The corpus prefixes the pressure and the heat onto the composition; both are other questions.
  let prev = "";
  while (prev !== t) {
    prev = t;
    t = t.replace(/^(hot|thin|thick)\s+/, "").trim();
  }
  return atmosphereCompositionKey(t);
}

export interface AtmosphereObservation {
  observations: number;
  total: number;
  /** The corpus' own label for the largest bucket that matched, for the card. */
  label: string;
}

let rootOverride: string | null = null;

/** Test seam — the matcher has no project root to pass down, so it asks {@link getProjectRoot}. */
export function setAtmosphereObservationsRootForTests(root: string | null): void {
  rootOverride = root;
}

/**
 * How often this species has been recorded under this atmosphere, or null when it has not been
 * often enough to overrule the codex row.
 */
export function observedUnderAtmosphere(
  entry: SpeciesEntry,
  atmosphere: string | null | undefined,
  rootArg?: string,
): AtmosphereObservation | null {
  const key = atmosphereObservationKey(atmosphere);
  const root = rootArg ?? rootOverride ?? getProjectRoot();
  const counts = loadExomasteryProfile(root, entry)?.categorical?.[ATMOSPHERE_PATH];
  if (!counts) return null;

  let observations = 0;
  let total = 0;
  let label = "";
  let best = 0;
  for (const [raw, n] of Object.entries(counts)) {
    if (!Number.isFinite(n) || n <= 0) continue;
    total += n;
    if (atmosphereObservationKey(raw) !== key) continue;
    observations += n;
    if (n > best) {
      best = n;
      label = raw;
    }
  }
  if (total <= 0 || observations < MIN_ATMOSPHERE_OBSERVATIONS) return null;
  return { observations, total, label };
}
