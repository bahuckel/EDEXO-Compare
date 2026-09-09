/**
 * Canonn's Bioforge statistics, as a second opinion.
 *
 * EDEXO predicts from its own corpus. Canonn's Bioforge predicts from theirs, and the two do not
 * always agree — sometimes because the data differs, sometimes because the method does. Showing both
 * lets a commander see which, instead of being told one number and having to trust it.
 *
 * **None of their data ships.** The commander brings their own copy of the Bioforge stats files;
 * this module reads whatever they supply and nothing else. Where a species has no imported entry
 * there is simply no second number, which is the honest state rather than a zero.
 *
 * ## What an entry is
 *
 * One entry per *colour variant*, keyed by Canonn's `entryid` — `$Codex_Ent_Tussocks_01_F_Name;` is
 * Tussock Pennata as it appears at an F-class star. So a species is a set of entries, and the
 * variant that applies is chosen by the body's own parent star. `count` is how many sightings back
 * the entry, `reward` its payout, and the min/max fields are the envelope those sightings occupied.
 *
 * ## Why the envelopes are ranges of *observations*, not laws
 *
 * Every bound here is the extreme of what Canonn happened to record. A body outside one is not
 * impossible, it is unrecorded — so a miss demotes rather than excludes, and the tolerance below
 * exists because a 195.2 K body against a 195 K ceiling is a rounding argument, not a biological one.
 */

/** One colour variant of one species, as Bioforge records it. */
export interface BioforgeEntry {
  /** Canonn's `entryid`, e.g. `$Codex_Ent_Tussocks_01_F_Name;` — also their link target. */
  id: string;
  /** Display name including the colour: `Tussock Pennata - Yellow`. */
  name: string;
  /** Sightings behind this entry. Used as the prior weight — a variant seen 18,788 times outranks one seen 7. */
  count: number;
  /** Payout in credits. */
  reward: number;
  atmosphereType: string[];
  bodies: string[];
  volcanism: string[];
  materials: string[];
  regions: string[];
  /** Class of the star the body actually orbits. `null` entries mean "not recorded", never a class. */
  localStars: (string | null)[];
  /** Class of the system's primary, which for a moon of a distant star is a different question. */
  primaryStars: (string | null)[];
  mint: number | null;
  maxt: number | null;
  ming: number | null;
  maxg: number | null;
  minp: number | null;
  maxp: number | null;
}

/** What we know about the body being scored. Every field optional: absent means "do not test this". */
export interface BioforgeBody {
  /** Kelvin. */
  surfaceTemperature?: number | null;
  /** Gravity in g, the same unit Bioforge stores. */
  gravityG?: number | null;
  /** Atmospheric pressure in atmospheres. */
  pressureAtm?: number | null;
  atmosphereType?: string | null;
  /** Spansh/journal `subType`, e.g. `High metal content world`. */
  subType?: string | null;
  volcanism?: string | null;
  /**
   * Codex region name, klightspeed spelling.
   *
   * The single most useful field here and the least obvious. Tussock Propagito and Tussock Pennata
   * share an atmosphere, share body types, and Pennata's whole temperature range sits inside
   * Propagito's — so no physical measurement separates them at 150 K. Across 22,126 sightings and
   * 32 regions they share **no region at all**, and one pays 5.85x the other.
   */
  region?: string | null;
  /** Class of the star this body actually orbits — not the arrival star. */
  parentStarClass?: string | null;
}

/**
 * Kelvin of slack at the envelope edges.
 *
 * Canonn's own route checks land 0.4 % of sightings just outside a bound — 195.x K bodies against a
 * 195 K ceiling. That is the resolution of the recorded data, not a real boundary, so the edges are
 * soft by the same amount rather than turning a rounding difference into a rejection.
 */
export const TEMPERATURE_TOLERANCE_K = 5;

/** Proportional slack for gravity and pressure, which span orders of magnitude rather than a fixed range. */
export const RELATIVE_TOLERANCE = 0.05;

