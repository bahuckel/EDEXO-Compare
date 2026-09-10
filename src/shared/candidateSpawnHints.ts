import type { SpeciesEntry } from "./types.js";
import { normalizeStellarMappingKey, spectralKeysFromJournalStarType } from "./starSpectralKeys.js";
import { colourFromMaterials } from "./speciesColour.js";

/**
 * Short morph colour for candidate title line from host star + genus `meta.color_variants` stellar map.
 * Material-driven genera (no reliable star→colour) return `(unknown)`.
 */
/**
 * The colour variant a candidate will turn out to be, or "(unknown)" when nothing decides it.
 *
 * Two rules, and the material one was never tried. A material-driven species returned "(unknown)"
 * on the first line without looking at anything — reported on Bacterium Vesicula, on a body whose
 * only colour-driving material was yttrium, which its own rule maps to Lime. The rule was in the
 * data; the loader was not carrying it and this function would not have used it anyway.
 *
 * `materials` is the body's scan list. Without it the material rule cannot run and the answer is
 * honestly unknown rather than guessed from the star, which decides a different set of species.
 */
export function candidateMorphColorShortLabel(
  entry: SpeciesEntry,
  hostStarType?: string | null,
  materials?: readonly { Name?: string }[] | null,
): string {
  // Materials first: they are a fact about the body in front of the commander.
  const byMaterial = colourFromMaterials(entry.speciesColourRules, materials);
  if (byMaterial.colour) return byMaterial.colour;
  // Two colour-driving materials on one body: the rule genuinely does not decide, and naming one
  // would read exactly like a derivation.
  if (byMaterial.candidates.length > 1) return byMaterial.candidates.join(" or ");

  const mat = entry.genusColorMaterialDriven === true;
  const map = entry.genusColorStellarMapping;
  const hasStellar = !!(map && Object.keys(map).length > 0);
  if (mat || !hasStellar) return "(unknown)";

  const host = hostStarType?.trim();
  if (!host) return "(unknown)";

  const keys = spectralKeysFromJournalStarType(host);
  const nulls = entry.genusStarColorNullSpectralClasses ?? [];
  for (const k of keys) {
    if (nulls.some((n) => n.toUpperCase() === k.toUpperCase())) return "(unknown)";
    const norm = normalizeStellarMappingKey(k);
    const col = map[norm] ?? map[k];
    if (col?.trim()) return col.trim();
  }
  return "(unknown)";
}
