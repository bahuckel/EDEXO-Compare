/**
 * How a foot-catalog row was recorded from the journal, weakest first.
 *
 * All three name the species — the journal writes `Species_Localised` on every `ScanOrganic` line —
 * so all three confirm the species was on that body. What they differ on is how much of it the
 * commander then took:
 *
 *  - `log`     — first contact with the composition scanner. Seen and identified, nothing harvested.
 *  - `sample`  — one of the three samples that make a sellable specimen.
 *  - `analyse` — the third sample, which completes it.
 *
 * The distinction is about payout, not about presence, so a `log` is evidence exactly as much as an
 * `analyse` is. Skipping the low-value species after logging it is a normal way to play, and 85 of
 * this commander's 352 observations are that.
 */
export type FootCatalogConfirmation = "analyse" | "sample" | "log";

/** Strongest wins when the same species on the same body is seen more than once. */
export const FOOT_CONFIRMATION_RANK: Record<FootCatalogConfirmation, number> = {
  log: 0,
  sample: 1,
  analyse: 2,
};

/** One row learned from a prior on-foot `ScanOrganic` plus detailed scan (persisted in `data/foot_scanned.json`). */
export interface FootScannedEntry {
  id: string;
  recordedAt: string;
  /** Strongest `ScanType` seen for this species on this body — see {@link FOOT_CONFIRMATION_RANK}. */
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
  /** Set on a row read from the shared-exomastery folder: the other commanders who reported it (§S). */
  sharedFrom?: string[];
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
