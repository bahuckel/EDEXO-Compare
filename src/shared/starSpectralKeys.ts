/**
 * Multi-character spectral keys, written the way the codex writes them.
 *
 * Both are real star classes with a colour of their own, and both used to be read as material names
 * because they are neither one letter nor `TTS`. That mattered: a genus counts as material-driven
 * when its mapping names something that is not a spectral class, so Fonticulua's single `Ae/Be`
 * entry switched its entire fourteen-class star table off and every Fonticulua candidate reported
 * "(unknown)" — caught in the field on Blu Thua ML-P b47-2 A 3, where the plant came out Amethyst
 * and the M-class parent star had said so all along. Tussock's `Black Hole` entry did the same to
 * Tussock.
 */
const NAMED_SPECTRAL_KEYS: Record<string, string> = {
  "ae/be": "AEBE",
  aebe: "AEBE",
  "black hole": "H",
  blackhole: "H",
};

/** Keys in genus `meta.color_variants.mapping` that represent host spectral class (vs material-name maps). */
export function isStellarSpectralMappingKey(key: string): boolean {
  const k = key.trim();
  if (!k) return false;
  if (/^[A-Za-z]$/.test(k)) return true;
  if (NAMED_SPECTRAL_KEYS[k.toLowerCase()]) return true;
  return k.toUpperCase() === "TTS";
}

/** Normalised key for display / comparison (`TTS`, `AEBE`, or a single spectral letter). */
export function normalizeStellarMappingKey(key: string): string {
  const k = key.trim();
  const named = NAMED_SPECTRAL_KEYS[k.toLowerCase()];
  if (named) return named;
  if (k.toUpperCase() === "TTS") return "TTS";
  return k.charAt(0).toUpperCase();
}

const STELLAR_DISPLAY_ORDER = [
  "O",
  "B",
  "A",
  "F",
  "G",
  "K",
  "M",
  "L",
  "T",
  "TTS",
  "Y",
  "W",
  "D",
  "N",
  "AEBE",
  "H",
] as const;

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
  // Herbig Ae/Be. `AeBe` matches none of the branches below and would name no class at all.
  if (/^AE ?\/? ?BE/.test(upperAll)) keys.add("AEBE");

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
