/**
 * The atmospheres a species is recorded on but almost never wins.
 *
 * A species row's `atmosphere` list says where a species *can* grow. It says nothing about where it
 * usually loses to a sibling, and for a generalist that difference is the whole story.
 *
 * Bacterium tela is the case that forced this. Its row is `"atmosphere": "Any thin atmosphere"`, so
 * every landable thin-atmosphere body passes, and the corpus agrees it has been found on nine
 * different atmospheres. But the game places **one genus per biological signal**, so within a genus
 * the species are rivals for one slot, and measured against its own siblings across 14,136 corpus
 * bodies tela is not a generalist at all:
 *
 * ```
 * atmosphere        tela's share of the genus's bodies there
 * Neon-rich          57.9 %   (11 of 19)
 * Water              47.4 %   (623 of 1,315)
 * Methane             9.1 %
 * Sulphur dioxide     8.3 %
 * Carbon dioxide      0.3 %   (20 of 6,904)
 * Ammonia             0.3 %   (8 of 2,522)
 * Nitrogen            0.3 %   (1 of 349)
 * Argon               1.8 %   (16 of 889)
 * ```
 *
 * On carbon dioxide it wins three bodies in a thousand. That is a different claim from "it does not
 * grow there", which is why this **demotes rather than excludes**: the row keeps its place behind
 * "show unlikely", carrying the reason, and the twenty corpus bodies that really are tela on CO₂ are
 * still reachable.
 *
 * Crust materials cannot do this job, incidentally, and it is worth recording so nobody tries again:
 * every Bacterium body carries exactly one grade-4 and exactly two grade-3 materials — tela 99.8 %,
 * the rest of the genus 99.8 %, lift 1.00× — so the material a colour is read from separates nothing
 * within a genus.
 */

/** Flatten `Thin Sulphur dioxide`, `SulphurDioxide` and `sulphur dioxide` to one key. */
export function atmospherePreferenceKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^(hot\s+|cold\s+)?(thin|thick)\s+/, "")
    .replace(/[\s_-]+/g, "");
}

export interface AtmospherePreferenceVerdict {
  /** The atmosphere that matched, in the row's own spelling. */
  matched: string;
}

/**
 * Is this body's atmosphere one the species is recorded on but rarely wins?
 *
 * Returns null when the species names none, when the body's atmosphere is unknown, or when the
 * atmosphere is not on the list — all of which mean "say nothing", never "demote".
 */
export function atmosphereIsUnfavoured(
  unfavoured: readonly string[] | null | undefined,
  bodyAtmosphere: string | null | undefined,
): AtmospherePreferenceVerdict | null {
  if (!unfavoured?.length) return null;
  const key = atmospherePreferenceKey(String(bodyAtmosphere ?? ""));
  if (!key) return null;
  for (const entry of unfavoured) {
    if (atmospherePreferenceKey(entry) === key) return { matched: entry };
  }
  return null;
}
