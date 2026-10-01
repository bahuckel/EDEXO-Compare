/** Estimated sell-value band for completing all exo slots on a body (strict price list × footfall mult). */
/**
 * One body in the first-discovery backlog: biology this commander found and never collected.
 *
 * Both credit figures already carry the 5x, because the whole point of the row is that the
 * first-footfall bonus is still unclaimed. `minCr` is the floor — what the body pays if every slot
 * turns out to hold the cheapest candidate — and is the number to plan a route on. `maxCr` is the
 * ceiling and can be wildly higher on a body whose candidate list has one rare outlier.
 */
/** One species in a system, priced. `firstFootfallCr` is display only — the filter uses `baseCr`. */
export interface GalaxyValueSpeciesDTO {
  speciesId: string;
  displayName: string;
  /** What one sample sells for at 1x — the number the filter tests. */
  baseCr: number;
  /** The same at 5x, for a commander who gets there first. Never filtered on. */
  firstFootfallCr: number;
}

/**
 * A system the codex says holds something worth at least the asked-for price.
 *
 * A recorded sighting, not a prediction — somebody logged this species in this system. That is a
 * different claim from the backlog panel's estimates and must not be shown as the same thing.
 */
export interface GalaxyValueHitDTO {
  systemAddress: number;
  starSystem: string;
  x: number;
  y: number;
  z: number;
  /** klightspeed region index, 1-42; 0 when unknown. */
  regionId: number;
  /** Straight-line light years from the commander, or null when their position is unknown. */
  distanceLy: number | null;
  /** Only the species that clear the threshold, dearest first. */
  species: GalaxyValueSpeciesDTO[];
  bestCr: number;
  /** Everything the codex knows here, including species under the threshold. */
  totalKnownSpecies: number;
  /** Sum of every known species here at 1x — what the slider tests. */
  systemCr: number;
  /** The same at 5x, if nobody has walked these bodies. Never filtered on; the index cannot know. */
  systemFirstFootfallCr: number;
  /** Evidence flags for this system — TIER_FSS | TIER_DSS | TIER_CODEX | TIER_BODIES_KNOWN. */
  tiers: number;
  /** Spansh's body count, or 0 when unknown — not the same as a system with no bodies. */
  bodyCount: number;
}

/**
 * What a commander asked the galaxy for.
 *
 * Price and species are alternatives, not a pair. Choosing *Stratum tectonicas* fixes the price at
 * 19,010,800, so a price filter beside it is either redundant or contradictory — the UI disables it
 * and says why. Choosing the *genus* Stratum leaves eight species spanning 1 M to 19 M, where "at
 * least 10 M" is a real question, so price stays live.
 */
/** One row of the genus/species picker: what can be searched for, and what it pays. */
export interface GalaxySpeciesOptionDTO {
  speciesId: string;
  displayName: string;
  genusDir: string;
  genusName: string;
  baseCr: number;
  /** Systems in the index where the codex has recorded this species. */
  systemCount: number;
}

export interface GalaxySpeciesCatalogueDTO {
  available: boolean;
  /** Ascending; the price control offers steps drawn from these. */
  species: GalaxySpeciesOptionDTO[];
  systemCount: number;
}

/**
 * What this commander's own journals say about one sector.
 *
 * Only their half: the client merges it with the sector map file it already holds, so the ladder in
 * shared/galaxyTier.ts lives in one place and a 900 kB corpus is not parsed twice.
 */
export interface CommanderSectorDTO {
  /** `x:y:z` sector cell key, matching the sector map file. */
  key: string;
  visited: boolean;
  scannedByYou: number;
  /** Bodies here with biology this commander has not scanned. Decides the "you missed some" tier. */
  unscannedByYou: number;
}

export interface CommanderSectorsDTO {
  /** False when there is no journal store behind this build. */
  available: boolean;
  rows: CommanderSectorDTO[];
}

