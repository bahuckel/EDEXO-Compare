/**
 * What planet classes the corpus has actually seen a species growing on.
 *
 * The same rule as §27's host star, one field over, and this time the miss log asked for it. Of the
 * 35 species the commander found where the app did not point at them, **15 were blocked by planet
 * class** — every one of them demoted, not excluded, so the row existed but sat behind "show
 * unlikely" where nobody reads it:
 *
 *   Tussock capillum on a Rocky ice body, five times. The codex row says Rocky body only, and 28 of
 *   the 42 bodies the corpus holds for that species — **67 %** — are Rocky ice.
 *
 * The pattern was already in the matcher's own comment: High metal content is missing from the codex
 * list of almost every Tussock, Osseus and Fungoida, and that is 3-32 % of where they really grow.
 * §6.1 measured the whole effect at 4.14 % of observed bodies rejected, and the answer then was to
 * demote rather than exclude. The log says demotion was not enough.
 *
 * So observation overrules the codex here too: a species the corpus has watched grow on this class
 * keeps its place in the shown list. The reverse is deliberately **not** implemented — a class the
 * corpus has never recorded stays whatever the codex says it is, because the codex list is already a
 * restriction and adding a second one could only cost recall.
 */
import type { SpeciesEntry } from "../shared/types.js";
import { planetClassKey } from "../shared/planetClassKey.js";
import { loadExomasteryProfile } from "./exomasteryProfile.js";
import { getProjectRoot } from "./paths.js";

/** The profile path the feeder writes planet classes to. */
const PLANET_CLASS_PATH = "body.subType";

/**
 * Observations of a class before it can overrule the codex.
 *
 * A single row could be an EDSM mis-classification, and what is being overruled here is one of the
 * five main factors (§11.3) rather than a colour table. Swept through `npm run probe`:
 *
 * | floor | recall | ambiguity |
 * |---|---|---|
 * | 1 | 93.2 % | 7.19 |
 * | 5 | 93.2 % | 7.17 |
 * | **20** | **93.2 %** | **7.09** |
 * | 50 | 91.4 % | 6.96 |
 *
 * Twenty keeps every species the lower floors recover and carries the least ambiguity of the three;
 * at fifty the recall starts falling again. The smallest real case sits comfortably above it —
 * Tussock ignis has 28 High metal content bodies, Tussock capillum 28 Rocky ice.
 *
 * **Re-swept after the §45 hydration pass grew the corpus by 34 %** and none of the six floors
 * moved: every upward step cost recall and bought nothing on ambiguity. The one exception proves
 * the shape — doubling the planet-class floor to 40 buys 0.12 candidates for **nine species**.
 */
export const MIN_CLASS_OBSERVATIONS = 20;

export interface PlanetClassObservations {
  /** Class key → bodies observed. */
  byClass: Record<string, number>;
  total: number;
}

const cache = new Map<string, PlanetClassObservations | null>();

let rootOverride: string | null = null;

/** Test seam — the matcher has no project root to pass down, so it asks {@link getProjectRoot}. */
export function setPlanetClassObservationsRootForTests(root: string | null): void {
  rootOverride = root;
  cache.clear();
}

export function speciesPlanetClassObservations(
  entry: SpeciesEntry,
  rootArg?: string,
): PlanetClassObservations | null {
  const root = rootArg ?? rootOverride ?? getProjectRoot();
  const key = `${root}::${entry.id}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let out: PlanetClassObservations | null = null;
  const counts = loadExomasteryProfile(root, entry)?.categorical?.[PLANET_CLASS_PATH];
  if (counts) {
    const byClass: Record<string, number> = {};
    let total = 0;
    for (const [label, n] of Object.entries(counts)) {
      if (!Number.isFinite(n) || n <= 0) continue;
      const cls = planetClassKey(label);
      if (!cls) continue;
      byClass[cls] = (byClass[cls] ?? 0) + n;
      total += n;
    }
    if (total > 0) out = { byClass, total };
  }
  cache.set(key, out);
  return out;
}

export interface PlanetClassObservation {
  observations: number;
  total: number;
  share: number;
}

/**
 * How often this species has been observed on this planet class, or null when it has not been —
 * or has been too few times to overrule a codex row.
 */
export function observedOnPlanetClass(
  entry: SpeciesEntry,
  planetClass: string | null | undefined,
  root?: string,
): PlanetClassObservation | null {
  const cls = planetClassKey(planetClass);
  if (!cls) return null;
  const obs = speciesPlanetClassObservations(entry, root);
  if (!obs) return null;
  const n = obs.byClass[cls] ?? 0;
  if (n < MIN_CLASS_OBSERVATIONS) return null;
  return { observations: n, total: obs.total, share: n / obs.total };
}
