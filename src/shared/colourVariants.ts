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
 * ## Two materials, two answers — and, for some species, one
 *
 * A material table lists six materials and a body carries two of them about a third of the time. For
 * years both were returned and the caller said "Cyan or Orange", because an earlier pass found that
 * percentage did not decide it — 11 of 20 went to the lower one.
 *
 * **That pass was reading the wrong tables.** Fungoida bullarum and setisis take their colour from a
 * completely different set of six elements than gelata and stabitis, so the material credited with
 * each colour was often not the one the game had used, and the resulting coin-flip was an artefact.
 * With the owner's four corrected Fungoida tables the rule is plain: **the rarest of the species'
 * materials present on the body decides**, at 14 of his own 15 finds against 10 for the most
 * abundant.
 *
 * It is opt-in per species (`tieBreak: "rarest"` in the table) rather than global, because it has
 * only been checked on three of them. Fungoida stabitis is deliberately unmarked: on 76 Leonis 6 a
 * it came out White where its own table says Magenta, and the rarest material there belonged to the
 * other element set entirely. Everything unmarked keeps returning every candidate, which stays the
 * honest answer for a rule nobody has verified.
 *
 * The old counter-example survives and is not a counter-example: on Eorgh Prou WH-G c25-4 A 1 a the
 * same pair of materials gave Fumerola aquatis its molybdenum colour and Bacterium tela its tin
 * colour. Two species, two tables — exactly what per-species tables predict.
 */
import { normaliseMaterial } from "./speciesColour.js";
import { spectralKeysFromJournalStarType } from "./starSpectralKeys.js";

export interface ColourVariantRule {
  source: "star" | "material";
  /** Star class key (`F`, `TTS`, `AEBE`) or lower-case material name, to a colour name. */
  map: Record<string, string>;
  /**
   * How to choose when a body carries several of this species' materials.
   *
   * `"rarest"` — the one with the lowest percentage on the body decides. Set only on species where
   * that has been checked against real finds; everything else keeps returning every candidate,
   * which is the honest answer for a rule nobody has verified. See
   * {@link colourFromBodyMaterials}.
   */
  tieBreak?: "rarest";
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

/**
 * One entry of a body's `Materials`, however the source spells it.
 *
 * The journal writes `Name` / `Percent`; records that have been through a Spansh or EDSM shape can
 * arrive lower-case. `PlanetScan.materials` allows all four, so reading only one pair would drop the
 * tie-break on half the callers without any sign that it had.
 */
export interface MaterialReading {
  Name?: string;
  name?: string;
  Percent?: number;
  percent?: number;
}

const materialName = (m: MaterialReading | null | undefined): string => String(m?.Name ?? m?.name ?? "");

const materialPercent = (m: MaterialReading | null | undefined): number => {
  for (const v of [m?.Percent, m?.percent]) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return Number.NaN;
};

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
  materials: readonly MaterialReading[] | null | undefined,
): ColourVariantAnswer {
  if (rule?.source !== "material") return NONE;
  if (!materials?.length) return NONE;

  const percentOf = new Map<string, number>();
  for (const m of materials) {
    const name = normaliseMaterial(materialName(m));
    if (!name) continue;
    const pct = materialPercent(m);
    if (!percentOf.has(name) || Number.isNaN(percentOf.get(name)!)) percentOf.set(name, pct);
  }

  const hits: { material: string; colour: string; percent: number }[] = [];
  for (const [material, colour] of Object.entries(rule.map)) {
    const key = normaliseMaterial(material);
    if (percentOf.has(key) && colour?.trim()) {
      hits.push({ material, colour: colour.trim(), percent: percentOf.get(key)! });
    }
  }
  if (hits.length === 0) return NONE;

  const candidates = [...new Set(hits.map((h) => h.colour))];
  if (candidates.length === 1) {
    return one(candidates[0]!, "material", `${hits.map((h) => h.material).join(", ")} on this body`);
  }

  /*
    The tie-break, where it has been earned.

    A body carries two of a species' six materials about a third of the time, and for years this
    returned both — "Cyan or Orange" — because nothing in the data picked one. The commander's four
    Fungoida tables settled it for three of those species: **the rarest material on the body decides**,
    14 of 15 of his own finds, against 10 of 15 for the most abundant.

    It is opt-in per species rather than global on purpose. The one find it does not explain is
    Fungoida stabitis, whose body carried a rarer material from the *other* element set than anything
    in its own table — so stabitis, and every species nobody has checked, keeps the honest list.
  */
  if (rule.tieBreak === "rarest" && hits.every((h) => Number.isFinite(h.percent))) {
    const rarest = hits.reduce((a, b) => (b.percent < a.percent ? b : a));
    return one(
      rarest.colour,
      "material",
      `${rarest.material} at ${rarest.percent.toFixed(2)} %, the rarest of ` +
        `${hits.map((h) => h.material).join(", ")} on this body`,
    );
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
  input: { parentStarType?: string | null; materials?: readonly MaterialReading[] | null },
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
