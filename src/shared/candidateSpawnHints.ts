import type { SpeciesEntry } from "./types.js";
import { normalizeStellarMappingKey, spectralKeysFromJournalStarType } from "./starSpectralKeys.js";
import { colourFromMaterials } from "./speciesColour.js";
import { colourVariantLabel, resolveColourVariant } from "./colourVariants.js";

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
  /*
   * The species' own table decides, when we have one.
   *
   * This runs ahead of everything below because the tables under it are per *genus*, and the game is
   * not: Bacterium aurasus reads the star while Bacterium vesicula reads a material, and a genus
   * table has to be wrong about one of them. It reported Gold for an aurasus that came out Lime.
   * See `shared/colourVariants.ts`.
   */
  const rule = entry.colourVariant;
  if (rule) {
    const label = colourVariantLabel(
      resolveColourVariant(rule, { parentStarType: hostStarType, materials }),
    );
    if (label) return label;
    return "(unknown)";
  }

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

/**
 * The colour, when the host star is not one star but a set.
 *
 * A body orbiting a barycentre has no single host — `AB 1` is lit by A and B, `BCD 3` by three — and
 * the app has always refused to pick one of them, for good reason: choosing a star the body does not
 * orbit is how an M-dwarf observation reached Electricae pluma from a neutron-star system. Refusing
 * to choose is right; refusing to *say anything* threw away what is actually known. If every host
 * would give the same colour, that colour is certain. If they differ, naming both beats "(unknown)".
 *
 * The `" or "` form is already understood downstream, where it suppresses the variant photograph —
 * the app must not pick a picture the rule declined to pick.
 */
export function candidateMorphColorShortLabelForHosts(
  entry: SpeciesEntry,
  hostStarTypes: readonly (string | null | undefined)[] | null | undefined,
  materials?: readonly { Name?: string }[] | null,
): string {
  const hosts = (hostStarTypes ?? []).map((h) => (h ?? "").trim()).filter(Boolean);
  if (hosts.length === 0) return candidateMorphColorShortLabel(entry, null, materials);
  const labels: string[] = [];
  for (const host of hosts) {
    const label = candidateMorphColorShortLabel(entry, host, materials);
    // One unknown host makes the whole answer unknown: the body may well be that one.
    if (label === "(unknown)") return "(unknown)";
    for (const part of label.split(" or ")) {
      const t = part.trim();
      if (t && !labels.includes(t)) labels.push(t);
    }
  }
  return labels.length ? labels.join(" or ") : "(unknown)";
}
