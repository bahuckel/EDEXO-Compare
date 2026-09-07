/**
 * Spawn conditions that depend on the host **star class**, measured rather than quoted.
 *
 * ## Why this is a module and not a field on the species row
 *
 * The species JSON already carries `conditions.parent_star` for Electricae pluma and Amphora, and
 * `conditions.parent_star_types` for Anemone. **None of the three is read.** `speciesTreeLoader`
 * looks for `parentStarTypeIncludesAnyOf` / `parentStarTypeIncludes` / `starTypeIncludes` and
 * nothing else, so those keys are dropped in silence — not evaluated, and not even flagged as
 * `predictionUnsupported` the way `location_requirement` is. Pluma has therefore never been gated on
 * its host star at all.
 *
 * Wiring the prose through would not have helped much either. It reads
 * `"A (luminosity class V or higher)"` and `"Neutron star"`, and the matcher compares codex
 * fragments against the journal's `StarType`, which spells those same stars `A` and `N`. Substring
 * matching one vocabulary against the other is what {@link hostStarClassKey} was written to stop.
 *
 * ## The evidence
 *
 * From `EDSM-targz-to-db/docs/ABSTRACT-COND.md` §3.7, measured 2026-09-06 across **10,194 pluma
 * sightings**: arrival stars are Neutron 46 %, White Dwarf 30 %, A 14 %, Black Hole 8 %. **O and B
 * came in at 0 %**, which refutes two of the four "to be confirmed" classes ed-dsn lists, so the
 * set is exactly {A, N, D, H} rather than the wider one the codex claims.
 *
 * Checked against our own corpus before being switched on, and the numbers are unusually clean:
 *
 * | measure | result |
 * |---|---|
 * | confirmed pluma sightings kept | **31 of 31** |
 * | corpus bodies matching the Electricae genus shape | 627 |
 * | …of those, hosts inside {A, N, D, H} | 36 (5.7 %) |
 * | …so pluma is withdrawn from | **591 bodies (94.3 %)**, losing nothing |
 *
 * ## Barycentres, which is what made this necessary
 *
 * A body orbiting a star *pair* has no star in its parents chain — only `{Null: n}` — and picking
 * one star out of the pair invents an answer. That is not hypothetical: the shipped pluma profile
 * records one `M3` host, and it comes from **Eok Blao ED-Q d6-351 BC 3 c**, a body orbiting the B+C
 * barycentre of an M dwarf and an L brown dwarf in a system whose primary is a *neutron star*. That
 * single mis-attributed row is what licensed pluma on every M-class body in the game, including the
 * owner's home system 175 ly from R Cra.
 *
 * `ABSTRACT-COND.md` §6.3 hit the same wall from the other side and states the rule: *"if the body
 * orbits a barycentre with no star in its parents chain, fall back to the letters of ALL stars in
 * the system (fixes 35 Anemone misses on star-pair barycentres)"*. So a gate is evaluated against a
 * **set** of classes, never a single one:
 *
 *  - every star in the body's own parents chain, which for a body orbiting a pair is both of them;
 *  - and when the chain names no star at all, every star in the system.
 *
 * Both readings are generous on purpose. The set only has to *intersect* the allowed classes, so a
 * body whose host is ambiguous keeps its candidate rather than losing it to a coin flip.
 *
 * ## What a failure means
 *
 * The same thing a failed spatial gate means: the row moves to the `unlikely` tier with its reason
 * attached, and stays visible behind "show unlikely". An empty class set — no star scanned yet —
 * returns null, never a failure.
 */
import { hostStarClassKey } from "./hostStarClass.js";

export interface HostStarGate {
  /** Class keys from {@link hostStarClassKey} the species has actually been recorded under. */
  allowed: string[];
  /** What the measurement says, for the tooltip. */
  evidence: string;
}

/**
 * The gates, keyed by the species-id fragment they apply to.
 *
 * One entry, deliberately. Amphora ("A") and Anemone ("O, B, more rarely A") carry the same shape of
 * claim in the data, but ed-dsn states them without a count and nothing has measured them yet —
 * `ABSTRACT-COND.md` gives pluma 10,194 sightings and gives those two none. A threshold with no
 * measurement behind it is the thing this project keeps refusing to ship.
 */
export const HOST_STAR_GATES: { idIncludes: string; gate: HostStarGate }[] = [
  {
    idIncludes: "electricae_pluma",
    gate: {
      allowed: ["A", "N", "D", "H"],
      evidence:
        "10,194 pluma sightings: neutron 46 %, white dwarf 30 %, A 14 %, black hole 8 %; O and B measured at 0 %",
    },
  },
];

/** The host-star gate a species carries, or null when its spawn does not depend on the star class. */
export function hostStarGateForSpeciesId(speciesId: string): HostStarGate | null {
  const id = speciesId.toLowerCase();
  for (const { idIncludes, gate } of HOST_STAR_GATES) if (id.includes(idIncludes)) return gate;
  return null;
}

/**
 * Class keys for however many host stars a body has, de-duplicated and in a stable order.
 *
 * Unrecognised spellings collapse to `other` rather than to nothing — see {@link hostStarClassKey} —
 * so an exotic star still counts as *a star that is not on the allowed list*, which is the honest
 * reading.
 */
export function hostStarClassKeys(starTypes: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const t of starTypes) {
    const k = hostStarClassKey(t);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

export interface HostStarVerdictGate {
  passes: boolean;
  /** The classes we resolved for this body — one star, a pair, or the whole system. */
  classes: string[];
  allowed: string[];
  evidence: string;
}

/**
 * Evaluate a species' host-star gate, or null when there is nothing to evaluate — the species has no
 * star condition, or no star has been scanned for this body yet.
 *
 * **An empty class list returns null, never a failure**, for the same reason a missing coordinate
 * does in `spatialGates`: not knowing what the star is must not read as "the species cannot be here".
 */
export function evaluateHostStarGate(
  speciesId: string,
  starClasses: readonly string[] | null | undefined,
): HostStarVerdictGate | null {
  const gate = hostStarGateForSpeciesId(speciesId);
  if (!gate || !starClasses || starClasses.length === 0) return null;
  return {
    passes: starClasses.some((c) => gate.allowed.includes(c)),
    classes: [...starClasses],
    allowed: gate.allowed,
    evidence: gate.evidence,
  };
}

/** Human-readable class name, so the card does not show a bare letter. */
const CLASS_LABEL: Record<string, string> = {
  D: "white dwarf",
  N: "neutron star",
  H: "black hole",
  W: "Wolf-Rayet",
  TTS: "T Tauri",
  other: "exotic",
};

export function hostStarClassLabel(key: string): string {
  return CLASS_LABEL[key] ?? `${key}-class`;
}

/** One line for the reader: what the star is, and what the species has been recorded under. */
export function describeHostStarVerdict(v: HostStarVerdictGate): string {
  const seen = v.classes.map(hostStarClassLabel).join(" / ");
  const want = v.allowed.map(hostStarClassLabel).join(", ");
  return `Host star ${seen} — recorded only under ${want}.`;
}
