/**
 * Which payout to show: ×1, ×5, or both because nobody knows yet.
 *
 * A body pays list price for its organics, five times that if the commander is the first to set foot
 * on it. Whether that bonus is available is a **fact about the world** that the journal sometimes
 * reports and sometimes has never mentioned, so there are three states and not two.
 *
 * The app used to show both figures always. That is right while the answer is unknown and wrong the
 * moment it is not: once a scan has said somebody already landed here, a ×5 column beside the real
 * number is an invitation to read the wrong one, and the commander only finds out after the trip.
 * Equally, once a scan says nobody has, the ×1 is no longer the number they will be paid.
 *
 *   walked   → ×1 only. The bonus is gone and is never coming back; footfall is permanent.
 *   unwalked → ×5 only. This is what the trip is worth, and it is the whole point of the app.
 *   unknown  → both, because either could be true and saying so is the honest answer.
 *
 * "Unknown" is the common case and must not be dressed up as opportunity: `WasFootfalled` did not
 * exist in the journal before 2025-09-29, so on older scans the field is absent rather than false.
 */

export type FootfallCertainty = "walked" | "unwalked" | "unknown";

/**
 * Read the three-state answer from what the journal has said.
 *
 * `commanderFirstFootfall` wins where it is set: if this commander is already flagged for the bonus
 * on this body, the question is settled in their favour whatever a stale scan says.
 */
export function footfallCertainty(input: {
  /** Latest `Scan.WasFootfalled`; null when nothing has ever reported it. */
  journalWasFootfalled: boolean | null;
  /** This commander qualifies for the bonus here. */
  commanderFirstFootfall?: boolean;
}): FootfallCertainty {
  if (input.commanderFirstFootfall === true) return "unwalked";
  if (input.journalWasFootfalled === true) return "walked";
  if (input.journalWasFootfalled === false) return "unwalked";
  return "unknown";
}

/** Whether to draw the plain list price. True unless we know the bonus is available. */
export function showsListPrice(c: FootfallCertainty): boolean {
  return c !== "unwalked";
}

/** Whether to draw the first-footfall price. True unless we know somebody has been here. */
export function showsFootfallPrice(c: FootfallCertainty): boolean {
  return c !== "walked";
}

/** The multiplier a payout should actually use, or null while both are still possible. */
export function settledMultiplier(c: FootfallCertainty): 1 | 5 | null {
  if (c === "walked") return 1;
  if (c === "unwalked") return 5;
  return null;
}

/** One line explaining which figures are on screen and why. */
export function footfallValueNote(c: FootfallCertainty, seenLabel?: string | null): string {
  const age = seenLabel ? ` (${seenLabel})` : "";
  if (c === "walked") {
    return `Somebody has landed here${age}. Footfall is permanent, so this pays list price — the ×5 is gone.`;
  }
  if (c === "unwalked") {
    return `Nobody had landed here${age}, so the first-footfall bonus is what this is worth.`;
  }
  return "Nothing has reported whether anybody has landed here, so both payouts are still possible.";
}
