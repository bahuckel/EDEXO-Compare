import type { GenusLikelihood } from "../genusCooccurrence.js";
import type { ExomasteryDetailDTO } from "./exomastery.js";
import type { EstimatedSurfaceTempBand, GenusHint, OrganicGenusLock, PlanetScan } from "./scan.js";
import type { ExoPayoutSpeciesLineDTO, SpeciesMatch, SpeciesMatchContext } from "./species.js";

/** Codex vs live scan / feeder consistency (Planetary body panel). */
export interface ExoDataAlertDTO {
  id: string;
  severity: "error" | "warning";
  /** Journal-based checks vs exomastery feeder profile JSON under data/species/.../exomastery/. */
  detectionSource: "journal" | "exomastery";
  title: string;
  detail: string;
  /** Plain text copied when user clicks Fix. */
  fixClipboard?: string;
  /** Populated on the server so Fix can write `fixes_*` stubs next to the right JSON. */
  speciesEntryId?: string;
  genusDataDir?: string;
  /** Journal fields used to generate criteriaPatch (volcanism tokens, etc.); not shown in UI. */
  journalFixHints?: {
    volcanism?: string;
    /**
     * Host `Scan.StarType` (merged parent). Used when codex fails the {@link SpeciesCriterion.parentStarTypeIncludesAnyOf}
     * fragment gate so Fix can append matching fragments to `fixes_*.json`.
     */
    parentStarType?: string;
  };
}

export interface BodyExoState {
  key: string;
  /**
   * A landable body the ship only AutoScanned on arrival: the game sends no `FSSBodySignals` for those,
   * so whether it carries biology is unknown until the commander resolves it in the FSS (owner,
   * 2026-10-02). Shown as a tab, "AutoScanned only - FSS required"; built in snapshot.ts, never stored.
   */
  autoScanOnly?: boolean;
  bodyName: string;
  bodyId: number;
  systemAddress: number;
  starSystem: string;
  /** From FSSBodySignals Biological Count */
  biologicalSignals: number | null;
  /** From SAASignalsFound after DSS */
  genusHints: GenusHint[] | null;
  dssComplete: boolean;
  scan: PlanetScan | null;
  /**
   * Merged `Type` / `Type_Localised` strings from `FSSBodySignals` and `SAASignalsFound` `Signals` arrays
   * (geological / biological / …). Used for optional exobiology gates (e.g. fumaroles).
   */
  signalHints?: string[] | null;
  /** From ScanOrganic — at most one species per genus on a body; variant label resolves the row. */
  organicGenusLocks: OrganicGenusLock[];
  /** From ScanOrganic / Variant_Localised (legacy list for UI) */
  confirmedVariants: string[];
  updatedAt: string;
  /** Set on a body built from a Spansh lookup, not from this commander's journal. */
  remote?: { source: "spansh"; fetchedAt: string };
}

export interface ExoPayoutRangeDTO {
  minCr: number;
  maxCr: number;
  /** Biological signals (or DSS genus count fallback). */
  slotCount: number;
  /** Whether slot count came from FSS bio count or DSS genus list length. */
  slotSource: "bio_signals" | "genus_hints";
  /** Distinct matched species with a strict list price. */
  pricedCandidateCount: number;
  /** 5 when this commander qualifies for first-footfall organics on this body, else 1. */
  mult: 1 | 5;
  /** Same as `mult === 5` — your commander gets the 5× journal payout on this body. */
  commanderFirstFootfall: boolean;
  /** Latest detailed `Scan.WasFootfalled` if seen in merged journal; null if unknown. */
  journalWasFootfalled: boolean | null;
  /**
   * Set when the system pays no first-footfall bonus: `bubble` (Frontier populated it), `colony`
   * (players did), `colonising` (a claim under construction), `facility` (no people, but security or a
   * controlling faction). See `GameStateStore.systemKind`.
   */
  noFootfallSystemKind?: "bubble" | "colony" | "colonising" | "facility";
  /**
   * Phase 3 provenance for that flag: how old the claim is, in words.
   *
   * A `false` is a statement about a moment, not a property of the body — the ×5 was intact *then*.
   * Null when nothing has been observed, which is a different thing from a fresh `false` and must
   * be drawn differently.
   */
  footfallSeenLabel: string | null;
  /** Whether anyone has DSS-mapped it, as a tri-state, with the same age caveat. */
  wasMapped: boolean | null;
  mappedSeenLabel: string | null;
  /**
   * The target ladder of INCLUDE-BODY-IDS §2.7. `unknown` is **not** `unopened` — the first is the
   * absence of evidence and the second is evidence of absence.
   */
  targetRung: "unopened" | "mapped-not-walked" | "walked" | "unknown";
  /** Age of the observation the rung actually rests on, so the UI never shows a rung bare. */
  rungSeenLabel: string | null;
  /** A map from before Odyssey says nothing about plants — nobody could collect them yet (§1.5). */
  mappedPredatesExobiology: boolean;
  /** `slotCount` exceeds priced species (range uses `pricedCandidateCount` terms only). */
  incomplete: boolean;
  /** The `k` cheapest distinct priced species (`k` = min(slots, pricedCandidateCount)); sums to `minCr`. */
  minTotalSpecies: ExoPayoutSpeciesLineDTO[];
  /** The `k` priciest distinct priced species; sums to `maxCr`. */
  maxTotalSpecies: ExoPayoutSpeciesLineDTO[];
}

