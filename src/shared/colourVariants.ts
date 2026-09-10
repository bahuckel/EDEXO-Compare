/**
 * Which colour variant a plant will be, from one table per species.
 *
 * ## Why the table is per species and not per genus
 *
 * The app modelled this as a genus property with an optional species override, because that is how
 * the codex reads. It is not how the game works, and the owner's own 259 foot scans say so plainly:
 *
 *   Bacterium alcyoneum, aurasus and cerbrus take their colour from the **parent star**
 *   Bacterium acies, bullaris, informem, tela, verrata, vesicula take it from a **material**
 *
 * Same genus, two different rules. Osseus splits the same way (discus and pumice on materials,
 * cornibus / fractus / pellebantus / spiralis on the star), and so does Concha. Modelled per genus,
 * three genera were simply unanswerable: Fungoida, Fumerola and Recepta shipped material tables that
 * were never consulted, so every candidate came back "(unknown)", and Bacterium aurasus was read off
 * a material table and reported Gold where the plant was Lime.
 *
 * ## Where the tables come from
 *
 * `data/species/eddsn-colour-variants.json`, transcribed from ED-DSN, with provenance in the file.
 * Checked against the owner's journals before it was wired in: **235 star-table predictions correct
 * and none wrong**, and in all 47 material rows the colour the commander actually found was among
 * the candidates.
 *
 * ## Two materials, two answers
 *
 * A material table lists six materials; a body carries two of them about a third of the time, and
 * nothing in the data decides which one drives the colour. Percentage does not (11 of 20 go to the
 * lower one), and neither does a fixed precedence — on Eorgh Prou WH-G c25-4 A 1 a the same pair of
 * materials gave Fumerola aquatis its molybdenum colour and Bacterium tela its tin colour. So both
 * are returned and the caller says "Cyan or Orange". Naming one would be a guess wearing the clothes
 * of a derivation, and the honest form is the one that has never yet been wrong.
 */
import { normaliseMaterial } from "./speciesColour.js";
import { spectralKeysFromJournalStarType } from "./starSpectralKeys.js";

export interface ColourVariantRule {
  source: "star" | "material";
  /** Star class key (`F`, `TTS`, `AEBE`) or lower-case material name, to a colour name. */
  map: Record<string, string>;
}

export type ColourVariantBasis = "star" | "material" | "none";

export interface ColourVariantAnswer {
  /** The colour, when exactly one candidate survives. */
  colour: string | null;
  /** Every colour the evidence allows. One means certain; more means genuinely undecided. */
  candidates: string[];
  basis: ColourVariantBasis;
  /** What matched, so the commander can check our working. */
  reason: string | null;
}

const NONE: ColourVariantAnswer = { colour: null, candidates: [], basis: "none", reason: null };

function one(colour: string, basis: ColourVariantBasis, reason: string): ColourVariantAnswer {
  return { colour, candidates: [colour], basis, reason };
}

/**
 * Colour from the host star's class.
 *
 * The star must be the body's **direct parent**, not the arrival star — in a multi-star system those
 * are routinely different. The caller resolves the parent; this only reads the class.
 */
export function colourFromStarClass(
  rule: ColourVariantRule | null | undefined,
  parentStarType: string | null | undefined,
): ColourVariantAnswer {
  if (rule?.source !== "star") return NONE;
  const raw = (parentStarType ?? "").trim();
  if (!raw) return NONE;
  for (const key of spectralKeysFromJournalStarType(raw)) {
    const hit = rule.map[key.toUpperCase()];
    if (hit?.trim()) return one(hit.trim(), "star", `${key}-class parent star`);
  }
  return NONE;
}

/**
 * Colour from the body's own materials.
 *
 * Only the names matter; a material the table does not mention says nothing either way, which is
 * most of them — iron is on almost everything.
 */
export function colourFromBodyMaterials(
  rule: ColourVariantRule | null | undefined,
  materials: readonly { Name?: string }[] | null | undefined,
): ColourVariantAnswer {
  if (rule?.source !== "material") return NONE;
  if (!materials?.length) return NONE;
  const present = new Set(
    materials.map((m) => normaliseMaterial(String(m?.Name ?? ""))).filter(Boolean),
  );
  const hits: { material: string; colour: string }[] = [];
  for (const [material, colour] of Object.entries(rule.map)) {
    if (present.has(normaliseMaterial(material)) && colour?.trim()) {
      hits.push({ material, colour: colour.trim() });
    }
  }
  if (hits.length === 0) return NONE;
  const candidates = [...new Set(hits.map((h) => h.colour))];
  if (candidates.length === 1) {
    return one(candidates[0]!, "material", `${hits.map((h) => h.material).join(", ")} on this body`);
  }
  return {
    colour: null,
    candidates,
    basis: "material",
    reason: hits.map((h) => `${h.material} → ${h.colour}`).join(", "),
  };
}

/** Whichever rule this species uses. */
export function resolveColourVariant(
  rule: ColourVariantRule | null | undefined,
  input: { parentStarType?: string | null; materials?: readonly { Name?: string }[] | null },
): ColourVariantAnswer {
  if (!rule) return NONE;
  return rule.source === "star"
    ? colourFromStarClass(rule, input.parentStarType)
    : colourFromBodyMaterials(rule, input.materials);
}

/** One short label for the candidate line: the colour, "A or B", or null when nothing decides. */
export function colourVariantLabel(answer: ColourVariantAnswer): string | null {
  if (answer.colour) return answer.colour;
  if (answer.candidates.length > 1) return answer.candidates.join(" or ");
  return null;
}
