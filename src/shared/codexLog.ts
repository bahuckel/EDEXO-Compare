/**
 * What the commander has already logged in the codex.
 *
 * B4. `CodexEntry` is written every time a codex page is filled in, and for biology it names the
 * species and its colour variant:
 *
 * ```
 * "Name_Localised":"Fonticulua Fluctus - Amethyst", "Category_Localised":"Biological and Geological",
 * "IsNewEntry":true
 * ```
 *
 * The variant is a fact about the star, not about the species — the same species is amethyst here and
 * emerald two systems over — so the codex key is the part before the dash. A species with any variant
 * logged has been logged.
 *
 * The point of keeping this is the badge: for a codex hunter, the species they have *never* seen is
 * the one worth flying to, and the app knows which those are without asking anyone.
 */

/** `$Codex_Category_Biology;` — the localised form is "Biological and Geological". */
const BIOLOGY_CATEGORY = /biolog/i;

/**
 * Codex key for a species name: lower case, no punctuation, no colour variant.
 *
 * The same shape the species tree's own labels reduce to, so "Fonticulua Fluctus - Amethyst" from the
 * journal and "Fonticulua fluctus" from `data/species/**` land on the same key.
 */
export function codexSpeciesKey(name: string): string {
  const beforeVariant = name.split(" - ")[0] ?? name;
  return beforeVariant
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The species a `CodexEntry` line records, or null when it is not about biology. */
export function codexSpeciesFromLine(line: {
  event?: unknown;
  Category?: unknown;
  Category_Localised?: unknown;
  Name_Localised?: unknown;
  Name?: unknown;
}): string | null {
  if (line.event !== "CodexEntry") return null;
  const category = `${typeof line.Category === "string" ? line.Category : ""} ${
    typeof line.Category_Localised === "string" ? line.Category_Localised : ""
  }`;
  if (!BIOLOGY_CATEGORY.test(category)) return null;

  const name = typeof line.Name_Localised === "string" ? line.Name_Localised.trim() : "";
  if (!name) return null;
  const key = codexSpeciesKey(name);
  return key || null;
}

/**
 * `$Codex_SubCategory_Organic_Structures;` — plants. The *category* is "Biological and Geological",
 * so category alone lets a fumarole through, and a geological codex entry must never confirm a plant.
 */
const ORGANIC_SUBCATEGORY = /organic_structures/i;

/**
 * The species-on-a-body a composition scan confirms, as the same lock a `ScanOrganic` builds.
 *
 * The owner asked for this: *"Events like CodexEntry done by the composition scanner should also
 * count as confirmation, some plants are hard to land near."* The line carries everything needed —
 *
 * ```
 * "Name_Localised":"Fonticulua Fluctus - Amethyst", "SystemAddress":11666607646129, "BodyID":13
 * ```
 *
 * — so the genus is the first word, the species is the part before the dash, and the whole string is
 * the variant. `genusSymbol` is deliberately left empty rather than guessed: the token spells the
 * genus its own way (`$Codex_Ent_Fonticulus_05_M_Name;` for Fonticulua) and `collectResolvedOrganic-
 * LockSpeciesIds` resolves happily on the localised name alone.
 *
 * Returns null for geology, for a name with no species in it, and for anything that is not a codex
 * line. The caller still has to check `BodyID`, which is what ties it to a body.
 */
export function codexOrganicLockFromLine(line: {
  event?: unknown;
  Category?: unknown;
  Category_Localised?: unknown;
  SubCategory?: unknown;
  SubCategory_Localised?: unknown;
  Name_Localised?: unknown;
}): {
  genusLocalised: string;
  genusSymbol: string;
  speciesLocalised: string;
  speciesSymbol: string;
  variantLocalised: string;
  source: "codex";
} | null {
  if (!codexSpeciesFromLine(line)) return null;
  const sub = `${typeof line.SubCategory === "string" ? line.SubCategory : ""} ${
    typeof line.SubCategory_Localised === "string" ? line.SubCategory_Localised : ""
  }`;
  if (!ORGANIC_SUBCATEGORY.test(sub)) return null;

  const full = typeof line.Name_Localised === "string" ? line.Name_Localised.trim() : "";
  const species = (full.split(" - ")[0] ?? "").trim();
  const genus = species.split(/\s+/)[0]?.trim() ?? "";
  // "Bacterium" on its own names a genus and no species, and a lock that vague resolves to nothing.
  if (!genus || species.split(/\s+/).length < 2) return null;

  return {
    genusLocalised: genus,
    genusSymbol: "",
    speciesLocalised: species,
    speciesSymbol: "",
    variantLocalised: full,
    source: "codex",
  };
}

/**
 * Has this species been logged?
 *
 * Two words or more, or the answer is not worth having: "Bacterium" alone matches nothing useful, and
 * a genus-level key would mark every Bacterium as seen the moment one of them was.
 */
export function codexHasSpecies(logged: ReadonlySet<string>, displayName: string): boolean {
  const key = codexSpeciesKey(displayName);
  if (!key || key.split(" ").length < 2) return false;
  return logged.has(key);
}

/*
  [CODEX] — per region and per colour (owner, 2026-09-26).

  The game's CODEX tab keeps a page per galactic region, and on it every colour variant is an entry of
  its own: "Stratum Tectonicas - Green" logged in The Veils says nothing about Inner Orion Spur, nor
  about "Stratum Tectonicas - Lime" in The Veils. `CodexEntry` carries all three — the variant in
  `Name_Localised`, the region in `Region_Localised` — and `IsNewEntry` is the game saying "first in
  this region for you": across the owner's journals the 326 IsNewEntry lines are exactly the 326
  distinct (entry, region) pairs.

  Keys are `region|species|colour`, plus `region|species|*` for "any colour of it here" (used when the
  app cannot tell which colour a body will grow). Entries from journals the commander no longer has
  are simply absent, and those species show as new — his call: "mark them as new".
*/

/** A region name as a key: "The Veils" and "the veils" are one region. */
export function codexRegionKey(region: string): string {
  return region
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The keys one biology `CodexEntry` adds, or [] when it is not an organic with a region. */
export function codexRegionKeysFromLine(line: {
  event?: unknown;
  Category?: unknown;
  Category_Localised?: unknown;
  Name_Localised?: unknown;
  Region_Localised?: unknown;
}): string[] {
  const species = codexSpeciesFromLine(line as Parameters<typeof codexSpeciesFromLine>[0]);
  const region = typeof line.Region_Localised === "string" ? codexRegionKey(line.Region_Localised) : "";
  if (!species || !region) return [];
  const name = typeof line.Name_Localised === "string" ? line.Name_Localised : "";
  const dash = name.indexOf(" - ");
  const colour =
    dash >= 0
      ? name
          .slice(dash + 3)
          .trim()
          .toLowerCase()
      : "";
  return [`${region}|${species}|${colour}`, `${region}|${species}|*`];
}

/**
 * The colours of this species not yet logged in this region, from the colour label the app shows
 * ("Green", "Cyan or Orange", "(unknown)"). With no colour to go on the question becomes "any colour
 * of it here?". Null when nothing is new.
 */
export function codexNewColoursInRegion(
  logged: ReadonlySet<string>,
  region: string,
  displayName: string,
  colourLabel: string | null | undefined,
): string[] | null {
  const r = codexRegionKey(region);
  const species = codexSpeciesKey(displayName);
  if (!r || !species) return null;
  const label = (colourLabel ?? "").trim();
  const colours =
    !label || label.startsWith("(")
      ? []
      : label
          .split(" or ")
          .map((c) => c.trim())
          .filter(Boolean);
  if (colours.length === 0) return logged.has(`${r}|${species}|*`) ? null : [];
  const fresh = colours.filter((c) => !logged.has(`${r}|${species}|${c.toLowerCase()}`));
  return fresh.length ? fresh : null;
}