export interface GalaxyValueQueryDTO {
  /**
   * Minimum **system** total, in credits, at 1x list price.
   *
   * Per system rather than per species, and at 1x rather than 5x, because the bonus is not knowable
   * from the index: nothing here says whether anybody has already walked those bodies. A commander
   * who arrives and finds it untouched earns five times this; the filter promises only what can be
   * promised. Ignored when `speciesIds` is set — a named species already has a price.
   */
  minCr: number;
  /** Exact species wanted. When present, price is not consulted. */
  speciesIds?: string[];
  /** Genus data directories to restrict to. Combines with `minCr`. */
  genusDirs?: string[];
  /** Required evidence flags (TIER_*), all of which must be present. 0 means any. */
  requireTiers?: number;
}

export interface GalaxyValueSearchDTO {
  /** False on a build with no galaxy index — the feature hides itself rather than showing nothing. */
  available: boolean;
  minCr: number;
  /** Echoed back so a stale response can be told from a current one. */
  query?: GalaxyValueQueryDTO;
  /** How many systems matched in total, before trimming to the nearest few. */
  matchedSystems: number;
  speciesConsidered: number;
  /** The nearest matches, for the list. Ordered by distance when the commander's position is known. */
  hits: GalaxyValueHitDTO[];
  /**
   * A galaxy-wide sample for the **map**: the richest system in each matching sector cell.
   *
   * The list and the map ask different questions. "Which of these should I fly to" is answered
   * nearest-first; "where does this species live" is not, and a nearest-first sample collapses onto
   * the commander's own position — 200 systems inside twelve pixels, in the case that prompted
   * this. Capped, so {@link spreadCells} says how many cells there really were.
   */
  spread?: GalaxyValueHitDTO[];
  /** Distinct sector cells that matched, before the sample was capped. */
  spreadCells?: number;
}

/**
 * One named galactic region the body file holds, for the region picker.
 *
 * The system count travels with the name because it is the difference between a one-second search
 * and a slow one: Inner Orion Spur carries two orders of magnitude more systems than the far arms,
 * and a picker that offers all forty-two identically hides that.
 */
export interface GalaxyRegionOptionDTO {
  /** klightspeed region index, 1-42. */
  regionId: number;
  name: string;
  systemCount: number;
}

export interface GalaxyRegionsDTO {
  /** False when this machine has no body file — the whole predicted search hides itself. */
  available: boolean;
  regions: GalaxyRegionOptionDTO[];
  systemCount: number;
  bodyCount: number;
  /** Bytes on disk. Half a gigabyte, and a reader is entitled to know what they are searching. */
  fileBytes: number;
}

/**
 * What a commander asked the galaxy's *unvisited* bodies for.
 *
 * The three evidence flags are independent ticks rather than a mode, which is the owner's design:
 * *"I choose filters FSS/DSS/ScanOrganic as proof. If ScanOrganic is not selected it excludes
 * them."* The first two describe a **body** — the dump carries a genus list only where somebody
 * probed it — and the third describes a **system**, and is answered from `bio-index.bin`, because
 * the body file knows nothing about who has walked where.
 */
export interface GalaxyBodyScanQueryDTO {
  /** Which region to walk. Required: the galaxy in one request is forty-two regions of waiting. */
  regionId: number;
  /** Exact species wanted. */
  speciesIds?: string[];
  /** Genus data directories, when no species was named. */
  genusDirs?: string[];
  /** Bodies with biological signals that nobody has probed. The default, and the point of this. */
  includeUnprobed?: boolean;
  /** Bodies somebody has already mapped with probes, where the genus is public knowledge. */
  includeProbed?: boolean;
  /** Systems where somebody has already logged a species on foot. Off excludes them entirely. */
  includeWalked?: boolean;
  /**
   * Drop bodies whose gravity gives biology less than this chance of being there at all.
   *
   * Off (0 or absent) by default and deliberately so: the scan's gates are a superset of the
   * matcher's, and a curve measured from one commander's journals should not quietly delete rows
   * nobody asked it to. Compared against the *smoothed* figure — see `server/gravityBiologyOdds.ts`
   * — so a band measured at 0 of 32 bodies is treated as unlikely rather than impossible.
   */
  minGravityOddsPct?: number;
}

