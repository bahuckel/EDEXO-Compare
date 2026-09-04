import type { JournalHistoryPreset } from "./journalHistoryPreset.js";

export type { JournalHistoryPreset };

/** Elite journal line (subset) */
export interface JournalLine {
  timestamp?: string;
  event?: string;
  [key: string]: unknown;
}

export interface PlanetScan {
  BodyName: string;
  BodyID: number;
  StarSystem: string;
  SystemAddress: number;
  PlanetClass?: string;
  Atmosphere?: string;
  AtmosphereType?: string;
  /** Journal value is **m/s²** (not Earth g). Convert with `/ 9.80665` for g. */
  SurfaceGravity?: number;
  /** Kelvin (journal `Scan` detailed). */
  SurfaceTemperature?: number;
  SurfacePressure?: number;
  /** Journal `Scan` / `Body` semi-major axis in metres (converted to AU for temperature heuristic). */
  SemiMajorAxis?: number;
  TidalLock?: boolean;
  Volcanism?: string;
  Landable?: boolean;
  TerraformState?: string;
  /** From detailed `Scan`: false until someone has claimed first footfall on this body. */
  WasFootfalled?: boolean;
  /** Journal detailed scan: crust material percentages (`Materials`). */
  materials?: { Name?: string; name?: string; Percent?: number; percent?: number }[];
  /** Journal `AtmosphereComposition` on detailed scan. */
  atmosphereComposition?: { Name?: string; name?: string; Percent?: number; percent?: number }[];
  /** Journal `Composition` (ice / rock / metal fractions). */
  composition?: Record<string, number>;
  /** Journal body radius in metres (`Radius`). */
  radius?: number;
  /** Detailed scan: Earth masses (`MassEM`). */
  MassEM?: number;
  /** Seconds (`RotationPeriod`). */
  RotationPeriod?: number;
  /** Radians (`AxialTilt`). */
  AxialTilt?: number;
  OrbitalPeriod?: number;
  Eccentricity?: number;
  OrbitalInclination?: number;
  Periapsis?: number;
  AscendingNode?: number;
  MeanAnomaly?: number;
  /** Journal `Scan.DistanceFromArrivalLS` — distance from system entry point in light-seconds. */
  distanceFromArrivalLs?: number;
}

export interface GenusHint {
  Genus_Localised: string;
  Genus: string;
}

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

/** One confirmed on-foot organic sample on a body (ScanOrganic) — locks that genus to one species. */
export interface OrganicGenusLock {
  genusLocalised: string;
  genusSymbol: string;
  speciesLocalised: string;
  speciesSymbol: string;
  variantLocalised: string;
}

export interface BodyExoState {
  key: string;
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
}

/** Resolved host star MK fields for feeder vs journal comparisons (from parent `Scan`). */
export interface JournalHostStarObservation {
  starTypeRaw: string | null;
  /** Primary coarse slot (Harvard ladder + specials), e.g. `G`, `TTS`. */
  spectralLetter: string | null;
  subclass: number | null;
  luminosity: string | null;
}

/** Optional live context for species matching (star, orbit, FSS signals). Omitted fields = gate skipped. */
export interface SpeciesMatchContext {
  /** Host star `Scan.StarType` after resolving `Parents` (e.g. moons → planet → star). Fragment match only. */
  parentStarType?: string;
  /** Parent star `Subclass` when merged (`Scan`). */
  parentStarSubclass?: number;
  /** Parent star `Luminosity` / Yerkes label when merged. */
  parentStarLuminosity?: string;
  /** Orbit distance from host star: `SemiMajorAxis` (m) / c in LS (not cumulative for nested moons). */
  orbitDistanceFromParentStarLs?: number;
  /** Lowercased hints from scanner signal `Type` / `Type_Localised`. */
  signalHints?: string[];
  /** Surface pressure in atm after `journalPressureToAtm`; `null` / missing when not in scan. */
  surfacePressureAtm?: number | null;
}

export interface SpeciesCriterion {
  planetClassAnyOf?: string[];
  atmosphereTypeAnyOf?: string[];
  /** Earth **g** (compared after converting journal m/s² → g). */
  surfaceGravity?: { min?: number; max?: number };
  surfaceTemperatureK?: { min?: number; max?: number };
  /** Journal SurfacePressure (official docs: atmospheres for landables) */
  surfacePressure?: { min?: number; max?: number };
  landable?: boolean;
  /** Substring match on Volcanism journal field */
  volcanismIncludes?: string[];
  /**
   * When `atmosphereTypeAnyOf` applies, also require estimated / journal temperature band’s upper bound
   * to be ≤ this value K (e.g. CO₂ with “mean temperature below 195 K”).
   */
  whenAtmosphereLinkedMaxTempK?: number;
  /**
   * If set with {@link whenAtmosphereLinkedMaxTempK}, the temperature cap applies only when the scan
   * atmosphere matches one of these journal atmosphere tokens (e.g. CO₂-only on a row that also allows ammonia).
   */
  whenAtmosphereLinkedAtmosphereAnyOf?: string[];
  /** Host star type: any fragment (substring, case-insensitive) must appear in {@link SpeciesMatchContext.parentStarType}. */
  parentStarTypeIncludesAnyOf?: string[];
  /** Orbit distance from host star in light-seconds; only when context provides it. */
  orbitDistanceFromParentStarLs?: { min?: number; max?: number };
  /**
   * Atmosphere pressure class using shared thin threshold (`THIN_ATMOSPHERE_MAX_ATM`, default 0.1 atm after journal conversion).
   * Gate runs only when context exposes surface pressure.
   */
  atmospherePressureCategory?: "thin" | "thick";
  /** Any fragment must match a merged scanner signal hint (geological, etc.). */
  geologicalSignalIncludes?: string[];
  /** If true, require journal volcanism text (same as brain-tree rule) even without `volcanismIncludes`. */
  volcanismActiveRequired?: boolean;
  /** Appended to match reasons when a row passes (terrain / codex wording — not a hard planet-class gate). */
  matchContextNotes?: string[];
}

