/**
 * A boolean that remembers where it came from and when — INCLUDE-BODY-IDS Phase 3.
 *
 * Footfall and mapping are not properties of a body. They are *claims about a moment*, and the
 * difference matters more here than almost anywhere else in the app: the gap between "nobody has
 * landed" and "we have not looked" is a **×5 payout**, and the gap between a map from last month and
 * one from 2019 is the difference between "somebody competent declined this" and "somebody wanted
 * the cartographic payout years before plants could be collected at all".
 *
 * So the value is a tri-state and it travels with its provenance. Three rules, and each exists
 * because getting it wrong costs a specific thing:
 *
 * 1. **Never default to `false`.** `null` means nobody has told us. A silent `false` would present
 *    the absence of evidence as evidence of absence, which is the failure the six accuracy rescues
 *    of §40–§44 spent their whole effort eliminating in a different field.
 * 2. **`true` is sticky.** Footfall is monotone — a body that has been landed on never becomes
 *    un-landed — and mapping likewise. A later `false` is stale information, not a correction, so it
 *    never overwrites a `true` **whatever its timestamp says**. This is the one place where a newer
 *    observation deliberately loses.
 * 3. **`false` carries its age**, and only the freshest `false` is kept. It was true when it was
 *    observed and it only ever gets staler; the UI must be able to say *as of when*.
 *
 * Source ranking does **not** override any of that. A journal `false` never beats a network `true`,
 * because rule 2 is about the physics of the flag rather than about who is more trustworthy.
 */

/** Where an observation came from, most authoritative first. */
export type ObservationSource =
  /** This commander's own journal — `Disembark`, `Scan`, `SAAScanComplete`. */
  | "journal"
  /** EDDN's live stream: `Scan.WasFootfalled` / `Scan.WasMapped` uploaded by someone else. */
  | "eddn"
  /** Derived from a Spansh dump — a genus list implies a DSS map (INCLUDE-BODY-IDS §8.9). */
  | "spansh";

export interface ObservedFlag {
  /** `true` / `false` / `null` — and `null` is a real answer, not a missing one. */
  value: boolean | null;
  source: ObservationSource | null;
  /** ISO 8601, the moment the observation describes — not the moment we stored it. */
  seenAt: string | null;
}

export const UNOBSERVED: ObservedFlag = Object.freeze({ value: null, source: null, seenAt: null });

/** An observation as a source reports it. */
export interface Observation {
  value: boolean;
  source: ObservationSource;
  /** ISO 8601. A source that cannot say when should pass the moment it was read. */
  seenAt: string;
}

function isNewer(a: string | null, b: string | null): boolean {
  if (a === null) return false;
  if (b === null) return true;
  // Lexical comparison is correct for ISO 8601 with the same offset, and both sides here are
  // journal timestamps (always `Z`) or dump timestamps normalised to it.
  return a > b;
}

/**
 * Fold one observation into what is already known.
 *
 * Pure, total, and order-independent for the cases that matter: feeding the same set of
 * observations in any order lands on the same flag, which is what makes a re-scan of the journals
 * or a replayed EDDN batch idempotent.
 */
export function mergeObservation(current: ObservedFlag, next: Observation): ObservedFlag {
  // Rule 2: a `true` is permanent. Nothing demotes it — not a newer `false`, not a better source.
  if (current.value === true) {
    if (next.value !== true) return current;
    // Two `true`s: keep the earlier one. It is the more informative claim, because it says the
    // body was already in that state at that time.
    return isNewer(current.seenAt, next.seenAt)
      ? { value: true, source: next.source, seenAt: next.seenAt }
      : current;
  }

  // Rule 2 again, from the other side: any `true` wins over `false` or unknown, immediately.
  if (next.value === true) return { value: true, source: next.source, seenAt: next.seenAt };

  // Both false (or unknown so far). Rule 3: keep the freshest, because a `false` decays.
  if (current.value === false && !isNewer(next.seenAt, current.seenAt)) return current;
  return { value: false, source: next.source, seenAt: next.seenAt };
}

/** Fold many observations. Order-independent by construction — see {@link mergeObservation}. */
export function mergeObservations(observations: readonly Observation[]): ObservedFlag {
  let flag: ObservedFlag = UNOBSERVED;
  for (const o of observations) flag = mergeObservation(flag, o);
  return flag;
}

/** Milliseconds since the observation, or null when there is nothing to age. */
export function observationAgeMs(flag: ObservedFlag, now: number = Date.now()): number | null {
  if (!flag.seenAt) return null;
  const t = Date.parse(flag.seenAt);
  return Number.isFinite(t) ? Math.max(0, now - t) : null;
}

/**
 * How stale an observation is, in words, or null when there is nothing to say.
 *
 * Deliberately coarse. The commander needs "is this from this week or from before Odyssey", not a
 * duration to the minute, and a precise number would imply a precision the claim does not have.
 */
export function observationAgeLabel(flag: ObservedFlag, now: number = Date.now()): string | null {
  const ms = observationAgeMs(flag, now);
  if (ms === null) return null;
  const days = ms / 86_400_000;
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 31) return `${Math.round(days)} days ago`;
  if (days < 365) return `${Math.max(1, Math.round(days / 30))} months ago`;
  const years = days / 365;
  return years < 1.5 ? "about a year ago" : `${Math.round(years)} years ago`;
}

/**
 * Odyssey's release — the moment exobiology became collectable.
 *
 * A map older than this was made for the cartographic payout by somebody who *could not* have taken
 * the plants, so it says nothing about whether the biology is still there. §1.5's second trap, and
 * the reason rung 2 of the target ladder is worthless without a date.
 */
export const ODYSSEY_RELEASE_ISO = "2021-05-19T00:00:00Z";

/** Whether a mapping observation predates exobiology, and so implies nothing about the plants. */
export function predatesExobiology(flag: ObservedFlag): boolean {
  if (flag.value !== true || !flag.seenAt) return false;
  const t = Date.parse(flag.seenAt);
  return Number.isFinite(t) && t < Date.parse(ODYSSEY_RELEASE_ISO);
}

/**
 * The target ladder of INCLUDE-BODY-IDS §2.7, as a single verdict.
 *
 * Ordered by the owner's reasoning, which inverts the obvious one: **a map is evidence of a missed
 * opportunity, not a gift.** The named genera helped whoever mapped it, and if they were worth
 * anything that person very likely went down and took them.
 */
export type TargetRung = "unopened" | "mapped-not-walked" | "walked" | "unknown";

export function targetRung(footfall: ObservedFlag, mapped: ObservedFlag): TargetRung {
  if (footfall.value === true) return "walked";
  if (mapped.value === true) return "mapped-not-walked";
  // Rung 1 requires *both* flags observed false. One `false` and one unknown is not "unopened" —
  // that is the absence of evidence this module exists to keep separate.
  if (footfall.value === false && mapped.value === false) return "unopened";
  return "unknown";
}

/** The freshest evidence behind a rung, so the UI can show the age the rung actually rests on. */
export function rungEvidence(rung: TargetRung, footfall: ObservedFlag, mapped: ObservedFlag): ObservedFlag {
  switch (rung) {
    case "walked":
      return footfall;
    case "mapped-not-walked":
      return mapped;
    case "unopened":
      // Both are false; the rung is only as good as the *older* of them, because that is the one
      // that has had longest to go stale.
      return isNewer(footfall.seenAt, mapped.seenAt) ? mapped : footfall;
    default:
      return UNOBSERVED;
  }
}