/** One body that would be offered this species if a commander were standing on it. */
export interface GalaxyBodyMatchDTO {
  bodyId: number;
  bodyName: string;
  /** Planet class as the dump spells it, e.g. `Icy body`. Empty when unrecorded. */
  planetClass: string;
  atmosphere: string;
  volcanism: string;
  /** Kelvin; 0 means the dump did not record it. */
  temperatureK: number;
  /** Earth gees — the dump's unit, kept as measured. */
  gravityG: number;
  /** Atmospheres — the dump's unit. */
  pressureAtm: number;
  /** How many biological signals the FSS counted. The number of genera actually down there. */
  bioCount: number;
  landable: boolean;
  /** Somebody has probed this body, so the genus is already known. */
  probed: boolean;
  /** The wanted species that survive the gates here, un-demoted. Dearest first. */
  species: GalaxyValueSpeciesDTO[];
  /**
   * How often a body of this gravity carries **any** biology, from the commander's own journals.
   *
   * Reported, not applied — the species rows above are the matcher's verdict and this does not
   * change them. Null when the curve has nothing to say: an airless body, or one whose gravity the
   * dump never recorded. See `server/gravityBiologyOdds.ts` for the measurement and its limits.
   */
  gravityOdds?: {
    observedPct: number;
    smoothedPct: number;
    /** Bodies behind the figure. Small at the ends of the curve; shown so the row can say so. */
    bodies: number;
    bandLabel: string;
  } | null;
}

export interface GalaxyBodyHitDTO {
  systemAddress: number;
  starSystem: string;
  x: number;
  y: number;
  z: number;
  regionId: number;
  /** The primary's spectral class as the dump writes it — `K3`, `M9`. Empty when it named none. */
  starType: string;
  distanceLy: number | null;
  /** Somebody has logged a species in this system. Only ever true when the filter allowed it. */
  walked: boolean;
  /** How many bodies here carry biological signals at all, matched or not. */
  bioBodyCount: number;
  bodies: GalaxyBodyMatchDTO[];
}

/**
 * The answer to "where could this be, where nobody has looked".
 *
 * Every count is reported because the claim is a weak one and the reader has to be able to size it:
 * how many bodies were looked at, how many cleared the cheap numeric gate, how many the matcher
 * actually accepted. A bare list of names would read as certainty this does not have — these are
 * bodies whose conditions suit the species, not sightings.
 */
export interface GalaxyBodyScanDTO {
  /** False when this machine has no body file. The feature hides rather than showing nothing. */
  available: boolean;
  regionId: number;
  regionName: string | null;
  /** Systems in the region that held at least one body worth handing to the matcher. */
  systemsWithCandidates: number;
  /**
   * How many of the region's systems the walk actually reached.
   *
   * Equal to {@link systemsInRegion} unless {@link truncated}, and the pair is what makes a
   * truncated answer honest: a region is walked in system order, so stopping early leaves a prefix
   * rather than a sample, and a list headed "nearest first" over a prefix would be confidently
   * wrong. The panel reports the fraction instead of implying the whole.
   */
  systemsSearched: number;
  systemsInRegion: number;
  /** Bodies with biological signals walked in this region. */
  bodiesScanned: number;
  /** Of those, how many cleared the evidence filter and the numeric bands. */
  bodiesGated: number;
  /**
   * Dropped by {@link GalaxyBodyScanQueryDTO.minGravityOddsPct}, when one was set.
   *
   * Reported rather than left implicit: a filter that only makes a list shorter cannot be told apart
   * from a region with nothing in it, and the commander should be able to see what their own floor
   * cost them. Always 0 when no floor was asked for.
   */
  bodiesBelowGravityFloor?: number;
  /** Of those, how many the full matcher accepted un-demoted. */
  bodiesMatched: number;
  matchedSystems: number;
  speciesConsidered: number;
  /** The walk ran out of time before the region ended; {@link systemsSearched} says how far it got. */
  truncated: boolean;
  elapsedMs: number;
  /** The nearest systems, for the list. */
  hits: GalaxyBodyHitDTO[];
  /** One system per sector cell, for the map — see `galaxyValueSearch`'s spread for why. */
  spread?: GalaxyBodyHitDTO[];
  spreadCells?: number;
}

