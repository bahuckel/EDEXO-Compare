/**
 * One key for a host star, whoever is spelling it.
 *
 * The journal writes `Scan.StarType` as `F`, `DA`, `N`, `H`, `TTS`. EDSM — and therefore every
 * feeder profile built from it — writes the same stars as `F6`, `White Dwarf (DA) Star`,
 * `Neutron Star`, `Black Hole`, `TTS7`. Nothing in the app reconciled those two vocabularies, so the
 * habitat scorer compared the journal's letter against the profile's label as free text and fell
 * through to a substring test: `"D"` against `"White Dwarf (DA) Star"` scored 0.85 for containing
 * the letter d, and so did `"A"`, because the same string contains an a. The host-star term was
 * noise wearing a number, which is why restoring host stars for 12,738 bodies moved the ranking by
 * two species.
 *
 * The key is deliberately the class, not the subclass: O B A F G K M L T Y for the Harvard
 * sequence, W for Wolf-Rayet, TTS for T Tauri, plus D (white dwarf), N (neutron) and H (black hole).
 * That is the resolution the game keys on and the resolution the corpus can support — 88 distinct
 * spectral strings across ~30,000 observations otherwise split the evidence into dust.
 */

const HARVARD = "OBAFGKMLTY";

/** Long-form names EDSM uses where the journal uses a letter. Longest match first. */
const NAMED: [RegExp, string][] = [
  [/\bsupermassive\s+black\s+hole\b/i, "H"],
  [/\bblack\s+hole\b/i, "H"],
  [/\bneutron\s+star\b/i, "N"],
  [/\bwhite\s+dwarf\b/i, "D"],
  [/\bwolf[-\s]?rayet\b/i, "W"],
  [/\bt\s*tauri\b/i, "TTS"],
  [/\bherbig\s+ae\/?be\b/i, "A"],
  [/\bexotic\b/i, "other"],
];

/**
 * The class key for a star, or null when the value says nothing about one.
 *
 * `other` is a real answer — an exotic or unrecognised star is not the same as no star at all, and
 * collapsing it into null would let a species look unobserved on a host it has actually been seen on.
 */
export function hostStarClassKey(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;

  for (const [re, key] of NAMED) {
    if (re.test(v)) return key;
  }

  const upper = v.toUpperCase();
  if (upper.startsWith("TTS")) return "TTS";
  // Journal white dwarfs are DA/DAB/DQ/DC…; neutron stars N; black holes H; Wolf-Rayet W/WN/WC.
  if (upper.startsWith("D")) return "D";
  if (upper.startsWith("N")) return "N";
  if (upper.startsWith("H")) return "H";
  if (upper.startsWith("W")) return "W";

  const first = upper.charAt(0);
  if (HARVARD.includes(first)) return first;
  // `AeBe`, `C`, `MS`, `S` and the proto-stellar oddities land here rather than being forced into a
  // Harvard letter they do not belong to.
  return "other";
}

/**
 * Position on the Harvard sequence, or null for anything off it.
 *
 * Distance along O-B-A-F-G-K-M-L-T-Y is a real similarity: an F host and a G host are neighbouring
 * temperatures. A white dwarf and an F star are not near each other on any axis that matters, so
 * they get no partial credit.
 */
export function hostStarHarvardIndex(key: string | null): number | null {
  if (!key || key.length !== 1) return null;
  const i = HARVARD.indexOf(key);
  return i === -1 ? null : i;
}

/**
 * 0..1 similarity between two host stars, given however each was spelled.
 *
 * Same class is 1. Neighbours on the Harvard sequence fall away by step. Anything else — a neutron
 * star against a K dwarf, a black hole against anything — is 0, because there is no sense in which
 * they are nearly the same star.
 */
export function hostStarClassSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ka = hostStarClassKey(a);
  const kb = hostStarClassKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const ia = hostStarHarvardIndex(ka);
  const ib = hostStarHarvardIndex(kb);
  if (ia == null || ib == null) return 0;
  const d = Math.abs(ia - ib);
  if (d === 1) return 0.8;
  if (d === 2) return 0.5;
  if (d === 3) return 0.2;
  return 0;
}