/** Ratios 0…0.5 from user sliders 0…50% — DSS / lone-genus physical gate slack. */
/**
 * The signal-count rule.
 *
 * The game reports how many biological signals a body carries in `FSSBodySignals`, before the
 * commander travels anywhere, and it places **one genus per signal — never the same genus twice**.
 * So comparing the number of candidate genera with the signal count turns a list into a verdict:
 *
 * - `certain`   — as many candidate genera as signals, so every one of them is present. No trip
 *                 needed to know what is there.
 * - `ambiguous` — more candidates than signals: `k` of these genera are present, not all.
 * - `underCovered` — fewer candidates than signals, which is impossible in the game and therefore a
 *                 defect in our data: a gate is excluding a genus that is really there.
 */
export interface GenusCertaintyDTO {
  /**
   * `bestGuess`: the count only matches because rows the gates had demoted were put back to fill it
   * (`SpeciesMatch.restoredForSignalCount`). The game says something is there; our data says these
   * are the least-bad fits, not that they are right.
   */
  status: "certain" | "ambiguous" | "underCovered" | "bestGuess";
  /** Biological signals the game reports for this body. */
  signalCount: number;
  /** Distinct candidate genera the matcher offered. */
  candidateGenera: number;
  /** Display names of the candidate genera, sorted. */
  genera: string[];
  /** With `bestGuess`: the genera that are on the list only because they were put back. */
  restoredGenera?: string[];
}

export interface BodyComputed {
  state: BodyExoState;
  /**
   * `Scan` merged with {@link ExplorationScanRecord} for this body (materials, orbit fields, …).
   * Use for UI + matching when `state.scan` was never set at detailed honk-time (different system focused).
   */
  mergedScan: PlanetScan | null;
  /** Journal-only duplex breakdown (Planetary DSS / scan detail modal) — no feeder “typical” column semantics. */
  bodyScanDetail: ExomasteryDetailDTO | null;
  /** Short tab label: body designation without star system prefix when the journal name includes it. */
  tabLabel: string;
  matches: SpeciesMatch[];
  /** True when genus hints exist and were used to filter */
  genusFilterActive: boolean;
  /** Message when signals < candidate genera etc. */
  ambiguityNote: string | null;
  /**
   * Candidate genera vs the FSS signal count. Null when the body has no signal count or no usable
   * scan. See {@link GenusCertaintyDTO} — this is the difference between "one of these twelve" and
   * "these three, guaranteed".
   */
  genusCertainty: GenusCertaintyDTO | null;
  /**
   * Candidate genera in likelihood order, most likely first — ordering only.
   *
   * The `probability` each row carries is honest arithmetic over the co-occurrence corpus, and it is
   * **not calibrated**: measured against 51 landed bodies its reliability curve is non-monotonic and
   * its Brier score is worse than assuming every candidate equally likely. So it orders the list and
   * nothing renders it as a number (acceptance rule 3). Null when there is no signal count, no
   * co-occurrence table, or fewer candidates than signals.
   */
  genusLikelihoods: GenusLikelihood[] | null;
  /** Estimated viable surface temperature band from scan heuristics; null if planet class could not be mapped. */
  estimatedSurfaceTempK: EstimatedSurfaceTempBand | null;
  /**
   * Built with the same rules as strict species matching (host star, orbit LS, signal hints, pressure atm).
   * Populated when {@link state.scan} exists; null when there is no usable body scan.
   */
  speciesMatchContext: SpeciesMatchContext | null;
  /**
   * True when a candidate is listed on the strength of an on-foot `ScanOrganic` rather than the
   * gates. The four distance-guessing fallbacks that used to set this were removed once they
   * measured zero firings across 13,713 bodies.
   */
  approximateMatchingUsed: boolean;
  /** Total CR band if you sell one sample per bio slot from current candidates (updates with DSS / on-foot / Include Bacterium). */
  /**
   * Why this body is showing candidates at all.
   *
   * `conditions` means an auto scan described the body and nothing has counted its organics — the
   * game shows a signal count on screen but never writes one to the journal until an FSS or a DSS.
   * The candidate list is then "what could live here", not "what is here", and the UI has to say so.
   */
  exoMarkerBasis?: "scanned" | "genus" | "signals" | "conditions" | "none";
  exoPayoutRange: ExoPayoutRangeDTO | null;
  /**
   * Live organic / feeder checks vs genus JSON — errors (red) and warnings (yellow).
   * Dismiss state is client-only (localStorage).
   */
  exoDataAlerts: ExoDataAlertDTO[];
  /**
   * DSS genus hints with no candidate row in that genus (for (!) markers next to the genus label).
   */
  dssGenusOrphanHints: GenusHint[];
  /** One per signal the candidate list cannot fill (shared/unknownPlants.ts): the "Unknown plant" rows. */
  unknownPlants?: import("../unknownPlants.js").UnknownPlantSlot[];
}

export interface OrganicPendingLineItem {
  bodyKey: string;
  bodyName: string;
  starSystem: string;
  speciesLabel: string;
  /** Typical row from price list before multiplier; null if unknown. */
  baseCredits: number | null;
  /** baseCredits × multiplier when base known; otherwise 0. */
  valueCredits: number;
  firstFootfall: boolean;
  /** Total multiplier on list price: 5 when first footfall (1× + 4× bonus), else 1. */
  multiplier: 1 | 5;
  /** Species illustration URL (resolved from DB match on organic label). */
  photoUrl: string;
}