export interface FirstDiscoveryBacklogRowDTO {
  bodyKey: string;
  systemAddress: number;
  starSystem: string;
  bodyName: string;
  /** FSS biological signal count — how many species the game says are down there. */
  biologicalSignals: number;
  /** Guaranteed floor at 5x: every slot pays its cheapest candidate. */
  minCr: number;
  /** Ceiling at 5x: every slot pays its dearest. */
  maxCr: number;
  /** Distinct predicted species carrying a list price. */
  candidateCount: number;
  /** True once a DSS has named the genera, which narrows the prediction sharply. */
  genusKnown: boolean;
  dssComplete: boolean;
  /**
   * This commander scanned the system's main star before anyone else had.
   *
   * Not a condition of appearing — footfall is claimed body by body — but the strongest single
   * indicator that the 5x is really still there, since nobody had been in the system at all.
   */
  firstDiscovery: boolean;
  /**
   * Straight-line distance from the commander, in light years, or null before their first jump.
   *
   * Attached per request rather than with the rest of the row: the row is memoised behind a species
   * match that costs ~45 s, and the commander moves constantly. Baking a distance into that cache
   * would freeze it at whatever system they were in when the panel was first opened.
   */
  distanceLy: number | null;
  /**
   * The journal has actually reported this body unwalked, rather than never mentioning it.
   *
   * `WasFootfalled` did not exist before 2025-09-29, so on older scans the field is absent, not
   * false. A row without this is a plausible target, not a verified one, and must not be drawn as
   * though the bonus were confirmed.
   */
  footfallObserved: boolean;
  /**
   * Species here that would be new to the commander's codex in this body's region (guild tester
   * report, 2026-09-30), counted only when it is the only likely candidate of its genus on the body
   * (owner, 2026-10-01; firstDiscoveryBacklog.ts `codexWorthATrip`). The colour is not judged.
   */
  codexNew?: string[];
  /**
   * Someone has walked this body: no 5x, priced at 1x. Listed only for its codex entries — the rows
   * the "Codex missed" filter adds — and never in the totals.
   */
  footfallLost?: boolean;
}

/**
 * One system on the galaxy map's backlog layer: its position, and what is left in it.
 *
 * Systems rather than bodies, because the map plots places and a system with four unfinished bodies
 * is one dot, not four. `floorCr` sums the bodies so the minimum-value filter is answering "is this
 * system worth the detour", which is the question a route is planned on.
 */
export interface BacklogSystemDTO {
  systemAddress: number;
  starSystem: string;
  x: number;
  y: number;
  z: number;
  bodies: number;
  /** Summed guaranteed floor across this system's unfinished bodies, at 5x. */
  floorCr: number;
  /** Summed ceiling. */
  ceilingCr: number;
  /** This commander scanned the main star first. */
  firstDiscovery: boolean;
  /** Every body here has a journal statement that it is unwalked. */
  allVerified: boolean;
  /** Straight-line distance from the commander, in light years. Null when their position is unknown. */
  distanceLy: number | null;
}

export interface BacklogMapDTO {
  systems: BacklogSystemDTO[];
  /** Backlog systems with no `StarPos` in the journals, so nothing can place them. */
  unplaceable: number;
}

export interface FirstDiscoveryBacklogDTO {
  /** Ranked by `minCr`, highest first. */
  rows: FirstDiscoveryBacklogRowDTO[];
  systemCount: number;
  /** How many rows are in systems this commander discovered. */
  firstDiscoveryCount: number;
  /** How many rows have a journal statement that the body was unwalked. */
  footfallObservedCount: number;
  totalMinCr: number;
  totalMaxCr: number;
  computedAt: string;
}

/** One system from the galaxy index, for the 3D map's panel (`/api/galaxy/system?i=`). */
export interface GalaxySystemDTO {
  /** Position in the bio index; what the map's tiles and picking carry. */
  ordinal: number;
  id64: string;
  name: string;
  x: number;
  y: number;
  z: number;
  region: string | null;
  /** Spansh's body count; null when unknown (not the same as none). */
  bodyCount: number | null;
  /** How the system's biology is known: signals seen, mapped, codex-logged, bodies catalogued. */
  evidence: { fss: boolean; dss: boolean; codex: boolean; bodiesKnown: boolean };
  /** Recorded species, 1× prices (null where the price list has none). */
  species: { speciesId: string; displayName: string; genusDir: string; baseCr: number | null }[];
  /** Sum of the recorded species at 1× — other commanders' records, so first footfall is mostly taken. */
  valueCr: number;
  distanceFromSolLy: number;
}