/**
 * How much a variant is demoted when the body's region is not one it has been seen in.
 *
 * Not zero, deliberately. Canonn's regions are where commanders have flown, so an unlisted region is
 * weak evidence of absence and no evidence of impossibility — the Crystalline Shards list covers 19
 * rim regions precisely because nobody surveys the core for them. But it is genuine evidence: two
 * species with identical physics and disjoint region sets are separable *only* here, and treating
 * that as noise throws away the one signal that can tell them apart.
 */
export const OUT_OF_REGION_WEIGHT = 0.05;

/** Same idea for the parent star class, which is what fixes the colour and often the variant. */
export const OUT_OF_STAR_WEIGHT = 0.1;

export interface BioforgeMatch {
  entry: BioforgeEntry;
  /** 0-1 before normalising: the prior weight times every soft penalty. */
  weight: number;
  /** Hard envelope failures — a body outside these is outside everything Canonn ever recorded. */
  failures: string[];
}

function withinRange(
  value: number | null | undefined,
  min: number | null,
  max: number | null,
  tolerance: number,
): boolean {
  if (value == null || !Number.isFinite(value)) return true; // unknown tests nothing
  if (min != null && value < min - tolerance) return false;
  if (max != null && value > max + tolerance) return false;
  return true;
}

/**
 * Does a list of recorded values admit this one?
 *
 * An empty list means Canonn recorded nothing for that field, which admits everything — the
 * alternative would reject every body on a field nobody measured. A `null` inside the list means
 * "some sightings had no value here" and is skipped rather than matched against.
 */
function listAdmits(list: readonly (string | null)[], value: string | null | undefined): boolean {
  const known = list.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (known.length === 0) return true;
  if (value == null || value === "") return true;
  return known.some((v) => v.toLowerCase() === value.toLowerCase());
}

/**
 * Score one entry against one body.
 *
 * Physics is hard, geography is soft. A body hotter than anything the species has ever been seen on
 * is a real mismatch; a body in a region nobody has surveyed for it is a gap in the survey.
 */
export function scoreEntry(entry: BioforgeEntry, body: BioforgeBody): BioforgeMatch {
  const failures: string[] = [];

  if (!withinRange(body.surfaceTemperature, entry.mint, entry.maxt, TEMPERATURE_TOLERANCE_K)) {
    failures.push("temperature");
  }
  const gTol = (entry.maxg ?? 0) * RELATIVE_TOLERANCE;
  if (!withinRange(body.gravityG, entry.ming, entry.maxg, gTol)) failures.push("gravity");
  const pTol = (entry.maxp ?? 0) * RELATIVE_TOLERANCE;
  if (!withinRange(body.pressureAtm, entry.minp, entry.maxp, pTol)) failures.push("pressure");

  if (!listAdmits(entry.atmosphereType, body.atmosphereType)) failures.push("atmosphere");
  if (!listAdmits(entry.bodies, body.subType)) failures.push("body type");
  if (!listAdmits(entry.volcanism, body.volcanism)) failures.push("volcanism");

  // The prior: a variant behind 18,788 sightings is a better bet than one behind 7, before any
  // condition is read at all.
  let weight = Math.max(entry.count, 0);

  if (body.region && entry.regions.length > 0 && !listAdmits(entry.regions, body.region)) {
    weight *= OUT_OF_REGION_WEIGHT;
  }
  if (
    body.parentStarClass &&
    entry.localStars.length > 0 &&
    !listAdmits(entry.localStars, body.parentStarClass)
  ) {
    weight *= OUT_OF_STAR_WEIGHT;
  }

  return { entry, weight: failures.length > 0 ? 0 : weight, failures };
}

/**
 * Chance per entry, as a percentage, over the entries the commander imported.
 *
 * Normalised across the candidates rather than reported raw: the question a commander is asking is
 * "which of these is it", and a set of unnormalised likelihoods answers a question nobody asked.
 * Entries that fail an envelope outright score zero and still appear, because "Canonn has never seen
 * this here" is worth saying out loud.
 *
 * Returns an empty array when nothing was imported for these species — the caller must draw that as
 * "no second opinion", never as 0 %.
 */
