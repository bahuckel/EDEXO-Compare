import type { SpeciesEntry } from "./species.js";

/** One row for the Encyclopedia UI (resolved photo URL on the server). */
export interface EncyclopediaSpeciesRowDTO {
  entry: SpeciesEntry;
  /** Vista Genomics list price (CR) from `data/price-list.json`; first footfall pays five times it. */
  priceCredits?: number | null;
  photoUrl: string;
  photoNote: string | null;
  /**
   * Every photograph of this species, {@link photoUrl} first.
   *
   * A species can have several — the same organism on a different world, by a different commander —
   * and the viewer steps through them. Optional so a payload written before galleries existed still
   * parses; a reader that finds it absent should treat `[photoUrl]` as the whole set.
   */
  photoUrls?: string[];
  /**
   * Photographs of the specific colour variants, when someone has taken them.
   *
   * The app works out which variant a body will grow, and the owner is photographing the variants
   * themselves. Apart, each is a curiosity; together they let the card show the plant the commander
   * is actually going to find rather than one of its siblings.
   */
  photoVariants?: { url: string; colour: string }[];
  /**
   * Photographs that are not ED-DSN's, by URL.
   *
   * Only the exceptions travel — the shipped images are ED-DSN's and carry the standing credit — so
   * this is a handful of entries or absent entirely. Crediting a commander's own photograph to
   * somebody else is the one mistake this area of the project has been careful about.
   */
  photoCreditByUrl?: Record<string, { name: string; url?: string; licence?: string }>;

  /**
   * Count of per-body EDSM / CSV / JSON row exports when present.
   * Feeder profile cards use {@link exomasteryProfileFilePresent} instead.
   */
  exomasteryEdsmSampleCount: number;
  /**
   * Bodies from feeder for this species: profile JSON `sampleCount` (distinct EDSM planets analyzed)
   * or, when no profile, same as {@link exomasteryEdsmSampleCount}.
   */
  exomasteryFeederBodyCount: number;
  /** `*_exomastery*.json` loads as a usable feeder profile (mode/mean rollups). */
  exomasteryProfileFilePresent: boolean;
  /** Encyclopedia can open inline Exomastery (profile and/or at least one EDSM row). */
  exomasteryEncyclopediaAvailable: boolean;
  /**
   * Single-sample warning: profile rollup `count === 1` or exactly one EDSM row (no multi-sample cohort).
   * When unknown counts on profile (`max count` 0), this stays false.
   */
  exomasteryDataInsufficient: boolean;
}

export type EncyclopediaExomasteryFieldTier = "blue" | "green" | "yellow" | "orange" | "red";

/** Chart payload: min/max/mode from exomastery feeder rollup (or EDSM column sample min/max); `current` = BODY marker only. */
export interface ExomasteryStatDistributionDTO {
  min: number;
  max: number;
  mode: number;
  current: number | null;
  /**
   * The observed distribution, when the profile carries a histogram for this parameter (B7).
   *
   * Present: the chart draws what was actually counted, and a species that lives at two separate
   * temperatures looks like two humps. Absent: the chart falls back to a bell curve around the mode,
   * which is a drawing rather than a measurement — the exact summary B7 was raised to replace.
   *
   * Bins come from the globally shared edges, so they are equal-population across the corpus and
   * therefore **unequal width**. The chart plots count ÷ width for that reason; anything else would
   * make a wide bin look tall for being wide.
   */
  bins?: { x0: number; x1: number; count: number }[];
  /** Server path used for unit formatting (e.g. body.materials.Fe, EDSM column key). */
  displayPath: string;
  minLabel: string;
  maxLabel: string;
}

/** One trait on one planet in Encyclopedia exomastery breakdown. */
export interface EncyclopediaExomasteryFieldDTO {
  id: string;
  columnKey: string;
  label: string;
  valueDisplay: string;
  /** Feeder profile: mean (μ); EDSM row: cohort mean — shown as “Typical”. */
  typicalDisplay?: string;
  /** Feeder profile: mode; EDSM row: this body’s value — shown as “Mode”. */
  modeDisplay?: string;
  /** Pre-formatted deviation (e.g. `12.3%`). */
  deviationDisplay?: string;
  tier: EncyclopediaExomasteryFieldTier;
  /** Deviation from mean (numeric) or 100×(1−frequency) for categorical rarity vs sample. */
  deviationPercent: number;
  contextNote: string;
  distribution?: ExomasteryStatDistributionDTO | null;
}

/** Grouped traits (atmosphere / surface / orbit / misc) for encyclopedia cards. */
export interface EncyclopediaExomasterySectionDTO {
  title: string;
  fields: EncyclopediaExomasteryFieldDTO[];
}

/** One planet / CSV row with all comparable traits. */
export interface EncyclopediaExomasteryPlanetDTO {
  index: number;
  title: string;
  /** Flat list (legacy); prefer {@link sections} when present. */
  fields?: EncyclopediaExomasteryFieldDTO[];
  sections?: EncyclopediaExomasterySectionDTO[];
}

