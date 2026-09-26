/**
 * The game's genus tokens and the names the journal prints for them.
 *
 * `SAASignalsFound.Genuses` carries both (`$Codex_Ent_Tussocks_Genus_Name;` → "Tussock"); Spansh's
 * dump carries only the token. So a system fetched from Spansh needs this table to turn its genera
 * into the same hints a surface scan would have given. Names as the journal writes them (checked
 * against the owner's `SAASignalsFound` lines, 2026-09-26); the four genera he has never mapped
 * (Brain Trees, Crystalline Shards, Amphora, Sinuous Tubers) use their codex names.
 */
const NAMES: Record<string, string> = {
  $Codex_Ent_Aleoids_Genus_Name: "Aleoida",
  $Codex_Ent_Bacterial_Genus_Name: "Bacterium",
  $Codex_Ent_Cactoid_Genus_Name: "Cactoida",
  $Codex_Ent_Clypeus_Genus_Name: "Clypeus",
  $Codex_Ent_Conchas_Genus_Name: "Concha",
  $Codex_Ent_Cone_Name: "Bark Mounds",
  $Codex_Ent_Electricae_Genus_Name: "Electricae",
  $Codex_Ent_Fonticulus_Genus_Name: "Fonticulua",
  $Codex_Ent_Fumerolas_Genus_Name: "Fumerola",
  $Codex_Ent_Fungoids_Genus_Name: "Fungoida",
  $Codex_Ent_Osseus_Genus_Name: "Osseus",
  $Codex_Ent_Recepta_Genus_Name: "Recepta",
  $Codex_Ent_Shrubs_Genus_Name: "Frutexa",
  $Codex_Ent_Sphere_Name: "Anemone",
  $Codex_Ent_Stratum_Genus_Name: "Stratum",
  $Codex_Ent_Tubus_Genus_Name: "Tubus",
  $Codex_Ent_Tussocks_Genus_Name: "Tussock",
  $Codex_Ent_Brancae_Name: "Brain Tree",
  $Codex_Ent_Ground_Struct_Ice_Name: "Crystalline Shards",
  $Codex_Ent_Vents_Name: "Amphora Plant",
  $Codex_Ent_Tube_Name: "Sinuous Tubers",
};

/** "$Codex_Ent_Tussocks_Genus_Name;" → "Tussock"; null for a token this table does not know. */
export function genusNameForCodexToken(token: string): string | null {
  const key = token.trim().replace(/;$/, "");
  return NAMES[key] ?? null;
}