export interface SpeciesEntry {
  id: string;
  displayName: string;
  genus: string;
  /** Folder name under `data/species/<this>/` where the genus `.json` and `*_photos` live. */
  genusDataDir: string;
  photoFile?: string;
  description: string;
  criteria: SpeciesCriterion;
  /** Optional inline note from the genus JSON row (short). */
  notes?: string;
  /** e.g. `data/species/Stratum/stratum.json` for debugging. */
  dataSourceRelPath?: string;
  /**
   * Set when the species' spawn depends on something a body scan cannot answer — the presence of
   * other body types in the system, or proximity to a nebula. The candidate is still listed (nothing
   * is ever removed, see the no-walls rule), but it is marked so the reader knows the app is not
   * claiming to have predicted it, and so ambiguity can be reported with and without it.
   *
   * Star-type requirements are deliberately *not* included: the parent star is resolvable from the
   * journal, so those are a wiring job rather than an unknowable.
   */
  predictionUnsupported?: {
    /** Short reason, shown to the reader. */
    reason: string;
    /** The condition key that made it unpredictable, for debugging. */
    sourceKey: string;
  };
  /**
   * From genus `meta.color_variants.mapping`: spectral keys (e.g. `O`, `A`) whose value is JSON `null`
   * — codex assigns no colour for that host star class, so the matcher rejects the body when host `StarType` resolves to that key.
   */
  genusStarColorNullSpectralClasses?: string[];
  /**
   * Non-null stellar keys from genus `meta.color_variants.mapping` (single-letter + `TTS` only — material-based maps omitted).
   * Informational “soft” fit in Candidate species UI; matcher does not require host to appear here unless combined with {@link genusStarColorNullSpectralClasses}.
   */
  genusStarColorPreferredSpectralClasses?: string[];
  /** Genus `meta` minimum metres between organic samples (genetic diversity). */
  genusMinSampleDistanceM?: number;
  /** Genus `meta.color_variants.rule` when present. */
  genusColorVariantRule?: string;
  /** Spectral class key (normalised) → codex colour label for star-driven morph tables. */
  genusColorStellarMapping?: Record<string, string>;
  /** True when colour map includes material / composition keys (not only host spectral class). */
  genusColorMaterialDriven?: boolean;
}

export interface SpeciesDatabase {
  species: SpeciesEntry[];
}

