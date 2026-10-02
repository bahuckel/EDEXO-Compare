import type { SpeciesEntry } from "./types.js";
import { normalizeStellarMappingKey, spectralKeysFromJournalStarType } from "./starSpectralKeys.js";
import { colourFromMaterials } from "./speciesColour.js";
import { colourVariantLabel, resolveColourVariant, type MaterialReading } from "./colourVariants.js";

/**
 * Short morph colour for candidate title line from host star + genus `meta.color_variants` stellar map.
 * Material-driven genera (no reliable star→colour) return `(unknown)`.
 */
/**
 * The colour variant a candidate will turn out to be, or "(unknown)" when nothing decides it.
 *
 * Two rules, and the material one was never tried. A material-driven species returned "(unknown)"
 * on the first line without looking at anything — reported on Bacterium Vesicula, on a body whose
 * only colour-driving material was yttrium, which its own rule maps to Lime. The rule was in the
 * data; the loader was not carrying it and this function would not have used it anyway.
 *
 * `materials` is the body's scan list. Without it the material rule cannot run and the answer is
 * honestly unknown rather than guessed from the star, which decides a different set of species.
 */
/**
 * Genera whose species are one colour each: the colour is in the name ("Luteolum Anemone", "Brain
 * Tree Aureum", "Sinuous Tubers Roseum") or there is only one (Bark Mounds, Amphora Plant, Crystalline
 * Shards, Ingensradices). The codex logs them without a colour, so there is nothing to predict, and
 * "(unknown)" on their cards read as a gap the commander could fill (owner, 2026-09-28: "drop the
 * color on legacy cards").
 */
const ONE_COLOUR_GENERA = new Set([
  "anemone",
  "brain-tree",
  "sinuous-tubers",
  "bark-mound",
  "amphora",
  "crystalline-shards",
  "ingensradices",
]);

/** False for a species whose colour is fixed — its card shows no colour at all. */
export function speciesHasColourVariants(entry: Pick<SpeciesEntry, "genusDataDir">): boolean {
  return !ONE_COLOUR_GENERA.has(entry.genusDataDir);
}

/** A colour label, "(unknown)", or "" for a species with no colour variants. */
export function candidateMorphColorShortLabel(
  entry: SpeciesEntry,
  hostStarType?: string | null,
  materials?: readonly MaterialReading[] | null,
): string {
  if (!speciesHasColourVariants(entry)) return "";
  /*
   * The species' own table decides, when we have one.
   *
   * This runs ahead of everything below because the tables under it are per *genus*, and the game is
   * not: Bacterium aurasus reads the star while Bacterium vesicula reads a material, and a genus
   * table has to be wrong about one of them. It reported Gold for an aurasus that came out Lime.
   * See `shared/colourVariants.ts`.
   */
  const rule = entry.colourVariant;
  if (rule) {
    const label = colourVariantLabel(resolveColourVariant(rule, { parentStarType: hostStarType, materials }));
    if (label) return label;
    return "(unknown)";
  }

  // Materials first: they are a fact about the body in front of the commander.
  const byMaterial = colourFromMaterials(entry.speciesColourRules, materials);
  if (byMaterial.colour) return byMaterial.colour;
  // Two colour-driving materials on one body: the rule genuinely does not decide, and naming one
  // would read exactly like a derivation.
  if (byMaterial.candidates.length > 1) return byMaterial.candidates.join(" or ");

  const mat = entry.genusColorMaterialDriven === true;
  const map = entry.genusColorStellarMapping;
  const hasStellar = !!(map && Object.keys(map).length > 0);
  if (mat || !hasStellar) return "(unknown)";

  const host = hostStarType?.trim();
  if (!host) return "(unknown)";

  const keys = spectralKeysFromJournalStarType(host);
  const nulls = entry.genusStarColorNullSpectralClasses ?? [];
  for (const k of keys) {
    if (nulls.some((n) => n.toUpperCase() === k.toUpperCase())) return "(unknown)";
    const norm = normalizeStellarMappingKey(k);
    const col = map[norm] ?? map[k];
    if (col?.trim()) return col.trim();
  }
  return "(unknown)";
}

/**
 * The colour, when the host star is not one star but a set.
 *
 * A body orbiting a barycentre has no single host — `AB 1` is lit by A and B, `BCD 3` by three — and
 * the app has always refused to pick one of them, for good reason: choosing a star the body does not
 * orbit is how an M-dwarf observation reached Electricae pluma from a neutron-star system. Refusing
 * to choose is right; refusing to *say anything* threw away what is actually known. If every host
 * would give the same colour, that colour is certain. If they differ, naming both beats "(unknown)".
 *
 * The `" or "` form is already understood downstream, where it suppresses the variant photograph —
 * the app must not pick a picture the rule declined to pick.
 */
