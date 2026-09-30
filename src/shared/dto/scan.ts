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

/** One confirmed on-foot organic sample on a body (ScanOrganic) — locks that genus to one species. */
export interface OrganicGenusLock {
  genusLocalised: string;
  genusSymbol: string;
  speciesLocalised: string;
  speciesSymbol: string;
  variantLocalised: string;
  /**
   * How the species was confirmed on this body.
   *
   * `foot` is a `ScanOrganic` — the commander walked up to it. `codex` is a `CodexEntry` written by
   * the composition scanner, which names the species and the body without a landing, and which the
   * owner asked to count: some plants are on ground you cannot put a ship down near.
   *
   * Absent means `foot`. Caches written before this field existed hold nothing but foot scans.
   */
  source?: "foot" | "codex" | "spansh";
  /**
   * Foot locks only: how far the sampling of this species on this body got — `Log` is 1, each
   * `Sample` adds one, up to 3. The game writes `Log, Sample, Sample, Analyse`; the third sample and
   * the Analyse land seconds apart.
   */
  samples?: number;
  /** Foot locks only: an `Analyse` was written for this species on this body. */
  analysed?: boolean;
  /**
   * Copied from a sibling moon the commander scanned (see `propagateExoAmongSimilarMoons`). Counts as
   * a hint for the match, never as progress on this body.
   */
  fromSibling?: boolean;
  /**
   * Journal time of the latest scan of this species on this body — foot or composition scanner. The
   * glance bar shows the last three things scanned, newest last. Absent on sibling copies.
   */
  at?: string;
}

/** Heuristic surface temperature band (K) from journal + body class (not raw game min/max). */
export interface EstimatedSurfaceTempBand {
  minK: number;
  maxK: number;
  midK: number;
}

/**
 * Where the next-jump card's target came from, best first:
 * - `jump`: `StartJump` (hyperspace in progress), or the system just arrived in, held for a minute;
 * - `target`: `FSDTarget` — the system locked in the nav panel before the countdown starts;
 * - `route`: the next hop after the current system in the live `NavRoute.json`.
 */
export type JumpTargetSource = "jump" | "target" | "route";

/** One entry of journal `Scan.Rings` that is a ring, not a belt. Radii in metres, mass in megatonnes. */
export interface ScanRing {
  name: string;
  /** `eRingClass_Icy`, `eRingClass_Rocky`, `eRingClass_MetalRich`, `eRingClass_Metalic`. */
  ringClass: string;
  massMt: number;
  innerRadM: number;
  outerRadM: number;
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
  /**
   * False when every scan of this body so far was a `NavBeaconDetail`: data a nav beacon hands over
   * cannot be sold, so it is worth nothing to the unsold total. Sticky once any other scan arrives.
   * Absent on rows built outside the journal merge, which count as scanned.
   */
  playerScanned?: boolean;
  /** Journal `Scan.BodyType` (e.g. `AsteroidCluster` for belt clusters). */
  bodyType?: string;
  planetClass?: string;
  starType?: string;
  subclass?: number;
  /** Journal detailed `Scan.Luminosity` (Yerkes class, e.g. `V`, `VI`). */
  luminosity?: string;
  stellarMass?: number;
  /**
   * Journal `Scan.AbsoluteMagnitude` (stars). For catalogue stars (HIP, HD, Gliese) it is the real
   * star's brightness, which the game's radius and temperature can badly understate; the colour rule
   * reads it (see `speciesMatchContext.ts`).
   */
  absoluteMagnitude?: number;
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
  /** Planetary rings from `Scan.Rings` (belts excluded); undefined when the scan listed none at all. */
  ringCount?: number;
  /** The rings themselves (belts excluded), for the ring features (owner, 2026-09-30). */
  rings?: ScanRing[];
  /** Journal `Scan.Age_MY` (stars): age in millions of years. */
  ageMy?: number;
  /**
   * Journal `ScanBaryCentre` for `{ Null: journalBarycentreNullId }` in `Scan.Parents`.
   * Stored under `bodyId = barycentreSyntheticBodyId(nullId)` so it never collides with real `BodyID`s.
   */
  isBarycentreJournal?: boolean;
  /** Raw journal `ScanBaryCentre.BodyID` (the `Null` chain id, not a ship body id). */
  journalBarycentreNullId?: number;
  /** Orbital elements from `ScanBaryCentre`: this barycentre's own orbit around its parent. */
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
