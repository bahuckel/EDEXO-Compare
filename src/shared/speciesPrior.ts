/**
 * How common each species is, before anything about the body is known.
 *
 * `P(body | species)` is what the profiles measure and it is only half of Bayes. Without the prior a
 * rare species that happens to fit sharply outranks a common one that fits nearly as well, on every
 * body — which is how a ranking ends up recommending Fumerola over Bacterium and being wrong most of
 * the time. The corpus knows the answer: 10,299 bodies with a known species set, so the share of
 * them carrying a species is its prior.
 *
 * Counted per body, not per sighting, and keyed by the app's own species id.
 */

export interface SpeciesPrevalenceFile {
  formatVersion: 1;
  builtAt: string;
  /** Bodies behind the counts — the denominator. */
  bodies: number;
  /** Species id → bodies carrying it. */
  species: Record<string, number>;
}

/**
 * Prior for one species, with Laplace smoothing against the corpus size.
 *
 * A species the corpus has never recorded is rare, not impossible: it takes the smallest prior the
 * table can express rather than zero, because zero would remove it from the ranking entirely and
 * §15.2 settled that rarity is not unreliability.
 */
export function speciesPrior(
  file: SpeciesPrevalenceFile | null,
  speciesId: string,
  fallback: number,
): number {
  if (!file || file.bodies <= 0) return fallback;
  const n = file.species[speciesId] ?? 0;
  return (n + 1) / (file.bodies + 2);
}
