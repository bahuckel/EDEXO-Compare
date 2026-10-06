/**
 * The one spelling the game itself varies (owner, 2026-10-06: "check other such UK-US normalizations
 * … to avoid it everywhere in the app"). Checked against his journals, the species data and the
 * Spansh, EDSM and EDAstro text the app reads: only sulphur differs. The journal writes "sulfur
 * dioxide" in a scan's `Atmosphere` prose and "sulphur" / `SulphurDioxide` everywhere else (materials,
 * `AtmosphereType`, compositions, geology); Spansh, the species data and EDAstro write "Sulphur".
 * Vapour, grey and the rest are spelled one way throughout.
 *
 * Every comparison of atmosphere, material or geology text folds through this first.
 */

/** "sulfur" → "sulphur", keeping a leading capital ("Sulfur" → "Sulphur"). */
export function foldSpelling(text: string): string {
  return text.replace(/sulfur/gi, (m) => (m[0] === "S" ? "Sulphur" : m === "SULFUR" ? "SULPHUR" : "sulphur"));
}