/** The commander's systems for the 3D map (`/api/galaxy/mine`); flags are MINE_* in galaxyMine.ts. */
export interface GalaxyMineDTO {
  available: boolean;
  systems: {
    addr: number;
    name: string;
    x: number;
    y: number;
    z: number;
    flags: number;
    bioBodies: number;
    /** Species this commander scanned on foot here. */
    speciesScanned: number;
    /** Set when bio bodies here still wait for them (the backlog), with its floor value. */
    unfinishedFloorCr: number | null;
  }[];
  /** Systems in the journals with no StarPos, so nothing can place them. */
  unplaceable: number;
}

/** One of the commander's systems, body by body (`/api/galaxy/mine/system?addr=`). */
export interface GalaxyMySystemDTO {
  addr: number;
  name: string;
  x: number | null;
  y: number | null;
  z: number | null;
  flags: number;
  unfinishedFloorCr: number | null;
  bodies: {
    name: string;
    signals: number;
    dss: boolean;
    firstFootfall: boolean;
    species: { name: string; analysed: boolean }[];
  }[];
  /** The galaxy index's ordinal for the same system, when it has one (then its record can be shown too). */
  indexOrdinal: number | null;
}

/** This session's jumps with positions, and where the ship is (`/api/galaxy/route`). */
export interface GalaxyRouteDTO {
  position: { x: number; y: number; z: number } | null;
  system: string | null;
  route: { name: string; at: string; x: number; y: number; z: number }[];
}

/** The 3D map's Find box (`/api/galaxy/find?q=`). */
export interface GalaxyFindDTO {
  query: string;
  /** Sector columns (every height merged) whose name matches, with their centroid and size. */
  sectors: { name: string; x: number; y: number; z: number; systems: number }[];
  /** The commander's systems first (`mine`, by `addr`), then the galaxy index's (by `ordinal`). */
  systems: { name: string; x: number; y: number; z: number; ordinal: number | null; addr: string | null; mine: boolean }[];
  /** The index scan stopped at its time budget: there may be more. */
  partial: boolean;
}

/** One sector column's panel (`/api/galaxy/sector?c=cx:cz`): its size and most valuable systems. */
export interface GalaxySectorDTO {
  name: string | null;
  systems: number;
  top: { ordinal: number; name: string; valueCr: number; species: number; x: number; y: number; z: number }[];
}

/** Next target (`/api/galaxy/next`): the nearest system worth at least X that the commander has not done. */
export interface GalaxyNextDTO {
  /** Where the distances are measured from (the ship); null when unknown, and then nothing is picked. */
  from: { x: number; y: number; z: number } | null;
  /** Systems that clear the value and are not excluded, galaxy-wide. */
  qualifying: number;
  target: GalaxyNextRow | null;
  /** The next nearest after the target (for Skip without a round trip, and a short list). */
  next: GalaxyNextRow[];
  /**
   * G5.3, when asked for (`plan=N`): a greedy chain from the ship — the target first, then each time
   * the nearest qualifying system to the last stop. Absent when not asked or nothing qualifies.
   */
  plan?: {
    stops: (GalaxyNextRow & { legLy: number })[];
    /** Sum of the legs, ship to the last stop. */
    totalLy: number;
    /** Sum of the stops' recorded species at 1×. */
    totalValueCr: number;
    /** Hops that needed a pass over the whole index (diagnostics; 0 in a dense neighbourhood). */
    fullPasses: number;
  };
}

export interface GalaxyNextRow {
  ordinal: number;
  name: string;
  x: number;
  y: number;
  z: number;
  /** Recorded species at 1×. */
  valueCr: number;
  species: number;
  distanceLy: number;
}
