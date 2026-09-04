import type { GenusHint, SpeciesEntry } from "../shared/types.js";

function genusFold(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function genusVariantKeys(s: string): string[] {
  const f = genusFold(s);
  if (!f) return [];
  const out = [f];
  if (f.endsWith("s") && f.length > 3) out.push(f.slice(0, -1));
  if (f.length > 3 && !f.endsWith("s")) out.push(`${f}s`);
  return out;
}

/** DSS / ScanOrganic genus labels → species rows whose genus folder or display genus matches. */
export function filterByGenusHints(entries: SpeciesEntry[], hints: GenusHint[] | null): SpeciesEntry[] {
  if (!hints || hints.length === 0) return entries;
  const hintKeys = new Set<string>();
  for (const h of hints) {
    for (const raw of [h.Genus_Localised, h.Genus]) {
      if (!raw?.trim()) continue;
      for (const k of genusVariantKeys(raw)) hintKeys.add(k);
      const f = genusFold(raw);
      if (f.includes("bacterial")) {
        for (const k of ["bacterium", "bacteria", "bacterial"]) hintKeys.add(k);
      }
    }
  }
  return entries.filter((e) => {
    for (const part of [e.genus, e.genusDataDir]) {
      if (!part?.trim()) continue;
      for (const k of genusVariantKeys(part)) {
        if (hintKeys.has(k)) return true;
      }
    }
    return false;
  });
}
