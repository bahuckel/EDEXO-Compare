import type { SpeciesEntry } from "./types.js";
import { normalizeStellarMappingKey, spectralKeysFromJournalStarType } from "./starSpectralKeys.js";

/**
 * Short morph colour for candidate title line from host star + genus `meta.color_variants` stellar map.
 * Material-driven genera (no reliable star→colour) return `(unknown)`.
 */
export function candidateMorphColorShortLabel(entry: SpeciesEntry, hostStarType?: string | null): string {
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
