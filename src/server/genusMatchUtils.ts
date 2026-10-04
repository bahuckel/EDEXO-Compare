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

/**
 * Genus labels the game uses that do not fold onto our genus name. The game calls the vents genus
 * "Amphora Plant" (`$Codex_Ent_Vents_Name;`) and ours is "Amphora": after a DSS named it, the filter
 * below kept no Amphora row at all, so the species vanished from exactly the bodies known to carry it
 * (code review, known-spawn tests 2026-09-27: 4 of 4 Amphora bodies).
 */
const GENUS_LABEL_ALIASES: Record<string, string> = {
  amphoraplant: "amphora",
  codexentventsname: "amphora",
  // The Thargoid entries (owner, 2026-10-04): the game's genus symbols are not our folder names.
  codexentbarnaclesname: "thargoidbarnacles",
  barnacles: "thargoidbarnacles",
  barnacle: "thargoidbarnacles",
  codexentthargoidcoralname: "thargoidcoral",
  coral: "thargoidcoral",
  codexentthargoidspirename: "thargoidspires",
  codexentthargoidspiresname: "thargoidspires",
  spires: "thargoidspires",
};

/** DSS / ScanOrganic genus labels → species rows whose genus folder or display genus matches. */
export function filterByGenusHints(entries: SpeciesEntry[], hints: GenusHint[] | null): SpeciesEntry[] {
  if (!hints || hints.length === 0) return entries;
  const hintKeys = new Set<string>();
  for (const h of hints) {
    for (const raw of [h.Genus_Localised, h.Genus]) {
      if (!raw?.trim()) continue;
      for (const k of genusVariantKeys(raw)) hintKeys.add(k);
      const f = genusFold(raw);
      const alias = GENUS_LABEL_ALIASES[f];
      if (alias) hintKeys.add(alias);
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
