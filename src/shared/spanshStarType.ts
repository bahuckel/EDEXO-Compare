/**
 * A star's journal `StarType` from the way EDSM and Spansh describe it in words.
 *
 * Both write `spectralClass` ("K2", "DA5") for most stars, and that is split into type and subclass
 * where it is read. For some they leave it empty and only the `subType` says what the star is —
 * across one corpus of 7,693 EDSM systems: 226 neutron stars, 30 black holes and 30 white dwarfs.
 *
 * The fallback used to take the subType's first word. `Neutron Star` became "Neutron", which the
 * class key happens to read as N. `White Dwarf (DA) Star` became "White" and `Black Hole` became
 * "Black", which it read as **W**, a Wolf-Rayet, and **B**, a hot blue star — so Electricae pluma,
 * which is recorded under white dwarfs and black holes 38.9 % of the time, was demoted on exactly
 * those bodies as "never seen under this class".
 */
const NAMED: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^white dwarf \(([a-z]+)\)/i, (m) => m[1]!.toUpperCase()],
  [/^white dwarf/i, () => "D"],
  [/^neutron star/i, () => "N"],
  [/^supermassive black hole/i, () => "SupermassiveBlackHole"],
  [/^black hole/i, () => "H"],
  [/^t tauri/i, () => "TTS"],
  [/^herbig ae\/?be/i, () => "AeBe"],
  [/^wolf-rayet\s*([a-z]*)\s*star/i, (m) => `W${m[1]!.toUpperCase()}`],
  [/^(ms|s|c|cn|cj|ch|chd)-?type star/i, (m) => m[1]!.toUpperCase()],
  [/^([a-z])\s*\(/i, (m) => m[1]!.toUpperCase()],
];

/** `White Dwarf (DA) Star` → `DA`; `Black Hole` → `H`; `K (Yellow-Orange) Star` → `K`. Undefined when it names nothing. */
export function journalStarTypeFromSubType(subType: string | null | undefined): string | undefined {
  const s = (subType ?? "").trim();
  if (!s) return undefined;
  for (const [re, pick] of NAMED) {
    const m = re.exec(s);
    if (m) return pick(m);
  }
  return undefined;
}
