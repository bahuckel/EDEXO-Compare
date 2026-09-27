import type { ExoPayoutRangeDTO } from "./body.js";
import type { StarRoleDTO } from "./hud.js";
import type { EstimatedSurfaceTempBand } from "./scan.js";

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
  /** Stars: belt clusters in this star's belt — the map draws the belt when there are any. */
  beltClusters?: number;
  /** Biological signal count (journal FSS / DSS, or a Spansh lookup) — the ring and its number. */
  bioSignals?: number | null;
  /** A ringed planet: the map draws its ring, as the game's map does. */
  rings?: number;
  /** Its organics would pay the first-footfall ×5 here. */
  firstFootfallX5?: boolean;
  /** The ship is at this body now (arrival body after a jump, then approach / drop / landing). */
  youAreHere?: boolean;
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
  /**
   * The span between the coldest and hottest point on a landable surface.
   *
   * Different in kind from {@link estimatedSurfaceTempK}, which guesses the *average* before a
   * detailed scan. This is the range the game's own body panel prints once the body is scanned, and
   * no journal event carries it. Null when the body is not landable, when its atmosphere has never
   * been calibrated, or when the star is unknown.
   */
  surfaceTemperatureRangeK: { minK: number; maxK: number } | null;
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
  /**
   * Journal `ScanBaryCentre` elements (when `isMutualBarycentre`) — the barycentre's own orbit
   * around its parent, **not** the mutual orbit of its children. See `mergeBarycentreJournalLine`.
   */
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
