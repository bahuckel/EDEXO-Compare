/**
 * What colour a place on the galaxy map should be, and why that is not the same as what is known
 * about it.
 *
 * ## The rule that matters: show what is left, not what is best
 *
 * The obvious implementation picks the strongest evidence in a sector and colours by that. It is
 * wrong, and wrong in the direction that costs the commander something. A sector holding a thousand
 * plants where they have scanned one would come out "you have scanned everything here" — the single
 * most discouraging thing the map could say, and false.
 *
 * So the ladder is ordered by **what is still worth going for**, and "done" sits at the bottom where
 * it can only win when nothing else is true. `DONE` means every body the commander knows about in
 * that place has been scanned by them; the moment one is outstanding, the map says so instead.
 *
 * ## The ladder
 *
 *   MISSED     you have been here and left biology unscanned    — the strongest call to action
 *   CONFIRMED  somebody else logged a species; you have not
 *   GENUS      a DSS named the genus, nobody has named the species
 *   SIGNALS    an FSS counted signals, nothing has named them
 *   BARREN     bodies are known and none carries a signal
 *   DONE       you have scanned everything you know of here
 *
 * `BARREN` needs a source that says "this system has bodies and none has life", which the current
 * export cannot provide — it only carries systems that *do* have biology. It is in the ladder so the
 * gap is visible rather than forgotten.
 */

export type GalaxyTier = "missed" | "confirmed" | "genus" | "signals" | "barren" | "done";

/** Ladder order, most actionable first. Index doubles as the comparison key. */
export const TIER_ORDER: readonly GalaxyTier[] = [
  "missed",
  "confirmed",
  "genus",
  "signals",
  "barren",
  "done",
] as const;

export interface TierStyle {
  /** Fill, or null when the marker is drawn hollow. */
  fill: string | null;
  stroke: string;
  label: string;
  help: string;
}

/**
 * The owner's own scheme.
 *
 * Green for your own work either way — filled when it is finished, hollow when it is not, because
 * "I have been here" and "I have finished here" are the same fact at two stages and should read as
 * one colour at two stages. Everything below is somebody else's knowledge, cooling from blue to red
 * as it gets vaguer.
 *
 * Hollow is reserved: on this map it now means exactly one thing, "your unfinished business". It
 * used to mean three — backdrop showing through, evidence being a possibility, footfall unverified —
 * and the owner reasonably read a green hollow sector marker as his own tier when it was not.
 */
export const TIER_STYLE: Record<GalaxyTier, TierStyle> = {
  missed: {
    fill: null,
    stroke: "#3fb950",
    label: "You missed some",
    help: "You have been here and left biology unscanned. Yours to finish.",
  },
  confirmed: {
    fill: "#58a6ff",
    stroke: "#58a6ff",
    label: "Species confirmed",
    help: "Another commander logged a species here. You have not scanned it.",
  },
  genus: {
    fill: "#d9c04a",
    stroke: "#d9c04a",
    label: "Genus known",
    help: "Somebody mapped a body with probes, so the genus is known but not the species.",
  },
  signals: {
    fill: "#e8813a",
    stroke: "#e8813a",
    label: "Signals only",
    help: "An FSS counted biological signals. Nothing has named them.",
  },
  barren: {
    fill: "#c0392b",
    stroke: "#c0392b",
    label: "Nothing found",
    help: "The bodies here are known and none carries a biological signal.",
  },
  done: {
    fill: "#3fb950",
    stroke: "#3fb950",
    label: "You scanned it all",
    help: "Every body you know of here has been scanned by you.",
  },
};

/** What is known about one place, from the commander's journal and from everyone else's data. */
export interface TierFacts {
  /** The commander has been here. */
  visited: boolean;
  /** Bodies here the commander has scanned on foot. */
  scannedByYou: number;
  /**
   * Bodies here carrying biology the commander has *not* scanned.
   *
   * The number that decides `MISSED`, and the reason this cannot be a "strongest evidence" ladder:
   * one outstanding body outranks a thousand finished ones.
   */
  unscannedByYou: number;
  /** Somebody has logged a species here. */
  confirmedElsewhere: boolean;
  /**
   * Bodies with biology anybody has recorded here, from the corpus.
   *
   * The commander's own journal only knows the bodies they personally scanned or honked. A sector
   * can hold 378 recorded bodies while their journal knows of one — and with only the journal to go
   * on, scanning that one reads as finishing the sector. This is the denominator that stops it.
   */
  knownBodies?: number;
  /** A DSS genus list exists here. */
  genusKnown: boolean;
  /** An FSS counted biological signals here. */
  signals: boolean;
  /** Bodies are known and none has a signal. Absent from the current data; see the header. */
  knownBarren?: boolean;
}

/**
 * Pick the tier.
 *
 * Order is the whole content of this function: it is a ladder walked top-down, and `done` is last so
 * it can only be reached when there is genuinely nothing outstanding.
 */
export function tierFor(f: TierFacts): GalaxyTier {
  // Anything of yours left unfinished outranks everything, however much is already done here.
  if (f.unscannedByYou > 0) return "missed";
  /*
   * More recorded here than you have scanned means there is more to find, even when your own
   * journal has nothing outstanding — you cannot have missed what you never saw.
   *
   * Caught in the field on Dryooe Flyou: 378 bodies recorded, one scanned, and the map said "you
   * scanned it all". The two counts have different denominators and comparing them is a heuristic,
   * but the alternative is telling a commander they have finished a sector they have barely entered.
   */
  const moreOutThere = (f.knownBodies ?? 0) > f.scannedByYou;
  if (f.confirmedElsewhere || (moreOutThere && f.scannedByYou > 0)) return "confirmed";
  if (f.genusKnown) return "genus";
  if (f.signals) return "signals";
  if (f.knownBarren) return "barren";
  // Only now: you have been here, nothing is outstanding, and nobody else knows of anything either.
  if (f.visited && f.scannedByYou > 0) return "done";
  return "signals";
}

/** Lower is more actionable. For sorting, and for choosing between two places at once. */
export function tierRank(t: GalaxyTier): number {
  const i = TIER_ORDER.indexOf(t);
  return i < 0 ? TIER_ORDER.length : i;
}

/** The more actionable of two tiers — what a sector holding both should be drawn as. */
export function mostActionable(a: GalaxyTier, b: GalaxyTier): GalaxyTier {
  return tierRank(a) <= tierRank(b) ? a : b;
}
