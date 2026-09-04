/** Keys in genus `meta.color_variants.mapping` that represent host spectral class (vs material-name maps). */
export function isStellarSpectralMappingKey(key: string): boolean {
  const k = key.trim();
  if (!k) return false;
  if (/^[A-Za-z]$/.test(k)) return true;
  return k.toUpperCase() === "TTS";
}

/** Normalised key for display / comparison (`TTS` or single spectral letter). */
export function normalizeStellarMappingKey(key: string): string {
  const k = key.trim();
  if (k.toUpperCase() === "TTS") return "TTS";
  return k.charAt(0).toUpperCase();
}

const STELLAR_DISPLAY_ORDER = ["O", "B", "A", "F", "G", "K", "M", "L", "T", "TTS", "Y", "W", "D", "N"] as const;

/** Harvard-style-ish order for UI lists (unknown keys sort last). */
export function sortStellarSpectralKeysForDisplay(keys: string[]): string[] {
  const rank = (key: string) => {
    const u = key.toUpperCase();
    const i = STELLAR_DISPLAY_ORDER.indexOf(u as (typeof STELLAR_DISPLAY_ORDER)[number]);
    return i === -1 ? 999 : i;
  };
  return [...keys].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * Map journal `Scan.StarType` strings to spectral keys used in `meta.color_variants.mapping`
 * (single-letter classes, TTS, etc.).
 */
export function spectralKeysFromJournalStarType(starType: string): string[] {
  const s = starType.trim();
  if (!s) return [];
  const keys = new Set<string>();
  const upperAll = s.toUpperCase();

  if (upperAll.startsWith("TTS") || /\bT\s+TAURI\b/i.test(s)) keys.add("TTS");

  const paren = s.match(/^([A-Za-z]{1,3})\s*\(/);
  if (paren) {
    const t = paren[1]!.toUpperCase();
    if (t.length >= 1 && t.length <= 3) keys.add(t);
  }

  const brown = s.match(/^([A-Z])\s+Brown\s+ dwarf/i);
  if (brown) keys.add(brown[1]!.toUpperCase());

  if (keys.size === 0) {
    const head = s.match(/^([A-Z]{1,3})(?=\s|[/:]|\s*Star|\s*dwarf|$)/i);
    if (head) keys.add(head[1]!.toUpperCase());
  }

  return [...keys];
}