/** One row for the Encyclopedia UI (resolved photo URL on the server). */
export interface EncyclopediaSpeciesRowDTO {
  entry: SpeciesEntry;
  photoUrl: string;
  photoNote: string | null;
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

/**
 * Feeder state for the Options panel.
 *
 * The feeder is a maintainer tool: its 250 MB corpus of raw EDSM sample packs never ships, so on a
 * normal install `available` is false and the panel is not rendered at all. Where it is present, the
 * panel answers one question — is the data the app ranks with the data the corpus actually holds?
 */
export interface FeederStatusDTO {
  /** False when there is no corpus on this machine; the panel hides itself. */
  available: boolean;
  corpusDir: string | null;
  /**
   * Counts that need the feeder's SQLite store, taken from the snapshot its CLI writes rather than
   * by opening the store here — that would pull a WASM SQLite build into the shipped server.
   * Null until the feeder has run once on this machine.
   */
  snapshot: {
    writtenAtIso: string;
    lastCommand: string;
    uniqueSystems: number;
    uniquePlanets: number;
    uniqueSightings: number;
    corpusSpecies: number;
    cumulativeCsvRows: number;
  } | null;
  /** Species with sample packs on disk — what a rebuild would read. Computed live. */
  hydratedSpecies: number;
  speciesRows: number;
  speciesRowsWithProfile: number;
  /** Total size of the installed profiles, so the shipped-data cost is visible. */
  profileBytes: number;
  /**
   * Profiles built from fewer bodies than the corpus already holds — the actionable list, truncated
   * for display. {@link behindCount} and {@link behindOccurrences} are the real totals, because a
   * truncated list that reports its own length understates the problem it exists to show.
   */
  behind: { species: string; profileSamples: number; corpusOccurrences: number }[];
  behindCount: number;
  /** Observed bodies the corpus holds that no installed profile has been built from. */
  behindOccurrences: number;
  /** Corpus species with no row in the app's species tree, listed rather than guessed at. */
  unmatchedCorpusLabels: string[];
}

export interface MatchReason {
  field: string;
  detail: string;
  /**
   * On a *failure* reason: this criterion is a weighted term, not a wall. The candidate is demoted
   * to the unlikely tier rather than removed.
   *
   * Measured against the feeder's observed habitats, the planet-class gate alone rejected 4.14 % of
   * the bodies where the species was actually found (1,046 of 25,289), concentrated in Tussock,
   * Osseus and Fungoida — High metal content body is missing from the allowed list of almost every
   * one of them. Nothing about that 4.14 % is recoverable by tuning the list; the list itself is the
   * wrong shape. Absent data is still a wall: "no planet class in the scan" is not a disagreement
   * about habitat, it is a missing measurement.
   */
  soft?: boolean;
}

/** How a foot-catalog row was recorded from the journal. */
export type FootCatalogConfirmation = "analyse" | "sample";

/** One row learned from a prior on-foot `ScanOrganic` plus detailed scan (persisted in `data/foot_scanned.json`). */
export interface FootScannedEntry {
  id: string;
  recordedAt: string;
  /** Whether this row was first confirmed from `ScanType: Analyse` or `Sample` (analyse wins if both exist). */
  confirmationSource?: FootCatalogConfirmation;
  planetClass: string;
  /** From `normalizeScanAtmosphereForMatch` — compositional token or "" (vacuum). */
  atmosphereNorm: string;
  surfacePressure: number | null;
  surfaceTemperatureK: number | null;
  tempBandMinK: number;
  tempBandMaxK: number;
  tempMidK: number;
  surfaceGravityMs2?: number;
  starSystem: string;
  systemAddress: number;
  bodyId: number;
  bodyName: string;
  genusLocalised: string;
  genusSymbol: string;
  speciesLocalised: string;
  speciesSymbol: string;
  variantLocalised: string;
  /** Resolved `SpeciesEntry.id` when identifiable at record time. */
  speciesEntryId: string | null;
  /** Top strict DB candidate for this genus + scan (locks ignored) at record time. */
  dbProbableSpeciesId: string | null;
  /** True when `dbProbableSpeciesId` differs from `speciesEntryId` (both non-null). */
  dbProbableDisagreed: boolean;
}

export interface FootScannedFile {
  formatVersion: number;
  entries: FootScannedEntry[];
}

/** One compared attribute: this body vs a foot-catalog snapshot. */
export interface FootScanFieldRow {
  key: string;
  label: string;
  currentDisplay: string;
  catalogDisplay: string;
  matches: boolean;
  /** Genus `criteria` in `data/species/…` includes this dimension. */
  speciesCriteriaIncludes: boolean;
}

/** One foot-catalog row that matched `isCloseFootScanProfile` for the current body scan. */
export interface FootScanHitDetail {
  bodyName: string;
  starSystem: string;
  recordedAt: string;
  confirmationSource: FootCatalogConfirmation;
  fieldRows: FootScanFieldRow[];
}

/** Structured UI payload for the foot-scan suggestion card. */
export interface FootScanMatchPayload {
  hits: FootScanHitDetail[];
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

export interface SpeciesMatch {
  entry: SpeciesEntry;
  reasons: MatchReason[];
  photoUrl: string;
  photoNote: string | null;
  /** From `data/price-list.json` when this species is listed. */
  priceCredits: number | null;
  /** True when strict temp/pressure gates failed and this row was kept as a closest-distance guess. */
  approximateMatch?: boolean;
  /**
   * Listed, but below the display threshold: every criterion this row failed is a weighted term
   * rather than a wall, so it is collapsed behind "show unlikely (N)" instead of being deleted.
   *
   * A body that contradicts the species on one axis is a low-probability find, not an impossible
   * one. Stratum tectonicas — the highest-payout species in the game — grows in its canonical
   * atmosphere less than half the time.
   */
  unlikely?: boolean;
  /**
   * The terms that demoted it, so the card can say *why* rather than showing a bare percentage.
   * Set only when {@link unlikely}.
   */
  unlikelyReasons?: MatchReason[];
  /** Exobiology line complete on this body (two Sample + one Analyse in journal, per codex key). */
  organicAnalysisComplete?: boolean;
  /** Suggested from `data/foot_scanned.json` when DSS/signals imply genera the DB did not return under strict gates. */
  learnedFromFootScan?: boolean;
  /** Which journal confirmations (`ScanOrganic`) produced matching foot-catalog rows (analyse vs sample). */
  footCatalogConfirmations?: FootCatalogConfirmation[];
  /** Per-catalog-hit comparison vs this body's scan. */
  footScanMatch?: FootScanMatchPayload;
  /** True when any `*_exomastery*.json` exists for this species pack (feeder export). */
  exomasteryProfilePresent?: boolean;
  /**
   * 0–100 weighted habitat quality vs exomastery (before same-genus competitive scaling).
   * Null when the profile exists but no scan fields overlap the profile.
   */
  exomasteryHabitatQuality?: number | null;
  /**
   * 0–100 absolute match from tiered “Other matching details” deck (linear scale); cross-genus comparable.
   * Null when no exomastery overlap — UI omits the bar (species still listed from genus JSON gates).
   */
  exomasterySimilarityPercent?: number | null;
  /**
   * 0–100 when multiple same-genus exomastery candidates on this body: max deck = 100, min = 0. Null when only one.
   */
  exomasteryGenusRelativePercent?: number | null;
  /**
   * Distinct feeder bodies behind {@link exomasteryHabitatQuality}. Null when no profile.
   * Small counts mean the habitat signal is weak, not that the habitat is wrong.
   */
  exomasteryProfileSampleCount?: number | null;
  /**
   * Profile present, habitat quality exactly 0, and enough samples for that to mean something:
   * the body does not resemble anywhere this species has been observed. The candidate is still
   * listed — it is ranked last and labelled, never removed. Species that only matched through a
   * DSS temperature or physical slack fallback are never marked.
   */
  exomasteryHabitatUnlikely?: boolean;
  /** Feeder-only: strongest clustering dimensions in the profile sample (spawn “habit” concentration). */
  exomasteryVarietyHints?: ExomasteryVarietyItemDTO[] | null;
  /** Basename of on-disk profile JSON under `data/species/<genusDir>/` for download API. */
  exomasteryExportBasename?: string | null;
  /** Habitat / feeder comparison chips (Candidate species → Other match details). */
  otherMatchDetailCards?: OtherMatchDetailCardDTO[] | null;
  /**
   * Combined unit score from “Other matching details” tiers + chip colours (used for same-genus similarity display).
   * Set server-side from feeder preview cards; null when no profile or scan.
   */
  exomasteryOtherMatchCardScore?: number | null;
  /** Per-field typical vs current (for modal); omitted when no profile or scan. */
  exomasteryDetail?: ExomasteryDetailDTO | null;
}

/** One species row contributing to organic sell-range min or max totals. */
export interface ExoPayoutSpeciesLineDTO {
  id: string;
  displayName: string;
  /** Row from `data/price-list.json` via strict key match (CR). */
  listCredits: number;
  /** `listCredits` × payout multiplier, rounded (CR). */
  payoutCredits: number;
}

/** Estimated sell-value band for completing all exo slots on a body (strict price list × footfall mult). */
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
  /** `slotCount` exceeds priced species (range uses `pricedCandidateCount` terms only). */
  incomplete: boolean;
  /** The `k` cheapest distinct priced species (`k` = min(slots, pricedCandidateCount)); sums to `minCr`. */
  minTotalSpecies: ExoPayoutSpeciesLineDTO[];
  /** The `k` priciest distinct priced species; sums to `maxCr`. */
  maxTotalSpecies: ExoPayoutSpeciesLineDTO[];
}

/** Organic scan distance + payout overlay (Electron); built from live journal + Status.json. */
export interface ExoOrganicOverlayDTO {
  visible: boolean;
  phase: "tracking" | "celebrate";
  celebrationRemainSec: number;
  speciesDisplay: string;
  minSampleDistanceM: number;
  distToFirstM: number | null;
  distToSecondM: number | null;
  spacingBetweenSamplesM: number | null;
  spacingMeetsMin: boolean | null;
  /** Distance from current position to first sample point (only while one sample taken). */
  separationForSecondSampleM: number | null;
  separationMeetsMin: boolean | null;
  baseCredits: number | null;
  payNewCodex: number | null;
  payLoggedCodex: number | null;
  finalCredits: number | null;
  analyseWasLogged: boolean | null;
  footfallMult: 1 | 5;
  sampleCount: number;
  /** Journal organic session body (`systemAddress:bodyId`) — distances apply only on this body. */
  trackingBodyKey: string | null;
  /**
   * Great-circle distance from live `Status.json` position to the nearest prior sample anchor (m).
   * Use with {@link minSampleDistanceM} to see if you are still too close after backtracking.
   */
  distToNearestSampleM: number | null;
  /** True when {@link distToNearestSampleM} ≥ {@link minSampleDistanceM} (both known). */
  nearestSampleMeetsMin: boolean | null;
}

/** Heuristic surface temperature band (K) from journal + body class (not raw game min/max). */
export interface EstimatedSurfaceTempBand {
  minK: number;
  maxK: number;
  midK: number;
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
  status: "certain" | "ambiguous" | "underCovered";
  /** Biological signals the game reports for this body. */
  signalCount: number;
  /** Distinct candidate genera the matcher offered. */
  candidateGenera: number;
  /** Display names of the candidate genera, sorted. */
  genera: string[];
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

/** One system seen in merged journals (for browse / search). */
export interface JournalSystemInfo {
  systemAddress: number;
  starSystem: string;
}

/** Discovery scanner body tally from journal `FSSDiscoveryScan` + completion from `FSSAllBodiesFound`. */
export interface DScanBodiesDTO {
  /** `SystemName` from the honk line (confirm against galaxy map). */
  systemName: string;
  /** Bodies resolved in FSS so far (from `Progress` × `BodyCount`, or full count when complete). */
  found: number;
  /** Journal `BodyCount` — suns, planets, moons only (not belts / non-body signals). */
  total: number;
  /** Journal reported `FSSAllBodiesFound` for this system. */
  complete: boolean;
}

/** Parsed `NavRoute.json` + fuel reachability for the remaining plotted path. */
export interface LiveShipFuelNavRouteDTO {
  /** Commander `currentSystemAddress` appears in the live NavRoute list. */
  onPlot: boolean;
  /** Sum of 3D segment lengths for the whole plotted route (ly). */
  routeTotalLy: number;
  /** Distance left along the route from the current system; null when not on plot. */
  routeRemainingLy: number | null;
  /** Hyperjumps remaining until the last waypoint; 0 at destination. */
  routeJumpsRemaining: number | null;
  /** Whether current tank (Status.json) can cover all remaining legs — needs fuel + FSD sample. */
  fuelCanFinishPlottedRoute: boolean | null;
  /** How many consecutive upcoming legs you can complete before running dry (~distance² model). */
  fuelJumpsReachableOnPlottedRoute: number | null;
  /** Longest single leg ahead (ly); null when at destination. */
  maxRemainingLegLy: number | null;
  /** True when a remaining leg exceeds journal `Loadout.MaxJumpRange`. */
  anyRemainingLegOverMaxRange: boolean;
  /**
   * Scoop / tank heuristic when the plotted route cannot be finished on the current tank (~FSD sample).
   * Red = stop and scoop (or urgent); yellow = plan to scoop on the next hop or ~2 jumps of margin.
   */
  routeRefuelAlert: "none" | "yellow" | "red";
  /**
   * Jumps until the furthest main-sequence scoop you can reach **on current fuel** along NavRoute
   * legs (ly from StarPos, use ∝ distance² from last FSDJump, legs capped by Loadout max range).
   * Null when no scoop ahead is reachable or fuel/range data rules it out.
   */
  jumpsToLastScoopableOnRoute: number | null;
}

/** Live ship fuel from `Status.json` + jump calibration from merged `Loadout` / `FSDJump`. */
export interface LiveShipFuelRangeDTO {
  /** False when `Status.json` is missing or unread — fuel tonnes are not live. */
  hasLiveStatusFuel: boolean;
  fuelMainT: number;
  fuelReserveT: number;
  fuelTotalT: number;
  maxJumpRangeLy: number | null;
  /** Estimated tonnes for a max-range jump (from last `FSDJump` fuel scaled by `MaxJumpRange` / `JumpDist`). */
  estFuelPerMaxJumpT: number | null;
  /** Max-range jump count heuristic when **not** on a parsed NavRoute; omitted on-plot (see `navRoute`). */
  estJumpsRemaining: number | null;
  calibration: "none" | "fsd_sample";
  /** From live `NavRoute.json` when present (two+ waypoints). */
  navRoute: LiveShipFuelNavRouteDTO | null;
}

export type StarRoleDTO = "fuel" | "neutron_boost" | "wd_boost" | "useless";

export interface PrimaryStarHeaderEntryDTO {
  /** `A`, `B`, … when multiple stars; `null` → show ★ for a lone primary. */
  letter: string | null;
  shortLabel: string;
  starRole: StarRoleDTO;
  /** Journal `StarType` + `Subclass` + `Luminosity` when merged (MK-style shorthand). */
  fullSpectralNotation?: string | null;
}

export interface PrimaryStarsHeaderDTO {
  systemName: string;
  stars: PrimaryStarHeaderEntryDTO[];
}

/** One high-value world in the focused system for the header strip (orange = scan only, green = DSS mapped). */
export interface NotableBodyInfo {
  /** Full journal body name (often `SystemName A 1`). */
  bodyName: string;
  /** Body designator only for compact pills, e.g. `A 2` (system prefix stripped when possible). */
  bodyLabelShort: string;
  systemAddress: number;
  bodyId: number;
  /** Short type line, e.g. `Earth-like`, `Water world`, `HMC - Terraformable`. */
  tag: string;
  /** True when `SAAScanComplete` was merged for this body (DSS). */
  dssMapped: boolean;
}

/** Shown in the UI while the initial journal folder merge (or a full resync) runs. */
export interface JournalBootProgressDTO {
  /** 0–100, best-effort progress. */
  percent: number;
  phase: "starting" | "listing" | "merging" | "watching";
  filesDone: number;
  filesTotal: number;
  message: string;
}

/**
 * Launcher-sized status. Everything the launcher window renders (lamp, journal folder, file count,
 * connect URLs, boot splash) without touching the snapshot builder — see GET /api/status.
 */
export interface AppStatusDTO {
  mode: "server" | "client";
  bindHost: string;
  port: number;
  /** LAN links already carrying `?k=` when {@link lanKeyRequired}; see server/lanAuth.ts. */
  lanUrls: string[];
  /** True when non-loopback clients must present the access key. Only ever true in server mode. */
  lanKeyRequired: boolean;
  journalDir: string;
  journalDirConfiguredOk: boolean;
  journalPath: string | null;
  journalFileCount: number;
  journalHistoryPreset: JournalHistoryPreset;
  lastJournalEventIso: string | null;
  commanderName: string | null;
  journalBoot: JournalBootProgressDTO | null;
}

export interface AppSnapshot {
  journalPath: string | null;
  /** How many Journal.*.log files were merged (oldest → newest) */
  journalFileCount: number;
  journalDir: string;
  /** False if the configured journal folder is missing or not a directory. */
  journalDirConfiguredOk: boolean;
  /**
   * Merge every `Journal.*.log` in the folder, or only files from a rolling window (cutoff recomputed when merging).
   */
  journalHistoryPreset: JournalHistoryPreset;
  /**
   * When viewing a journal-known system, the system map is drawn from EDSM because merged journals have no `Scan` rows for that system yet.
   * Cleared when real journal scans arrive; exploration payouts remain journal-first elsewhere.
   */
  edsmMapSupplementForViewingSystem: boolean;
  /**
   * When set, the server is still merging journals (or switching journal folders).
   * The client should show a loading shell; snapshot lists/maps may be empty or stale until this clears.
   */
  journalBoot: JournalBootProgressDTO | null;
  mode: "server" | "client";
  bindHost: string;
  port: number;
  lanUrls: string[];
  /** Journal `LoadGame.Commander`; null until a LoadGame line is merged. */
  commanderName: string | null;
  currentSystem: string | null;
  currentSystemAddress: number | null;
  /**
   * When non-null, the body list reflects this system (journal memory); null = follow commander (`currentSystemAddress`).
   */
  viewingSystemAddress: number | null;
  /** Friendly name for `viewingSystemAddress` when browsing; null if not browsing or unknown. */
  viewingSystemName: string | null;
  /** Distinct systems from merged journal (and any body rows) for search / picker. */
  journalSystems: JournalSystemInfo[];
  bodies: BodyComputed[];
  speciesCount: number;
  lastJournalEventIso: string | null;
  /**
   * Sum of typical sell values for completed (3× analyse) organic samples still unsold in the journal,
   * using `price-list.json`, with 5× total on first-footfall bodies (1× base payout + 4× first-footfall bonus).
   */
  organicDataValueCredits: number;
  /** Rows included in `organicDataValueCredits` (pending sales). */
  organicPendingSampleCount: number;
  /** Per-sample breakdown for the data value modal (unsold completes in journal). */
  organicPendingLines: OrganicPendingLineItem[];
  /** When true, journal has `FSSAllBodiesFound` for the current system and no bodies match bio/hints/organics yet. */
  fssAllBodiesFoundNoBio: boolean;
  /** When true, Bacterium genus is included in planet↔species matching. */
  includeBacteriumInSearch: boolean;
  /**
   * DSS fallback: extra slack (0–50%) on physical gates — temperature estimator band, codex pressure, codex gravity.
   * 0 = strict codex matching for those fallbacks. See Options.
   */
  /**
   * When true, “Data value” adds approximate UC exploration data (FSS/DSS) from merged journal scans.
   * Not first-discoverer bonuses; see Options.
   */
  includeExplorationScanDataInDataValue: boolean;
  /** Estimated CR from all merged `Scan` rows (MattG-style formulas; belts excluded). */
  explorationScanDataValueCredits: number;
  /** Unique bodies with journal `FSSBodySignals` (any system in merged logs). */
  explorationFssScanCount: number;
  /** Sum of FSS-only estimates for those bodies with merged scan data (belts skipped). */
  explorationFssValueCredits: number;
  /** Planetary bodies with `SAAScanComplete` (stars & belts excluded). */
  explorationDssScanCount: number;
  /** Sum of full mapped (DSS) estimates for those bodies. */
  explorationDssValueCredits: number;
  /** @deprecated Use explorationDssScanCount — kept for older clients. */
  dssMappedPlanetaryBodyCount: number;

