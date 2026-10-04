/**
 * The steps every atmosphere normaliser shares (Phase 6 dedupe; code review B7). The keys they build
 * stay different on purpose — the matcher folds `-rich` into the gas, the habitat score keeps Argon
 * and Argon-rich apart, two keys are the shipped tables' own — but the words for "airless", the
 * density words in front of the gas and the journal's CamelCase are read here, once.
 */

/** "None", "No atmosphere", "no_atmosphere", "Thin no atmosphere"…: the words for an airless body. */
export function isNoAtmosphereText(text: string): boolean {
  const lo = text.trim().toLowerCase().replace(/_/g, " ");
  return lo === "none" || lo.includes("no atmosphere");
}

/**
 * The gas without the density words Spansh and EDSM write in front of it, in any order:
 * `Hot thin Sulphur dioxide` → `Sulphur dioxide`. The journal keeps the density in `Atmosphere`.
 */
export function stripAtmosphereDensity(text: string): string {
  return text.replace(/^(?:(?:hot|thin|thick)\s+)+/i, "").trim();
}

/**
 * The journal's CamelCase `AtmosphereType` in words: `SulphurDioxide` → ["Sulphur", "Dioxide"],
 * `NeonRich` → ["Neon"] with `rich`. A lone "Rich" is a word, not a suffix.
 */
export function atmosphereTypeWords(token: string): { words: string[]; rich: boolean } {
  const rich = /Rich$/.test(token) && token !== "Rich";
  const base = rich ? token.slice(0, -4) : token;
  return { words: base.split(/(?<=[a-z])(?=[A-Z])/), rich };
}
