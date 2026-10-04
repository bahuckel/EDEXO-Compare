/**
 * What the galaxy map can filter a system by besides its biology (owner, 2026-10-04: "filters to
 * show different things, per body type, per exobio type, per star type", shop-style tabs).
 *
 * Every system of `bio-index.bin` gets three numbers in `data/galaxy/system-traits.bin.gz`, built from
 * the Spansh dump by `scripts/build-system-traits.ts`, in the index's own order:
 *
 *   - its main star's class (one of {@link STAR_CLASSES}, by position; 255 = not recorded),
 *   - the star classes present anywhere in it (bit i = `STAR_CLASSES[i]`),
 *   - the planet classes and features present (bit i = `BODY_TRAITS[i]`).
 *
 * The bit positions are the file format: append, never reorder.
 */

export interface TraitDef {
  /** Stable key, used in URLs and saved filters. */
  key: string;
  label: string;
}

/** Star classes, by bit. The Spansh subtype (and the journal's StarType) fold onto these. */
export const STAR_CLASSES: readonly TraitDef[] = [
  { key: "O", label: "O (Blue-White)" },
  { key: "B", label: "B (Blue-White)" },
  { key: "A", label: "A (Blue-White)" },
  { key: "F", label: "F (White)" },
  { key: "G", label: "G (White-Yellow)" },
  { key: "K", label: "K (Yellow-Orange)" },
  { key: "M", label: "M (Red dwarf)" },
  { key: "L", label: "L (Brown dwarf)" },
  { key: "T", label: "T (Brown dwarf)" },
  { key: "Y", label: "Y (Brown dwarf)" },
  { key: "TTS", label: "T Tauri" },
  { key: "AeBe", label: "Herbig Ae/Be" },
  { key: "W", label: "Wolf-Rayet" },
  { key: "C", label: "Carbon (C, CN, CJ, CH, MS, S)" },
  { key: "D", label: "White dwarf" },
  { key: "N", label: "Neutron star" },
  { key: "H", label: "Black hole" },
  { key: "SG", label: "Giant / supergiant" },
];

/** Planet classes, then features, by bit. */
export const BODY_TRAITS: readonly TraitDef[] = [
  { key: "metal_rich", label: "Metal-rich body" },
  { key: "hmc", label: "High metal content" },
  { key: "rocky", label: "Rocky body" },
  { key: "rocky_ice", label: "Rocky ice" },
  { key: "icy", label: "Icy body" },
  { key: "elw", label: "Earth-like world" },
  { key: "ww", label: "Water world" },
  { key: "aw", label: "Ammonia world" },
  { key: "water_giant", label: "Water giant" },
  { key: "gg_water_life", label: "Gas giant, water-based life" },
  { key: "gg_ammonia_life", label: "Gas giant, ammonia-based life" },
  { key: "gg1", label: "Class I gas giant" },
  { key: "gg2", label: "Class II gas giant" },
  { key: "gg3", label: "Class III gas giant" },
  { key: "gg4", label: "Class IV gas giant" },
  { key: "gg5", label: "Class V gas giant" },
  { key: "helium_gg", label: "Helium gas giant" },
  { key: "terraformable", label: "Terraformable" },
  { key: "landable_atmo", label: "Landable with atmosphere" },
  { key: "landable", label: "Landable" },
  { key: "ringed_planet", label: "Ringed planet" },
];

/** Which group a body trait is listed under in the picker. */
export const BODY_TRAIT_GROUP: Record<string, "Planet type" | "Features"> = Object.fromEntries(
  BODY_TRAITS.map((t, i) => [t.key, i <= 16 ? "Planet type" : "Features"]),
);

export const STAR_NONE = 255;

/** A Spansh star subtype (or a journal `StarType`) to its {@link STAR_CLASSES} index; -1 when unknown. */
export function starClassIndex(subType: string | null | undefined): number {
  const s = (subType ?? "").trim();
  if (!s) return -1;
  const at = (key: string) => STAR_CLASSES.findIndex((c) => c.key === key);
  if (/^White Dwarf/i.test(s) || /^D[A-Z]*$/.test(s)) return at("D");
  if (/^Neutron/i.test(s) || s === "N") return at("N");
  if (/^Black Hole|^Supermassive/i.test(s) || s === "H" || s === "SupermassiveBlackHole") return at("H");
  if (/^Wolf-Rayet/i.test(s) || /^W[CNO]?C?$/.test(s)) return at("W");
  if (/^T Tauri/i.test(s) || s === "TTS") return at("TTS");
  if (/^Herbig/i.test(s) || s === "AeBe") return at("AeBe");
  if (/^(C|CS|CN|CJ|CH|CHd|MS|S)( Star|-type Star)?$/i.test(s) || /^(MS|S)-type/i.test(s)) return at("C");
  const m = /^([OBAFGKMLTY])(\b| |_|$)/.exec(s);
  if (m) return at(m[1]!);
  return -1;
}

/** Giants and supergiants, which also count under their own class. */
export function isGiantStar(subType: string | null | undefined): boolean {
  return /giant/i.test(subType ?? "");
}

/** A Spansh planet subtype (or a journal `PlanetClass`) to its {@link BODY_TRAITS} index; -1 when unknown. */
export function planetClassIndex(subType: string | null | undefined): number {
  const s = (subType ?? "").trim().toLowerCase();
  if (!s) return -1;
  const at = (key: string) => BODY_TRAITS.findIndex((c) => c.key === key);
  if (s.startsWith("metal")) return at("metal_rich");
  if (s.startsWith("high metal")) return at("hmc");
  if (s.startsWith("rocky ice")) return at("rocky_ice");
  if (s.startsWith("rocky")) return at("rocky");
  if (s.startsWith("icy")) return at("icy");
  if (s.startsWith("earth")) return at("elw");
  if (s.startsWith("water world")) return at("ww");
  if (s.startsWith("ammonia world")) return at("aw");
  if (s.startsWith("water giant")) return at("water_giant");
  if (s.includes("water-based life") || s.includes("water based life")) return at("gg_water_life");
  if (s.includes("ammonia-based life") || s.includes("ammonia based life")) return at("gg_ammonia_life");
  if (s.includes("helium")) return at("helium_gg");
  const roman = /class (i{1,3}|iv|v)\b/.exec(s);
  if (roman) return at(`gg${{ i: 1, ii: 2, iii: 3, iv: 4, v: 5 }[roman[1] as "i"]}`);
  return -1;
}
