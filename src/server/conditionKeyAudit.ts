/**
 * Every `conditions` key the species files may carry, and what happens to each one.
 *
 * ## Why this exists
 *
 * `buildCriterionFromRecord` reads a long list of aliases and **ignores everything else in silence**.
 * That is a reasonable way to parse a hand-written file until you count what it has been ignoring:
 *
 * | species | key | consequence |
 * |---|---|---|
 * | Electricae pluma | `parent_star.required_types` | never gated on its host star — stood on an M3 dwarf for months |
 * | Amphora | `parent_star: "A"` | unenforced |
 * | Anemone | `parent_star_types` | unenforced |
 * | Clypeus speculumi | `distance_from_star.min_ls` | the sharpest condition we have, unread |
 *
 * Four real spawn rules, present in the data, absent from the matcher, and nothing anywhere said so.
 * Unlike `location_requirement` — which at least raised `predictionUnsupported` and so told the
 * reader the app could not judge — these simply evaporated, and a species with an unenforced
 * condition looks exactly like a species that passed it.
 *
 * So every key is now declared. A key that is neither recognised nor listed as knowingly unenforced
 * is a defect, `unrecognisedConditionKeys` names it, and `tests/conditionKeys.test.ts` fails on it.
 * The test is the loud failure; the runtime only warns, because a hand-edited file on a commander's
 * machine should not stop the app from starting.
 */

/**
 * Keys `buildCriterionFromRecord` parses into a {@link SpeciesCriterion}, every alias included.
 *
 * Long because the species files were written by hand over a long time and the parser accepts the
 * spellings that accumulated. Breadth here is not the problem; silence about what falls outside was.
 */
const PARSED_CRITERION_KEYS: readonly string[] = [
  // planet class
  "planetClassAnyOf", "planetClasses", "planetClass", "planet_types", "planetTypes",
  "allowedPlanetClasses", "PlanetClass", "PlanetClasses", "bodyClass", "BodyClass",
  "worldType", "worldTypes", "WorldType",
  // atmosphere
  "atmosphereTypeAnyOf", "atmosphereTypes", "atmosphereType", "atmospheres", "atmosphere",
  "Atmosphere", "AtmosphereType",
  "atmospherePressureCategory", "pressureCategory", "atmosphere_pressure", "atmospherePressure",
  "whenAtmosphereLinkedAtmosphereAnyOf", "when_atmosphere_linked_atmosphere_any_of",
  "atmosphereLinkedAtmosphereAnyOf",
  "whenAtmosphereLinkedMaxTempK", "when_atmosphere_max_temp_k", "atmosphereLinkedMaxTempK",
  "co2MaxTempK",
  // gravity
  "surfaceGravity", "SurfaceGravity", "max_gravity", "maxGravity", "minGravity",
  "gravityMax", "gravityMin", "surfaceGravityMax", "surfaceGravityMin", "gMax", "gMin",
  // temperature
  "surfaceTemperatureK", "surfaceTemperature", "temperatureK", "temperature_K", "temp_K",
  "minTemperature", "maxTemperature", "tempMin", "tempMax", "temperatureMin", "temperatureMax",
  "surfaceTemperatureMinK", "surfaceTemperatureMaxK", "minTempK", "maxTempK",
  // pressure
  "surfacePressure", "SurfacePressure", "pressureMin", "pressureMax", "minPressure", "maxPressure",
  "surfacePressureMin", "surfacePressureMax",
  // volcanism
  "volcanismIncludes", "volcanism", "Volcanism", "volcanismActiveRequired", "requires_active_volcanism",
  // host star (codex fragment list)
  "parentStarTypeIncludesAnyOf", "parentStarTypeIncludes", "parent_star_type_includes",
  "starTypeIncludes", "StarTypeIncludes",
  // distance from the host star
  "orbitDistanceFromParentStarLs", "orbit_ls", "orbitFromStarLs", "orbit_from_star_ls",
  "distance_from_star", "distanceFromStar",
  // geological signals
  "geologicalSignalIncludes", "geological_signals", "fssGeologicalIncludes", "scannerGeologicalIncludes",
  // landability and free-text notes
  "landable", "Landable",
  "matchContextNotes", "habitatConditionNotes", "conditionNotes", "codexNotes",
];

/**
 * Keys handled outside the criterion parser, and where.
 *
 * These are not silent: each one reaches the reader through some other path, so a species carrying
 * one is judged or is told it cannot be judged.
 */
const HANDLED_ELSEWHERE: Readonly<Record<string, string>> = {
  location_requirement:
    "Phase 7 spatial gates when the species is in SPATIAL_GATES; otherwise raises predictionUnsupported.",
  requires_system_bodies: "Raises predictionUnsupported — depends on other bodies in the system.",
  system_requirements: "Raises predictionUnsupported — depends on other bodies in the system.",
  min_sample_distance_m: "Sampling range, shown in the UI rather than used for matching.",
  parent_star:
    "hostStarGates — Electricae pluma {A,N,D,H} on 10,139 sightings, Amphora {A,B} on 1,484.",
  parent_star_types: "hostStarGates — Anemone {O,B,A} on 27,232 sightings.",
};

/**
 * Keys we read, understand, and deliberately do **not** enforce yet — with the reason.
 *
 * This list is pinned by a test. Adding an unenforced condition should be a decision somebody makes
 * on purpose, not something that happens because a parser shrugged.
 */
export const UNGATED_CONDITION_KEYS: Readonly<Record<string, string>> = {
  gravity_constraints:
    "Anemone, written as null. Placeholder for the fact that Anemone ignores gravity entirely (measured to 3.85 g), which is the absence of a rule rather than one.",
};

const RECOGNISED = new Set<string>([
  ...PARSED_CRITERION_KEYS,
  ...Object.keys(HANDLED_ELSEWHERE),
  ...Object.keys(UNGATED_CONDITION_KEYS),
]);

export function isRecognisedConditionKey(key: string): boolean {
  return RECOGNISED.has(key);
}

/** Every declared key, for a test that wants to check the inventory itself. */
export function recognisedConditionKeys(): string[] {
  return [...RECOGNISED].sort();
}

/**
 * Keys on a `conditions` record that nothing in the app knows about.
 *
 * Empty is the only correct answer for the shipped tree. A non-empty result means a spawn rule was
 * written into the data and is being ignored — the exact failure that let pluma stand on a red dwarf.
 */
export function unrecognisedConditionKeys(conditions: unknown): string[] {
  if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) return [];
  return Object.keys(conditions as Record<string, unknown>)
    .filter((k) => !RECOGNISED.has(k))
    .sort();
}
