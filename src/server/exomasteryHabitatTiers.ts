/**
 * How much each habitat parameter is allowed to move the score.
 *
 * The scorer derives a parameter's importance from how concentrated that species' feeder samples are
 * around a mode. That is a good measure of *consistency* and a poor measure of *relevance*: a moon
 * whose orbital period clusters tightly says nothing about where the species grows, it only says the
 * commanders who found it happened to be looking at similar moons. Measured across the 79 shipped
 * profiles, orbital geometry was carrying 8.01 % of the total importance mass — more than half of
 * what the five conditions the owner names as primary carried between them (14.33 %), and on
 * Fonticulua fluctus it was 20.0 % against 14.3 %.
 *
 * Three tiers, applied as a multiplier on top of the measured importance:
 *
 * - `primary`    — planet class, atmosphere type, gravity, temperature, pressure. The conditions the
 *                  game actually gates spawns on, and the ones a commander reads first.
 * - `standard`   — everything else: masses, radius, distance from arrival, crust and atmosphere
 *                  composition, volcanism, terraforming state, host star.
 * - `background` — orbital geometry. Kept in the score, never removed: semi-major axis and orbital
 *                  period are at least proxies for irradiance, so they can be argued for, unlike
 *                  axial tilt, which is dropped outright by shouldOmitExomasterySciencePath.
 *
 * The tier weights move the split to primary 26.66 % / background 1.12 %.
 *
 * These are the only hand-set weights in the model, and they are deliberately coarse. Per-parameter
 * importance is meant to be *learned* — queue step 8 derives it from how deterministic a parameter is
 * for a species against a pooled background, which is what tells a wide wall from an unconstrained
 * range. Until then this keeps orbital noise from outvoting gravity.
 */

export type ExomasteryHabitatTier = "primary" | "standard" | "background";

export const EXOMASTERY_HABITAT_TIER_WEIGHT: Record<ExomasteryHabitatTier, number> = {
  primary: 2,
  standard: 1,
  background: 0.15,
};

/**
 * Orbital geometry. Includes the tidally-locked flag, which is orbital mechanics wearing a
 * categorical hat, and the two elements no shipped profile carries yet (ascending node, mean
 * anomaly) so they arrive demoted rather than at full weight.
 */
const BACKGROUND = [
  /semimajor/i,
  /orbitalperiod/i,
  /rotationa?l?period/i,
  /eccentricity/i,
  /orbitalinclination/i,
  /periapsis/i,
  /ascendingnode/i,
  /meananomaly/i,
  /tidallylocked/i,
];

/**
 * The five the owner names as usually the most important. Matched the way the scorer's own value
 * lookups match, so a tier can never be assigned to a path the scorer reads differently.
 */
const PRIMARY = [
  /(^|\.)gravity$/i,
  /surfacegravity/i,
  /surfacetemperature/i,
  /surfacepressure/i,
  /(^|\.)subtype$/i,
  /planetclass/i,
  /bodytype/i,
];

export function exomasteryHabitatTier(path: string): ExomasteryHabitatTier {
  const low = path.trim().toLowerCase();
  if (!low) return "standard";
  // Background first: orbital geometry must not be rescued by a loose primary pattern.
  for (const re of BACKGROUND) {
    if (re.test(low)) return "background";
  }
  for (const re of PRIMARY) {
    if (re.test(low)) return "primary";
  }
  // Atmosphere *type* is primary; the per-gas composition fractions are not.
  if (low.includes("atmosphere") && !low.includes("composition")) return "primary";
  return "standard";
}

/** Multiplier for a path's measured importance. */
export function exomasteryHabitatTierWeight(path: string): number {
  return EXOMASTERY_HABITAT_TIER_WEIGHT[exomasteryHabitatTier(path)];
}
