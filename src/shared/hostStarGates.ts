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
 * All three thresholds are measured against edastro's `codex-life-data.csv` — 4,845,751 codex
 * sightings, 1,136 codex ids — with the whole file as the background control:
 *
 * | class | K | F | M | G | A | N | B |
 * |---|---|---|---|---|---|---|---|
 * | all life (n = 4,809,242) | 26.9 % | 23.8 % | 22.9 % | 14.4 % | 6.2 % | 2.4 % | 0.8 % |
 *
 * Bark Mounds are the negative control and behave like one: F 22.8 %, M 20.9 %, K 19.1 %, A 18.1 %
 * across 23,552 sightings — the background, which is what "no star rule" should look like.
 *
 * **A caveat that travels with the last two.** The CSV records the *system's main star*, not the
 * body's host, and our gate reads the body's host set. For pluma that mismatch does not arise —
 * `ABSTRACT-COND.md` measured the same quantity and our own body-level corpus agrees 31 of 31. For
 * Amphora and Anemone the class sets are extreme enough (97.4 % and 98.2 %) that the distinction
 * cannot plausibly reverse them, but they should be re-measured at body-host granularity when the
 * galaxy database lands.
 */
export const HOST_STAR_GATES: { idIncludes: string; gate: HostStarGate }[] = [
  {
    /**
     * Amphora Plant. `conditions.parent_star: "A"` sat unread in the species file; ed-dsn states it
     * with no count, and the CSV supplies one: **A 97.4 % of 1,484 sightings**, against 6.2 % of all
     * life. B adds 1.8 % and is kept — the whole set costs nothing in filtering power, because B is
     * 0.8 % of the background, and dropping it would delete 27 real sightings.
     *
     * Amphora also needs a life-bearing companion body in the system, which nothing here can answer,
     * so the row keeps its `predictionUnsupported` flag either way. This gate narrows *where*, not
     * whether.
     */
    idIncludes: "amphora",
    gate: {
      allowed: ["A", "B"],
      evidence: "A-class hosts 97.4 % of 1,484 Amphora sightings (B a further 1.8 %); A is 6.2 % of all life",
    },
  },
  {
    /**
     * Anemone. `conditions.parent_star_types: ["O","B","A (rare)"]`, also unread. Measured across
     * **27,232 sightings**: B 82.8 %, O 10.4 %, A 5.0 % — 98.2 % inside the set ed-dsn names, and
     * the ordering it gives ("O, B, more rarely A") is wrong only in that B leads. Herbig Ae/Be adds
     * 0.9 % and folds into A through {@link hostStarClassKey}, taking the set to 99.1 %.
     */
    idIncludes: "anemone",
    gate: {
      allowed: ["O", "B", "A"],
      evidence: "B 82.8 %, O 10.4 %, A 5.0 % of 27,232 Anemone sightings — 98.2 %; those three are 7 % of all life",
    },
  },
  {
    idIncludes: "electricae_pluma",
    gate: {
      allowed: ["A", "N", "D", "H"],
      evidence:
        "10,139 pluma sightings: neutron 46.0 %, white dwarf 30.6 %, A 14.2 %, black hole 8.3 % — 99.1 %; B 0.2 %, O 0.0 %",
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