  /**
   * High-value exploration targets in the focused system (from merged `Scan`):
   * Earth-like, water world, ammonia world, or terraformable worlds. UI uses FSS-orange vs DSS-green.
   */
  notableBodies: NotableBodyInfo[];
  /**
   * System map exobiology node suffixes: min estimated sell heuristic (price-list × 5) for `+` and `++`.
   * `++` threshold is always kept strictly greater than `+` (CR, integer).
   */
  exoMapTierPlusMinCr: number;
  exoMapTierPlusPlusMinCr: number;

  /**
   * Discovery-scanner honk (`FSSDiscoveryScan`) for the focused system: journal `BodyCount` is bodies only
   * (stars / planets / moons), excluding `NonBodyCount` signals. `found` tracks FSS progress until `FSSAllBodiesFound`.
   */
  dScanBodies: DScanBodiesDTO | null;

  /** Focused-system stars from merged scans: system name + per-star role chips for the header. */
  primaryStarsHeader: PrimaryStarsHeaderDTO | null;

  /**
   * Hierarchical system map + exploration estimates for the focused system (viewing or live).
   * Built from merged journal `Scan` events plus exobiology state.
   */
  systemMap: SystemMapSnapshot | null;
  /** `FSDJump`/`CarrierJump` into focused system had `WasDiscovered: false` — show FIRST chip. */
  focusedSystemUndiscoveredFromLastFsdJump: boolean;
  /** Journal `FSDTarget.RemainingJumpsInRoute`; null until line merged. */
  remainingJumpsInRoute: number | null;
  /**
   * Commander fuel tank + rough “how many max-range jumps left” from Status.json + journal `Loadout`/`FSDJump`.
   * Null when Status.json unread or no fuel fields.
   */
  liveShipFuelRange: LiveShipFuelRangeDTO | null;

