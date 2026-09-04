/**
 * Journal `Volcanism` strings look like "major water geysers volcanism", "iron magma volcanism", etc.
 * Longest phrase first so multi-word gases match before their substrings.
 */
const VOLCANISM_MATERIAL_PHRASES: string[] = [
  "carbon dioxide",
  "sulphur dioxide",
  "sulfur dioxide",
  "silicate",
  "ammonia",
  "methane",
  "nitrogen",
  "chlorine",
  "helium",
  "iron",
  "water",
  "carbon",
  "rock",
  "metal",
];

/**
 * Substrings to look for in lowercased journal volcanism (fix stubs + hints).
 */
export function extractVolcanismMaterialPhrases(journalVolcanism: string | undefined): string[] {
  const vol = (journalVolcanism ?? "").trim().toLowerCase();
  if (!vol || vol.includes("no volcanism")) return [];
  const found: string[] = [];
  for (const phrase of VOLCANISM_MATERIAL_PHRASES) {
    if (vol.includes(phrase)) found.push(phrase);
  }
  return [...new Set(found)];
}

/** Title-case / codex-style token for volcanismIncludes (e.g. water → Water, silicate → Silicate). */
export function volcanismMaterialToCodexToken(phrase: string): string {
  const t = phrase.trim();
  if (!t) return t;
  if (t.toLowerCase() === "silicate") return "Silicate";
  return t
    .split(/[\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Journal `Volcanism` strings look like "major water geysers volcanism".
 * Criteria may list elemental tokens ("water") or legacy "-based" labels ("Water-based").
 */
export function expandVolcanismCriterionFragments(frags: string[]): string[] {
  const out: string[] = [];
  for (const x of frags) {
    const t = (x ?? "").trim().toLowerCase();
    if (!t) continue;
    out.push(t);
    if (t.endsWith("-based")) {
      const base = t.slice(0, -6).trim();
      if (base) out.push(base);
    }
    if (t === "rocky") out.push("rock");
  }
  return [...new Set(out)];
}

export function volcanismJournalMatchesFragments(
  journalVolcanism: string | undefined,
  frags: string[],
): boolean {
  if (frags.some((f) => (f ?? "").trim().toUpperCase() === "ALL")) {
    const vol = (journalVolcanism ?? "").trim().toLowerCase();
    if (!vol || vol.includes("no volcanism")) return false;
    return true;
  }
  const vol = (journalVolcanism ?? "").trim().toLowerCase();
  if (!vol) return false;
  return expandVolcanismCriterionFragments(frags).some((frag) => vol.includes(frag));
}
