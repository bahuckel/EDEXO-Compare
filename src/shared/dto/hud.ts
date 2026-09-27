/** Organic scan distance + payout overlay (Electron); built from live journal + Status.json. */
export interface ExoOrganicOverlayDTO {
  visible: boolean;
  phase: "tracking" | "celebrate";
  celebrationRemainSec: number;
  speciesDisplay: string;
  minSampleDistanceM: number;
  distToFirstM: number | null;
  distToSecondM: number | null;
  /**
   * Distance back to the third sample, once Analyse has been taken.
   *
   * The "Scan 3" slot used to carry the payout, which put a credits figure in a row of two
   * distances and read as a bug. The payout has its own banner on completion; this row is about
   * where you have been.
   */
  distToThirdM: number | null;
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
  /** ISO time of the first Log/Sample of this run on this body, for the HUD's run timer; null if unknown. */
  runStartedIso?: string | null;
  /** Journal organic session body (`systemAddress:bodyId`) — distances apply only on this body. */
  trackingBodyKey: string | null;
  /**
   * Great-circle distance from live `Status.json` position to the nearest prior sample anchor (m).
   * Use with {@link minSampleDistanceM} to see if you are still too close after backtracking.
   */
  distToNearestSampleM: number | null;
  /** True when {@link distToNearestSampleM} ≥ {@link minSampleDistanceM} (both known). */
  nearestSampleMeetsMin: boolean | null;
  /** Where things are around you on this body. Null until the game reports a surface position. */
  minimap: ExoMinimapDTO | null;
}

/**
 * The overlay minimap — where you are standing and what is around you.
 *
 * Everything is already in metres **relative to the commander**, north-up, because the overlay is a
 * transparent HUD panel and should not be doing spherical trigonometry on a 320 ms tick. The server
 * holds the latitudes; the client holds a compass.
 *
 * What can and cannot appear here is set by the game, not by choice:
 *
 * - **Plants** are only placeable if this app was running when they were scanned. `ScanOrganic`
 *   carries no coordinates, so the position has to be taken from `Status.json` at the moment the
 *   scan lands. Nothing can be recovered from old journals.
 * - **The ship** comes from `Touchdown`, which does carry them, so it survives a restart and is
 *   known even for a landing made before the app opened.
 */
export interface ExoMinimapDTO {
  /** Radius the map draws to, metres. Things beyond it become arrows on the rim. */
  radiusM: number;
  /** Degrees clockwise from north, or null when the game is not reporting a heading. */
  headingDeg: number | null;
  /** The minimum separation this genus needs, so the map can draw the ring you have to clear. */
  minSampleDistanceM: number;
  marks: ExoMinimapMarkDTO[];
}

export interface ExoMinimapMarkDTO {
  kind: "sample" | "ship";
  /**
   * Whether this mark belongs to the sampling run in progress on this body.
   *
   * The game's sampler holds **one genus/species per planet at a time**, so a mark left by a species
   * the commander has moved on from is not part of what they are doing now. Drawing every mark the
   * same colour invited the mistake the owner described: standing among Stratum marks while sampling
   * Tussock, and reading one as the other.
   *
   * Per body, because the sampler is: the same species on another planet is a fresh run worth fresh
   * credits, and its marks are not shown here anyway.
   */
  active?: boolean;
  /** Metres north (+) or south (−) of the commander. */
  northM: number;
  /** Metres east (+) or west (−) of the commander. */
  eastM: number;
  /** Straight-line surface distance, metres — what the label shows for an off-map arrow. */
  distanceM: number;
  label: string;
}

/** One system seen in merged journals (for browse / search). */
export interface JournalSystemInfo {
  systemAddress: number;
  starSystem: string;
}

/** Discovery scanner body tally from journal `FSSDiscoveryScan` + completion from `FSSAllBodiesFound`. */
/**
 * See `GameStateStore.systemKind`. All but `empty` pay no first-footfall bonus (unless this
 * commander discovered the system).
 */