export function bioforgeChances(
  entries: readonly BioforgeEntry[],
  body: BioforgeBody,
): { entry: BioforgeEntry; percent: number; failures: string[] }[] {
  if (entries.length === 0) return [];
  const scored = entries.map((e) => scoreEntry(e, body));
  const total = scored.reduce((a, s) => a + s.weight, 0);
  return scored.map((s) => ({
    entry: s.entry,
    percent: total > 0 ? (s.weight / total) * 100 : 0,
    failures: s.failures,
  }));
}

/**
 * Chance per **species**, summing its colour variants instead of letting them compete.
 *
 * The bug this exists to prevent, seen on real data: at 150 K in Inner Orion Spur, Bacterium Aurasus
 * came back as four separate rows — Green 9.8 %, Lime 8.8 %, Emerald 6.4 %, Teal 4.2 % — because
 * Canonn keys by colour variant. Split that way, a species Canonn has recorded in six colours is
 * quartered against one recorded in two, and the ranking measures how many colours a species has
 * been seen in rather than how likely it is to be here.
 *
 * Colour is not a rival hypothesis. It is a *consequence* of the star the body orbits: one body, one
 * star, one colour. So the species is the unit of the question "what grows here", and the colour is
 * a separate statement made once the species is chosen — which is why it is reported beside the
 * chance rather than inside it.
 */
export function bioforgeSpeciesChances(
  entries: readonly BioforgeEntry[],
  body: BioforgeBody,
): { species: string; percent: number; reward: number; variants: BioforgeMatch[] }[] {
  if (entries.length === 0) return [];
  const bySpecies = new Map<string, BioforgeMatch[]>();
  for (const e of entries) {
    const key = speciesNameOf(e.name);
    const list = bySpecies.get(key) ?? [];
    list.push(scoreEntry(e, body));
    bySpecies.set(key, list);
  }

  const rows = [...bySpecies.entries()].map(([species, variants]) => ({
    species,
    // Summed, not averaged: every colour of a species is the same plant, so its sightings are all
    // evidence for the same answer.
    weight: variants.reduce((a, v) => a + v.weight, 0),
    // The payout is a property of the species, so any variant that carries one will do.
    reward: variants.find((v) => v.entry.reward > 0)?.entry.reward ?? 0,
    variants,
  }));
  const total = rows.reduce((a, r) => a + r.weight, 0);
  return rows.map((r) => ({
    species: r.species,
    percent: total > 0 ? (r.weight / total) * 100 : 0,
    reward: r.reward,
    variants: r.variants,
  }));
}

/**
 * Which colour this species takes at this body, or null when nothing settles it.
 *
 * Informative only, and **never a gate** — every colour of a species pays the same, so a wrong
 * colour costs the commander nothing and costs EDEXO its credibility. Null is therefore the right
 * answer whenever the star is unknown, the body orbits a barycentre naming no single star, or
 * Canonn has recorded no variant for that class.
 */
export function bioforgeColourFor(
  variants: readonly BioforgeMatch[],
  parentStarClass: string | null | undefined,
): { name: string; entryId: string } | null {
  if (!parentStarClass) return null;
  const hit = variants.find(
    (v) =>
      v.failures.length === 0 &&
      v.entry.localStars.some(
        (s) => typeof s === "string" && s.toLowerCase() === parentStarClass.toLowerCase(),
      ),
  );
  if (!hit) return null;
  const i = hit.entry.name.indexOf(" - ");
  return i === -1 ? null : { name: hit.entry.name.slice(i + 3).trim(), entryId: hit.entry.id };
}

/** Canonn's own page for an entry. Their ids are opaque strings; pass them through untouched. */
export function bioforgeUrl(entryId: string): string {
  return `https://bioforge.canonn.tech/?entryid=${encodeURIComponent(entryId)}`;
}

/**
 * Species name without the colour: `Tussock Pennata - Yellow` -> `Tussock Pennata`.
 *
 * Canonn keys everything by variant; EDEXO's species tree does not know colours at all. This is the
 * join between them, and it is a split on the separator rather than a lookup because the colour
 * vocabulary differs per genus and no table of it would stay right.
 */
export function speciesNameOf(entryName: string): string {
  const i = entryName.indexOf(" - ");
  return (i === -1 ? entryName : entryName.slice(0, i)).trim();
}
