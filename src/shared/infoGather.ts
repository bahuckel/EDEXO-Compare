/**
 * Which species the app cannot fully answer for, so the commander knows where a sample is worth more
 * than its credits.
 *
 * Two different gaps wear one label, because to somebody deciding whether to land they are the same
 * question — *can you tell me what I would find here?*
 *
 * - **Thin data.** The corpus has few bodies for this species and the commander has confirmed it few
 *   times. Computed server-side (`server/collectionFocus.ts`) from a local-only file; it arrives on
 *   the match as `collectionFocus`.
 * - **The colour is not decided.** Either no rule resolves on this body, or two of them do and the
 *   honest answer is "Blue or Red". The second is the grade-4 material precedence — five observations
 *   fit `cadmium < molybdenum < tin < niobium/mercury/tungsten` and roughly forty would settle it,
 *   after which omentum, scopulum, tela, verrata and Concha renibus stop hedging for good.
 *
 * Sampling any of them teaches the app something, which is the entire reason for marking them.
 *
 * Kept out of the component so the rule can be tested on its own and reused — the HUD's candidate
 * list is the obvious next place for it.
 */

export type InfoGatherReason = "thin-data" | "colour-unknown" | "colour-ambiguous";

/** The `" or "` form the colour resolver uses when the evidence allows more than one answer. */
const AMBIGUOUS = " or ";

/**
 * Why this row cannot be fully answered, in the order worth reading. Empty means the app knows
 * enough: the row is an ordinary prediction and gets no mark.
 *
 * `colourLabel` is what `candidateMorphColorShortLabel` produced — `"(unknown)"`, `"Lime"`, or
 * `"Blue or Red"`. An empty string counts as unknown, because that is what an absent label means.
 */
export function infoGatherReasons(args: {
  collectionFocus?: boolean;
  colourLabel?: string | null;
}): InfoGatherReason[] {
  const out: InfoGatherReason[] = [];
  if (args.collectionFocus === true) out.push("thin-data");

  const label = (args.colourLabel ?? "").trim();
  if (!label || label === "(unknown)") out.push("colour-unknown");
  else if (label.includes(AMBIGUOUS)) out.push("colour-ambiguous");

  return out;
}

/** True when the row should carry the mark at all. */
export function needsInfoGather(args: { collectionFocus?: boolean; colourLabel?: string | null }): boolean {
  return infoGatherReasons(args).length > 0;
}