export type SystemKind = "bubble" | "colony" | "colonising" | "facility" | "empty";

/** Signs of life read off an arrival line — see `signsOfLife` in `gameState.ts`. */
export type SystemLife = "populated" | "claimed" | "facility";

export interface DScanBodiesDTO {
  /** `SystemName` from the honk line (confirm against galaxy map). */
  systemName: string;
  /** Bodies resolved in FSS so far (from `Progress` × `BodyCount`, or full count when complete). */
  found: number;
  /** Journal `BodyCount` — suns, planets, moons only (not belts / non-body signals). */
  total: number;
  /** Journal reported `FSSAllBodiesFound` for this system. */
  complete: boolean;
  /**
   * The system has been honked: an `FSSDiscoveryScan`, or an `FSSAllBodiesFound` (a one- or two-star
   * system can be complete without one). Without it `total` is only what was scanned by hand, so
   * scanning the star alone read "1 / 1" (owner, 2026-09-25). Absent in old payloads — treat as yes.
   */
  honked?: boolean;
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
  /**
   * The HUD's route strip (owner, 2026-09-13): the next hops after the current system, at most
   * `ROUTE_AHEAD_HOPS`, each with its star class and, on the nearest scoopable star when the tank
   * cannot finish the plot, the refuel mark. Empty when off plot or at the destination.
   */
  ahead: RouteAheadHopDTO[];
  /** Hops to that nearest scoopable star (may exceed `ahead.length`); null when none is needed. */
  refuelInHops: number | null;
  /** `yellow` = plan to scoop there; `red` = you must (last reachable scoop, or none reachable). */
  refuelLevel: "none" | "yellow" | "red";
}

export interface RouteAheadHopDTO {
  starSystem: string;
  /** NavRoute `StarClass` ("" when the file has none). */
  starClass: string;
  scoopable: boolean;
  refuel: "none" | "yellow" | "red";
  /**
   * Would the commander probably be the first here? `null` while nothing is known yet.
   *
   * The game says whether a system was discovered only on arrival, so before the jump the only
   * source is EDSM. That makes the answer asymmetric and the HUD renders it that way: `false` is
   * certain — someone has been and uploaded — while `true` is a good bet, because a commander who
   * never uploads leaves no trace. `null` means the lookup has not answered, and the arrow goes grey
   * rather than guessing. See `server/firstFootfallLookup.ts`.
   */
  likelyFirstFootfall: boolean | null;
  /** When `likelyFirstFootfall` is null: why — "Waiting for EDSM", "EDSM rate limit — will retry"… */
  firstFootfallNote?: string | null;
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
  /** A black hole: its role reads "useless" like any unscoopable star, but the card marks it apart. */
  blackHole?: true;
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

/**
 * Launcher-sized status. Everything the launcher window renders (lamp, journal folder, file count,
 * connect URLs, boot splash) without touching the snapshot builder — see GET /api/status.
 */
/**
 * The radar's own frame, sent on its own so it is not gated on a snapshot rebuild.
 *
 * The sample radar is the one part of the HUD that has to move smoothly: it draws where the
 * commander is standing, and a commander walking at 7 m/s crosses a 500 m radar in a minute. It
 * used to arrive only inside the full snapshot push, which is coalesced at 250 ms and rebuilds the
 * entire state to produce it, so the radar could never update faster than four times a second no
 * matter how often `Status.json` was read. These two fields are the whole of what it draws, they
 * come straight off the store, and they cost nothing to build — so they go out on every poll.
 */
export interface ExoLiveDTO {
  exoOrganicOverlay: ExoOrganicOverlayDTO | null;
  exoMinimap: ExoMinimapDTO | null;
}

export interface ShipProximityDTO {
  originBodyKey: string | null;
  /** Short name of the body the distances are from ("A 2 a"). */
  originLabel: string | null;
  basis: "arrival" | "orbits";
  distanceLsByBodyKey: Record<string, number>;
}