  /** User pref / launcher: HUD + Status.json polling for on-foot distance. */
  footTravelOdometerEnabled: boolean;
  /** True when the odometer is accumulating for the active `organic_sample_session` body (survives Embark). */
  footTravelOdometerTracking: boolean;
  /** Metres walked while tracking (great-circle on `PlanetRadius`); persisted in `data/organic_sample_session.json`. */
  footTravelDistanceMeters: number;

  /** Completed on-foot analyses (`ScanOrganic` Analyse) persisted in `data/foot_scanned.json`, newest first. */
  footScannedEntries: FootScannedEntry[];
  /**
   * Live organic sample-distance overlay (journal tail + Status.json).
   * Null when inactive (no scans or post-celebration cooldown).
   */
  exoOrganicOverlay: ExoOrganicOverlayDTO | null;
  /**
   * One-shot: client selects this body tab (`systemAddress:bodyId`) when present in `bodies`.
   * The server clears the pending value after a single snapshot build.
   */
  uiAutoSelectBodyKey: string | null;

  /**
   * Web UI body tab focus (`systemAddress:bodyId`), mirrored from the client for HUD overlays.
   * May be null until the user opens the app or changes tabs.
   */
  uiSelectedBodyKey: string | null;

  /**
   * Resolved focus for the Exo-Candidates overlay: same body as foot-distance tracking when that session is
   * active (after first `ScanOrganic`), otherwise {@link uiSelectedBodyKey}, else last touchdown.
   */
  exoOverlayFocusBodyKey: string | null;