export interface EncyclopediaExomasteryPlanetsResponseDTO {
  speciesEntryId: string;
  displayName: string;
  genusDataDir: string;
  sampleCount: number;
  /** `profile` = feeder JSON rollups (mode vs μ); `edsm` = per-body row cohort. */
  source?: "profile" | "edsm";
  planets: EncyclopediaExomasteryPlanetDTO[];
  /**
   * When the client passes `focusBodyKey` (BODY tab) and this species has a feeder profile:
   * merged journal scan vs profile — same math as Similarity index. Shown even if the species is
   * not a candidate on that planet.
   */
  focusBody?: EncyclopediaExomasteryFocusBodyDTO | null;
}

/** One row in the Exomastery breakdown modal (scan vs typical habitat). */
export interface ExomasteryStatDetailDTO {
  id: string;
  kind: "numeric" | "material" | "atmosphere" | "solid" | "categorical";
  /** Original feeder path (for grouping in UI); optional on older payloads. */
  chartPath?: string;
  label: string;
  typicalDisplay: string;
  currentDisplay: string;
  /** When true, this stat is not in the journal/DSS merge — it does not affect similarity. */
  isMissing: boolean;
  /** |current − typical| in percentage points (materials / gas / solid %). */
  diffPoints: number | null;
  /** |current − typical| / max(|typical|, ε) × 100 for scalar numerics; null if not applicable. */
  diffRelativePercent: number | null;
  /** Relative difference exceeds 200% — UI shows a capped message instead of a huge number. */
  diffHuge?: boolean;
  /** Compact crust / atmo composition rows: ▲ green, ▼ red, — yellow (≤1 pp), none if missing. */
  chevron: "up" | "down" | "dash" | "none";
  compact: boolean;
  /** When kind is categorical and the row is not missing: how close scan is to modal after normalization (e.g. atmosphere). */
  categoricalCloseness?: "match" | "close" | "different";
  /**
   * Host-star MK tiers: `{@link categoricalCloseness}` ignored for duplex color — 0 = match … 4+ = farthest → red tier.
   * Only set on spectral / luminosity / host-subclass categorical rows vs EDSM cohort.
   */
  stellarProximitySteps?: number | null;
  stellarProximityAxis?: "spectral" | "subclass" | "luminosity";
  /** Distribution chart uses feeder min/max only; `current` marks BODY (SVG), not axis endpoints. */
  distribution?: ExomasteryStatDistributionDTO | null;
}

/** Aggregate match quality for one composition group (crust / atmosphere / solid). */
export interface ExomasteryCompositionSummaryDTO {
  overallMatchPercent: number | null;
  best: { label: string; matchPercent: number } | null;
  worst: { label: string; matchPercent: number } | null;
}

export interface ExomasteryCompositionGroupDTO {
  id: "crust" | "atmosphere" | "solid";
  title: string;
  summary: ExomasteryCompositionSummaryDTO;
  rows: ExomasteryStatDetailDTO[];
}

/** Full comparison table for pop-up when clicking Similarity Index. */
export interface ExomasteryDetailDTO {
  stats: ExomasteryStatDetailDTO[];
  compositionGroups: ExomasteryCompositionGroupDTO[];
  /** Surface temperature + gravity numerics (subset of profile paths) — shown under the Atmosphere modal section. */
  atmosphereClimateStats?: ExomasteryStatDetailDTO[];
}

/** Exomastery vs the planet selected in the main UI BODY: tab (merged FSS/DSS journal scan). */
export interface EncyclopediaExomasteryFocusBodyDTO {
  bodyKey: string;
  bodyTabLabel: string;
  starSystem: string;
  planetClass: string | null;
  /** 0–100 weighted habitat quality; null when {@link unavailableReason} is set. */
  habitatMatchPercent: number | null;
  unavailableReason: string | null;
  /** Duplex field breakdown (Typical vs This body); null when scan data is insufficient. */
  detail: ExomasteryDetailDTO | null;
}

/** Compact comparison chip for Candidate species — Other match details. */
export interface OtherMatchDetailCardDTO {
  id: string;
  /** Lower sorts earlier. */
  priority: number;
  shortTitle: string;
  topLegend: string;
  topValue: string;
  bottomLegend: string;
  bottomValue: string;
  tooltip: string;
  /** Same deviation tiers as encyclopedia / habitat rows: closer match → blue/green; farther → orange/red. */
  highlight?: EncyclopediaExomasteryFieldTier | "neutral";
}

/** One row for “lowest variety / strongest mode” hints from the feeder profile (no planet context). */
export interface ExomasteryVarietyItemDTO {
  id: string;
  label: string;
  /** 0–100 — higher means the sample clusters more tightly on one value (categorical mode share or tight numeric band). */
  concentrationPercent: number;
}