/**
 * The colour for a body lit by several stars, brightest first (owner, 2026-09-28: "if a star has no
 * color, check for other bodies with luminosity in the system for color, if not, fallback to
 * (unknown) color, do not assume F"). The first star whose class has a colour row decides.
 */
export function candidateMorphColorLabelByLight(
  entry: SpeciesEntry,
  starsByLight: readonly (string | null | undefined)[] | null | undefined,
  materials?: readonly MaterialReading[] | null,
): string {
  if (!speciesHasColourVariants(entry)) return "";
  const stars = (starsByLight ?? []).map((s) => (s ?? "").trim()).filter(Boolean);
  if (stars.length === 0) return candidateMorphColorShortLabel(entry, null, materials);
  for (const s of stars) {
    const label = candidateMorphColorShortLabel(entry, s, materials);
    if (label !== "(unknown)") return label;
  }
  return "(unknown)";
}

export function candidateMorphColorShortLabelForHosts(
  entry: SpeciesEntry,
  hostStarTypes: readonly (string | null | undefined)[] | null | undefined,
  materials?: readonly MaterialReading[] | null,
): string {
  if (!speciesHasColourVariants(entry)) return "";
  const hosts = (hostStarTypes ?? []).map((h) => (h ?? "").trim()).filter(Boolean);
  if (hosts.length === 0) return candidateMorphColorShortLabel(entry, null, materials);
  const labels: string[] = [];
  for (const host of hosts) {
    const label = candidateMorphColorShortLabel(entry, host, materials);
    // One unknown host makes the whole answer unknown: the body may well be that one.
    if (label === "(unknown)") return "(unknown)";
    for (const part of label.split(" or ")) {
      const t = part.trim();
      if (t && !labels.includes(t)) labels.push(t);
    }
  }
  return labels.length ? labels.join(" or ") : "(unknown)";
}

/** "Antimony on this body", "Antimony at 0.42 %, the rarest of …", "G-class parent star", "DA (D-class) parent star" → the decider. */
function causeFromReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const star = /^(?:\S+ \()?([A-Z]+)-class/.exec(reason);
  if (star) return star[1]!;
  const m = /^(.+?)(?: at [\d.]+ %,| on this body)/.exec(reason);
  if (!m) return null;
  const first = m[1]!.split(",")[0]!.trim();
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : null;
}

/**
 * What decided the colour `candidateMorphColorShortLabel` gives for this body (review F-5.2): the
 * host star's class ("G") or the material ("Antimony"), shown dimmed beside the colour so the
 * commander can check the working — "Emerald [G]". Null when nothing single decided it: an unknown
 * or undecided colour, or a body lit by several stars that do not agree on one cause.
 */
export function candidateMorphColorCause(
  entry: SpeciesEntry,
  hostStarTypes: readonly (string | null | undefined)[] | null | undefined,
  materials?: readonly MaterialReading[] | null,
): string | null {
  if (!speciesHasColourVariants(entry)) return null;
  const hosts = (hostStarTypes ?? []).map((h) => (h ?? "").trim()).filter(Boolean);
  const causes = new Set<string | null>();
  for (const host of hosts.length ? hosts : [null]) causes.add(causeForOneHost(entry, host, materials));
  return causes.size === 1 ? ([...causes][0] ?? null) : null;
}

function causeForOneHost(
  entry: SpeciesEntry,
  host: string | null,
  materials?: readonly MaterialReading[] | null,
): string | null {
  const rule = entry.colourVariant;
  if (rule) {
    const answer = resolveColourVariant(rule, { parentStarType: host, materials });
    return answer.colour ? causeFromReason(answer.reason) : null;
  }
  const byMaterial = colourFromMaterials(entry.speciesColourRules, materials);
  if (byMaterial.colour) return causeFromReason(byMaterial.reason);
  if (byMaterial.candidates.length > 1) return null;
  const map = entry.genusColorStellarMapping;
  if (entry.genusColorMaterialDriven === true || !map || !host) return null;
  const nulls = entry.genusStarColorNullSpectralClasses ?? [];
  for (const k of spectralKeysFromJournalStarType(host)) {
    if (nulls.some((n) => n.toUpperCase() === k.toUpperCase())) return null;
    const col = map[normalizeStellarMappingKey(k)] ?? map[k];
    if (col?.trim()) return k.toUpperCase();
  }
  return null;
}
