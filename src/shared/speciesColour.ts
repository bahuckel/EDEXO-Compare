/**
 * Which colour variant a plant will be, worked out from the body it grows on.
 *
 * A species' variants are not cosmetic — they are how the codex names the thing, and a commander
 * hunting a specific one needs to know before landing. For most genera the colour follows the host
 * star; for a handful it follows a rare material in the body's own composition, which the scan
 * already lists. The app knew the rule and never applied it, so it reported "Bacterium Vesicula
 * (unknown)" on a body whose only rare material was yttrium — which makes it Lime, with certainty.
 *
 * ## Certainty is part of the answer
 *
 * A body may carry two of the six colour-driving materials, and then the colour genuinely is not
 * decided by this rule. Returning one of them would be inventing an answer that reads exactly like a
 * derived one. The result says which case it is, and the caller can show "Lime" or "Lime or Cyan"
 * accordingly.
 *
 * ## The misspelling
 *
 * Our own species data used to write **Antinomy** where the game writes **antimony**, across ten
 * rows in three genera, and every one of them silently resolved nothing. The data is corrected now,
 * but the alias stays: the game's spelling is the only one that will ever come out of a journal, and
 * anything we take in from elsewhere — a hand-written fix file, a table transcribed from a website,
 * a future import — can spell it either way. A filter that costs one map lookup is cheaper than
 * discovering the misspelling again from a commander's field report.
 */

/** Materials whose presence names a colour, as the game spells them. */
const MATERIAL_ALIASES: Record<string, string> = {
  // Anything that reaches us spelled the old way. See the header.
  antinomy: "antimony",
};

/** Lower-case and de-alias, so "Antinomy" and "antimony" are the same material. */
export function normaliseMaterial(name: string): string {
  const key = name.trim().toLowerCase();
  return MATERIAL_ALIASES[key] ?? key;
}

export interface ColourRules {
  type?: string;
  mapping?: Record<string, string>;
}

export type ColourBasis = "material" | "star" | "none";

export interface ColourGuess {
  /** The colour, when exactly one rule matched. */
  colour: string | null;
  /** Every colour the evidence allows. One entry means certain; more means genuinely undecided. */
  candidates: string[];
  basis: ColourBasis;
  /** What matched, for the tooltip — the commander should be able to check our working. */
  reason: string | null;
}

const NONE: ColourGuess = { colour: null, candidates: [], basis: "none", reason: null };

/**
 * Work out the colour from a body's materials.
 *
 * `materials` is the scan's own list; only the names matter. A material the mapping does not mention
 * says nothing either way — iron is on almost everything.
 */
export function colourFromMaterials(
  rules: ColourRules | null | undefined,
  materials: readonly { Name?: string }[] | null | undefined,
): ColourGuess {
  if (!rules?.mapping || rules.type !== "material_based") return NONE;
  if (!materials?.length) return NONE;

  const present = new Set(materials.map((m) => normaliseMaterial(String(m?.Name ?? ""))).filter(Boolean));
  const hits: { material: string; colour: string }[] = [];
  for (const [material, colour] of Object.entries(rules.mapping)) {
    if (present.has(normaliseMaterial(material))) hits.push({ material, colour });
  }
  if (hits.length === 0) return NONE;

  const candidates = [...new Set(hits.map((h) => h.colour))];
  if (candidates.length === 1) {
    return {
      colour: candidates[0]!,
      candidates,
      basis: "material",
      reason: `${hits.map((h) => h.material).join(", ")} on this body`,
    };
  }
  // Two or more colour-driving materials: the rule does not decide, and saying it does would be a
  // guess dressed as a derivation.
  return {
    colour: null,
    candidates,
    basis: "material",
    reason: `${hits.map((h) => `${h.material} → ${h.colour}`).join(", ")}`,
  };
}

/**
 * Work out the colour from the host star's class.
 *
 * The star must be the body's **direct parent**, not the arrival star — in a multi-star system those
 * are routinely different, and naming a colour off the wrong one is wrong information for free.
 * Callers resolve the parent; this only reads the class letter.
 */
export function colourFromStar(
  rules: ColourRules | null | undefined,
  parentStarClass: string | null | undefined,
): ColourGuess {
  if (!rules?.mapping || rules.type !== "star_based") return NONE;
  const cls = (parentStarClass ?? "").trim();
  if (!cls) return NONE;
  for (const [key, colour] of Object.entries(rules.mapping)) {
    // Keys are class letters or short codes; match the start so "K5 V" hits "K".
    if (cls.toUpperCase().startsWith(key.trim().toUpperCase())) {
      return { colour, candidates: [colour], basis: "star", reason: `${key}-class parent star` };
    }
  }
  return NONE;
}

/** Whichever rule this species uses. Materials first: they are on the body itself. */
export function inferColour(
  rules: ColourRules | null | undefined,
  input: { materials?: readonly { Name?: string }[] | null; parentStarClass?: string | null },
): ColourGuess {
  const byMaterial = colourFromMaterials(rules, input.materials);
  if (byMaterial.basis !== "none") return byMaterial;
  return colourFromStar(rules, input.parentStarClass);
}
