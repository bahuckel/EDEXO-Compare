/**
 * The conditions that are about a *different* body in the same system.
 *
 * Two genera spawn on what else the system holds rather than on anything about the body under the
 * cursor. Amphora plant wants an Earth-like world, an ammonia world, a water giant, or a gas giant
 * with water- or ammonia-based life; the Brain Trees want an Earth-like world or a gas giant with
 * water-based life. Both rows have been in `data/species/*_new.json` since the tree was written, and
 * until now both raised `predictionUnsupported` — the app read the condition, admitted it could not
 * answer it, and listed the species without predicting it.
 *
 * It can answer it. The commander's merged exploration scans hold every body the FSS has found in the
 * system, so the question is a set membership test. The reason it waited this long was
 * `speciesTreeLoader`'s note — *"half a check is not a check"* — which is right about a check that
 * cannot see the system and wrong once it can.
 *
 * ## Why this demotes rather than excludes
 *
 * The lists here are transcribed community knowledge, and a list that is one entry short turns a
 * 3 M credit find into a row the commander never sees. Demotion costs a tier and keeps the row
 * reachable; exclusion costs the body. The same reasoning as the host-star gates, and the same shape.
 *
 * ## Why an unscanned system is not a failure
 *
 * "No Earth-like world in this system" and "no Earth-like world found yet" are different facts and
 * only the first one is evidence. The gate reports `unresolved` until the FSS has finished the
 * system — `FSSAllBodiesFound`, which the store tracks per system — because a half-honked system is
 * exactly where a commander is deciding whether to keep scanning.
 */

/** What the species rows say, in their own spelling. */
export type SystemBodyRequirement = readonly string[];

/**
 * Journal `PlanetClass` spellings for the classes the species rows name.
 *
 * The rows are written in codex English ("Ammoniac World", "Gas Giant with water-based life") and the
 * journal writes its own ("Ammonia world", "Gas giant with water based life"). Comparing the two as
 * free text is the §27 mistake; both sides go through {@link systemBodyClassKey} instead.
 */
const REQUIREMENT_SYNONYMS: Record<string, string[]> = {
  "earth-like world": ["earthlikebody", "earthlikeworld"],
  "earthlike world": ["earthlikebody", "earthlikeworld"],
  "ammoniac world": ["ammoniaworld", "ammoniacworld"],
  "ammonia world": ["ammoniaworld", "ammoniacworld"],
  "water giant": ["watergiant"],
  "water world": ["waterworld"],
  "gas giant with water-based life": ["gasgiantwithwaterbasedlife"],
  "gas giant with ammonia-based life": ["gasgiantwithammoniabasedlife"],
};

/** Flatten a class name from either side to one comparable token. */
export function systemBodyClassKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/** Every journal-side key a requirement entry accepts. */
export function keysForRequirement(entry: string): string[] {
  const direct = systemBodyClassKey(entry);
  const synonyms = REQUIREMENT_SYNONYMS[entry.trim().toLowerCase()] ?? [];
  return [...new Set([direct, ...synonyms])];
}

/**
 * The Brain Trees' requirement, which their rows carry as a bare `requires_system_bodies: true`.
 *
 * The genus file spells it out one level up, in `meta.general.system_requirements`: *"Presence of
 * Earth-Like World OR Gas Giant with water-based life (for most variants)"*. "Most variants" is why
 * this demotes rather than excludes, and why Brain Tree Roseum — whose row says
 * `requires_system_bodies: false` — is left alone by the loader.
 */
export const BRAIN_TREE_SYSTEM_REQUIREMENT: SystemBodyRequirement = [
  "Earth-Like World",
  "Gas Giant with water-based life",
];

export type SystemBodyVerdict =
  | { kind: "pass"; matched: string }
  | { kind: "fail"; wanted: readonly string[] }
  | { kind: "unresolved"; why: "no-scans" | "incomplete" };

/**
 * Does this system hold one of the bodies the species needs?
 *
 * @param wanted      the species' requirement, in its own spelling
 * @param classes     journal `PlanetClass` of every other body known in the system
 * @param listComplete whether the FSS has finished the system, so an absence means something
 */
export function evaluateSystemBodyGate(
  wanted: readonly string[] | null | undefined,
  classes: readonly string[] | null | undefined,
  listComplete: boolean,
): SystemBodyVerdict | null {
  if (!wanted || wanted.length === 0) return null;
  if (!classes || classes.length === 0) return { kind: "unresolved", why: "no-scans" };

  const present = new Set(classes.map(systemBodyClassKey).filter(Boolean));
  for (const entry of wanted) {
    for (const key of keysForRequirement(entry)) {
      if (present.has(key)) return { kind: "pass", matched: entry };
    }
  }
  // Nothing matched. Only a finished honk makes that a statement about the system.
  return listComplete ? { kind: "fail", wanted } : { kind: "unresolved", why: "incomplete" };
}

/** The sentence the demoted row carries, so the commander can check the working. */
export function describeSystemBodyVerdict(verdict: SystemBodyVerdict): string {
  if (verdict.kind === "pass") return `${verdict.matched} in this system`;
  if (verdict.kind === "unresolved") {
    return verdict.why === "no-scans"
      ? "no bodies scanned in this system yet"
      : "the system honk is unfinished, so a missing companion body proves nothing";
  }
  const list = verdict.wanted.join(", ");
  return `this system holds none of ${list}, which this species grows alongside`;
}