  /**
   * When {@link exoOverlayFocusBodyKey} is not in `bodies` (e.g. FSS reported 0 biological signals),
   * full {@link BodyComputed} for that body so the overlay can still show `0/0` and species rows.
   */
  exoOverlayFocusBody: BodyComputed | null;
}

/** Single journal `Scan` row merged over time (basic + detailed). */
export interface ExplorationScanRecord {
  systemAddress: number;
  bodyId: number;
  bodyName: string;
  starSystem: string;
  updatedAt: string;
  /** Synthetic map placeholder inferred from body designation; not from the journal. */
  isSynthetic?: boolean;
  /** When true, row was loaded from EDSM because the journal had no `Scan` for this system yet. */
  edsmHydrated?: boolean;
  scanType?: string;
  /** Journal `Scan.BodyType` (e.g. `AsteroidCluster` for belt clusters). */
  bodyType?: string;
  planetClass?: string;
  starType?: string;
  subclass?: number;
  /** Journal detailed `Scan.Luminosity` (Yerkes class, e.g. `V`, `VI`). */
  luminosity?: string;
  stellarMass?: number;
  massEM?: number;
  terraformState?: string;
  landable?: boolean;
  semiMajorAxis?: number;
  surfaceTemperature?: number;
  surfaceGravity?: number;
  surfacePressure?: number;
  radius?: number;
  atmosphereType?: string;
  atmosphere?: string;
  volcanism?: string;
  tidalLock?: boolean;
  parents?: unknown;
  atmosphereComposition?: unknown;
  materials?: unknown;
  composition?: unknown;
  /**
   * Journal `Scan.WasDiscovered`. When present, `false` means this commander is the first discoverer
   * (exploration bonus). When `true`, the body was already discovered.
   */
  wasDiscovered?: boolean;
  /**
   * Journal `Scan.WasMapped`. When present, `false` means first mapper (DSS bonus). When `true`, the body
   * was already mapped before that scan; later scans after your DSS often flip to `true`, so payouts freeze at `SAAScanComplete`.
   */
  wasMapped?: boolean;
  /** Journal `Scan.DistanceFromArrivalLS`. `0` marks the arrival / primary entry body in the system map. */
  distanceFromArrivalLs?: number;
  /**
   * Journal `ScanBaryCentre` for `{ Null: journalBarycentreNullId }` in `Scan.Parents`.
   * Stored under `bodyId = barycentreSyntheticBodyId(nullId)` so it never collides with real `BodyID`s.
   */
  isBarycentreJournal?: boolean;
  /** Raw journal `ScanBaryCentre.BodyID` (the `Null` chain id, not a ship body id). */
  journalBarycentreNullId?: number;
  /** Orbital elements from `ScanBaryCentre` (mutual orbit of direct children under this barycentre). */
  eccentricity?: number;
  orbitalInclination?: number;
  periapsis?: number;
  orbitalPeriod?: number;
  ascendingNode?: number;
  meanAnomaly?: number;
  /** Planet `Scan.RotationPeriod` (s). */
  rotationPeriod?: number;
  /** Planet `Scan.AxialTilt` (rad). */
  axialTilt?: number;
}

export interface SystemMapNodeDTO {
  bodyId: number;
  bodyName: string;
  /** Short body-type label (HMC, ELW, …) — base letters only. */
  label: string;
  /** Text inside map node circle (includes +/++ for exo value tier or neutron). */
  mapLabel: string;
  isStar: boolean;
  hasExobiology: boolean;
  /** True when estimated FSS value is materially above reference at 1 Earth mass for this class. */
  valuePlus: boolean;
  maxExoHeuristicCredits: number;
  exoValueTier: 0 | 1 | 2;
  /** Scoopable star: append + to name under node. */
  namePlus: boolean;
  starVisual: "default" | "neutron";
  /**
   * Multi-star map layout: comma-separated star `bodyId`s this body orbits (sorted), from journal `Parents`
   * or parsed from the short designation (e.g. `AB 1` → stars A and B). Empty for stars / unknown.
   */
  orbitPrimaryKey: string;
  children: SystemMapNodeDTO[];
  /** Synthetic node for journal `Parents` `{ Null: id }` (barycentre). */
  isBarycentre?: boolean;
  /** Journal `DistanceFromArrivalLS === 0` — usual entry star. */
  isArrivalBody?: boolean;
  /** First discoverer not yet determined / not in journal — optional UI tint. */
  isUnexplored?: boolean;
  /** `Scan.SemiMajorAxis` when known — sibling sort on the map. */
  semiMajorAxis?: number | null;
  /** Inferred from naming; no `Scan` / FSS row yet in merged journal. */
  isInferredPlaceholder?: boolean;
  /**
   * Journal classifies body as stellar (incl. YSO in a planet designation slot). Sun-column `isStar` can still be false.
   */
  journalStellar?: boolean;
}

export interface SystemMapBodyDetailDTO {
  bodyId: number;
  bodyName: string;
  bodyKey: string;
  isStar: boolean;
  /**
   * True when merged journal treats the body as stellar, including planet-slot YSO / young star rows.
   */
  journalStellar?: boolean;
  starType?: string;
  /** `StarType` + `Subclass` + `Luminosity` when present on merged `Scan`. */
  fullSpectralNotation?: string | null;
  starRole?: StarRoleDTO;
  planetClass?: string;
  terraformState?: string;
  landable?: boolean;
  massEM?: number;
  stellarMass?: number;
  semiMajorAxis?: number;
  surfaceTemperature?: number;
  surfaceGravity?: number;
  surfacePressure?: number;
  atmosphereType?: string;
  atmosphere?: string;
  volcanism?: string;
  tidalLock?: boolean;
  compositionSummary?: string;
  atmosphereCompositionSummary?: string;
  fssCredits: number | null;
  fssFirstDiscoverCredits: number | null;
  fssFirstDiscoverBonus: number | null;
  /** Full cartographics value at current state: FSS-only until DSS completes, then mapped total (incl. mapping multiplier). */
  dssCredits: number | null;
  dssFirstDiscoverCredits: number | null;
  dssFirstDiscoverBonus: number | null;
  /** When DSS complete: mapped total minus FSS discovery baseline (highlights DSS contribution). */
  dssVersusFssUpliftCredits: number | null;
  /** When not DSS complete: estimated mapped payout if you complete DSS (same discover / mapper flags as journal). */
  dssProjectedCredits: number | null;
  /** Journal efficient probe completion; applies community efficiency tail on mapped estimate. */
  dssProbeEfficientApplied: boolean | null;
  valuePlus: boolean;
  hasExobiology: boolean;
  bioBodyKey: string | null;
  estimatedSurfaceTempK: EstimatedSurfaceTempBand | null;
  exoMatchSummaries: { displayName: string; id: string }[];
  /** max(list price × multiplier) over matched exo species; multiplier is 5 with first-footfall on this body, else 1 (pending-sale rule). */
  maxExoHeuristicCredits: number;
  exoValueTier: 0 | 1 | 2;
  /** Band for selling all bio slots from current candidates (same rules as body tab). */
  exoPayoutRange: ExoPayoutRangeDTO | null;
  /** Journal parent body id if any. */
  parentBodyId: number | null;
  /** All Star: ids from Parents chain (circumbinary detection). */
  parentStarIds: number[];
  /** Naming-inference placeholder on the map (no journal scan yet). */
  isInferredPlaceholder?: boolean;
  /**
   * Journal `ScanBaryCentre` row merged for this synthetic `{ Null: n }` node — used in the map detail popup.
   */
  isMutualBarycentre?: boolean;
  /** Bodies that directly orbit this mutual barycentre (map children). */
  baryAffectsBodyIds?: number[];
  /** Journal `ScanBaryCentre` / mutual orbit (when `isMutualBarycentre`). */
  baryEccentricity?: number;
  baryOrbitalInclination?: number;
  baryPeriapsis?: number;
  baryOrbitalPeriod?: number;
  baryAscendingNode?: number;
  baryMeanAnomaly?: number;
  /** Raw `ScanBaryCentre.BodyID` (`Null` chain id). */
  baryJournalNullId?: number;
}

export interface SystemMapSnapshot {
  systemAddress: number;
  /** Journal system name (header / context). */
  starSystem: string;
  tree: SystemMapNodeDTO[];
  detailsByBodyId: Record<string, SystemMapBodyDetailDTO>;
  totalFss: number;
  totalDss: number;
  totalFssFirstDiscover: number;
  totalDssFirstDiscover: number;
  /** Sum of (mapped body DSS − FSS) for planetary bodies with DSS complete — mapping uplift only. */
  totalDssVersusFssUplift: number;
  formulaAttribution: string;
  /** Community attachment-style + MattG-ish stars → approximate full-system FSS value. */
  approxSystemFssValue: number;
  /** Same heuristic with planetary DSS mapping × efficiency tails (stars unchanged vs FSS). */
  approxSystemDssValue: number;
  /**
   * MattG-style sell estimate from merged `Scan` rows in this system only (FSS baseline / DSS mapped
   * depending on completion) — scales with discoveries and DSS state.
   */
  journalExplorationSaleCreditsFocused: number;
}
