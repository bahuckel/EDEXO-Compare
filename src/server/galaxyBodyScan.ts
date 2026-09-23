/**
 * "Where could this plant be, in places nobody has looked?"
 *
 * The counterpart to `galaxyValueSearch.ts`, and the difference between them is the whole point.
 * That one lists **sightings**: somebody landed, logged a species, and the codex recorded it. This
 * one lists **shortlists**: nobody has landed, and the body's own physics say the app would offer
 * that species if the commander were standing there reading their FSS.
 *
 * The owner's words for it: *"someone might have just FSS-ed the place and left without scanning any
 * plant or DSS-ing the planet, but when we have atmosphere, gravity, temperatures and so on, and we
 * know if its landable, we can pretty easily determine if there is going to be plant X… what we do
 * in the main UI of the map, just sector/region/galaxy wide."*
 *
 * ## Gates, not ranking — and the UI has to say so
 *
 * A row here means the species survived the same criteria the body panel applies, un-demoted. It
 * does **not** mean the plant is there. The codex criteria are deliberately wider than the observed
 * envelope: in the first Hawking's Gap run one hit sat at 0.280 g where the Fonticulua fluctus
 * *profile* tops out at 0.273. A shortlist of places worth the detour, never a promise.
 *
 * The posterior is not used and cannot be. `presenceProbabilityPercent` is normalised against the
 * other candidates on the body and leans on the commander's own observation history; ranking ten
 * million strangers' bodies by it would read as precision this has no right to.
 *
 * ## Why a region at a time
 *
 * A region is a search; the galaxy is a coffee break. The owner asked for it this way — *"To make
 * it faster, can we just search a certain sector or region?"* Measured on the built file:
 *
 * ```
 *   Hawking's Gap      201,131 systems    400,598 bio bodies
 *     one species                                    1.2 s
 *     a whole genus                                  5.3 s
 *   Inner Orion Spur 1,571,628 systems  3,212,561 bio bodies   <- the largest, by a long way
 *     one species                                    5-7 s
 *     a whole genus                                   26 s
 * ```
 *
 * ## Three things make that possible
 *
 * **A cheap gate first.** Landability and the numeric bands the wanted species declare, read
 * straight off the fixed-stride record. It is deliberately a *superset* of the matcher's: the bands
 * are widened by {@link NUMERIC_GATE_TOLERANCE}, the same slack `rangeFit` allows before it calls a
 * value "out", so nothing the matcher would have accepted can be discarded before it gets there. A
 * speed-up, not a second opinion.
 *
 * **Only the wanted species.** `matchDatabaseToScan` weighs all 108 against every body, which
 * measured 23 s for one small region and threw 107 verdicts away each time.
 * `speciesMatchesCriteria` is the same function it calls per entry, so the gates are identical.
 *
 * **Bounded storage.** Stratum across Inner Orion Spur matches 357,089 bodies in 234,807 systems;
 * holding those as DTOs was just under a gigabyte for a list that shows two hundred. The counters
 * stay exact and only the nearest few hundred systems are kept, so nearest-first is still exact —
 * the walk covers the whole region and only the losers are dropped.
 *
 * And it yields to the event loop as it goes, because 26 seconds of uninterrupted work would stop
 * the journal watcher and the websocket with it.
 *
 * ## Units
 *
 * The dump records gravity in Earth gees and pressure in atmospheres; the journal writes m/s² and
 * pascals. So `SurfaceGravity` is multiplied back up by `EARTH_G_MS2` on the way in, because the
 * matcher's first move is to divide it again — pass the gees straight through and a 2.5 g world
 * reads as 0.255 g, which is not an error, just a different planet.
 *
 * Pressure goes in as **atmospheres**, which looks wrong and is not. The two gates that read it
 * both want atm: one compares `scan.SurfacePressure` directly against the criteria's atm range, and
 * the other reads `matchContext.surfacePressureAtm`, which is set here explicitly. Neither calls
 * `journalPressureToAtm` — the function that guesses pascals-or-atm from a threshold of 40 — so the
 * guess never runs and a 50 atm body is not quietly reinterpreted as half a pascal.
 */
import {
  BODY_DSS,
  loadBioBodies,
  readBioBodiesSummary,
  type BioBodyCursor,
  type BioBodyRow,
} from "./bioBodies.js";
import { loadBioIndex } from "./bioIndex.js";
import { clearsGravityOdds, gravityBiologyOdds } from "./gravityBiologyOdds.js";
import {
  demoteFailedHostStarGates,
  demoteFailedSpatialGates,
  speciesMatchesCriteria,
  speciesMatchesExcludingTempPressure,
  NUMERIC_GATE_TOLERANCE,
  type PlanetTemperatureBand,
} from "./matchSpecies.js";
import { estimatedTemperatureRangeForScan } from "./planetTemperature.js";
import { loadSpatialCatalogue } from "./spatialCatalogue.js";
import { getCachedPriceIndex, getCachedSpeciesDatabase } from "./snapshot.js";
import { lookupPrice } from "./priceList.js";
import { EARTH_G_MS2 } from "../shared/journalPhysics.js";
import { spectralKeysFromJournalStarType } from "../shared/starSpectralKeys.js";
import { journalPlanetClass } from "../shared/spanshPlanetClass.js";
import { sectorCellFromCoords, sectorCellKey } from "../shared/sectorName.js";
import { getProjectRoot } from "./paths.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { RegionMapData } from "../shared/regionMap.js";
import type {
  GalaxyBodyHitDTO,
  GalaxyBodyMatchDTO,
  GalaxyBodyScanDTO,
  GalaxyBodyScanQueryDTO,
  GalaxyRegionOptionDTO,
  GalaxyRegionsDTO,
  PlanetScan,
  SpeciesEntry,
  SpeciesMatch,
  SpeciesMatchContext,
} from "../shared/types.js";

export interface GalaxyBodyScanQuery extends GalaxyBodyScanQueryDTO {
  /** Measure distance from here; without it the rows are ordered by how many bodies matched. */
  from?: { x: number; y: number; z: number } | null;
  /** How many systems to return. */
  limit?: number;
}

/**
 * How long one request may walk before it stops and says how far it got.
 *
 * A **time** budget rather than a cap on matches, and the difference matters. The first version
 * stopped after 400,000 matching bodies, which is reachable — Tussock across Inner Orion Spur hits
 * it having seen 1.4 M of the region's 3.2 M bodies. Stopping there truncates in **encounter
 * order**, so a list headed "nearest first" was drawn from an arbitrary prefix of the region:
 * confidently wrong, and invisible, because the rows it did show were all real.
 *
 * Storage is bounded by pruning instead (see the walk), so the only thing left worth bounding is
 * the wait. When this bites, {@link GalaxyBodyScanDTO.systemsSearched} against
 * {@link GalaxyBodyScanDTO.systemsInRegion} says exactly how much of the region the answer covers,
 * and the panel reports the fraction rather than implying the whole.
 */
const TIME_BUDGET_MS = 20_000;

/**
 * Whether a planet class can ever suit one of the wanted species, decided once per class.
 *
 * The matcher's planet-class verdict is a pure function of the class string and the species — the
 * codex list, or `observedOnPlanetClass` overruling it — so it can be asked in advance and reused
 * across millions of bodies. The probe calls the matcher's own
 * {@link speciesMatchesExcludingTempPressure} rather than reimplementing the rule, and reads only
 * whether a `PlanetClass` failure came back; every other gate failing on a bare scan is expected
 * and ignored.
 *
 * This is what makes a whole-genus search bearable. Brain Trees allow two of the six classes the
 * file holds, Stratum two, Tussock three — and a class the genus cannot use is a body the full
 * matcher never has to see.
 */
function planetClassMask(entries: readonly SpeciesEntry[], classes: readonly string[]): Set<string> {
  const allow = new Set<string>();
  for (const cls of classes) {
    if (!cls) {
      // A body the dump never classified cannot be judged here; let the matcher have it.
      allow.add(cls);
      continue;
    }
    const scan = {
      BodyName: "probe",
      BodyID: 0,
      StarSystem: "probe",
      SystemAddress: 0,
      PlanetClass: planetClassFromDump(cls),
    } as PlanetScan;
    for (const entry of entries) {
      const r = speciesMatchesExcludingTempPressure(entry, scan, null);
      if (r.ok || !r.reasons.some((f) => f.field === "PlanetClass")) {
        allow.add(cls);
        break;
      }
    }
  }
  return allow;
}

/**
 * The same trick for atmospheres, and it only works for some species.
 *
 * Where the codex names actual atmospheres, the verdict is a pure function of the atmosphere string
 * and the mask is exact. Where it means "any thin atmosphere", the gate consults the body's
 * *pressure* instead, and no amount of asking about the string can answer it — so those species are
 * left out of the mask entirely and contribute "allow everything", which is the safe direction.
 *
 * `atmospherePressureCategory` is the flag that tells the two apart, and it is exactly the case
 * that pays: Brain Trees want vacuum and nothing else, so this takes them from 3.2 M bodies to the
 * 428 airless ones in the largest region.
 */
function atmosphereMask(
  entries: readonly SpeciesEntry[],
  atmospheres: readonly string[],
): Set<string> | null {
  const maskable = entries.filter((e) => !e.criteria.atmospherePressureCategory);
  if (maskable.length !== entries.length) return null;
  const allow = new Set<string>();
  for (const atmo of atmospheres) {
    const scan = {
      BodyName: "probe",
      BodyID: 0,
      StarSystem: "probe",
      SystemAddress: 0,
      PlanetClass: "Rocky body",
      AtmosphereType: atmosphereTypeFromDump(atmo),
      Atmosphere: atmo || undefined,
    } as PlanetScan;
    for (const entry of maskable) {
      const r = speciesMatchesExcludingTempPressure(entry, scan, null);
      if (r.ok || !r.reasons.some((f) => f.field === "AtmosphereType")) {
        allow.add(atmo);
        break;
      }
    }
  }
  return allow;
}

/** Bands a body must be inside for the species to have any chance, read straight off the criteria. */
interface CheapGate {
  needLandable: boolean;
  tMin: number;
  tMax: number;
  gMin: number;
  gMax: number;
  pMin: number;
  pMax: number;
}

const WIDE: CheapGate = {
  needLandable: false,
  tMin: -Infinity,
  tMax: Infinity,
  gMin: -Infinity,
  gMax: Infinity,
  pMin: -Infinity,
  pMax: Infinity,
};

/** Widen an edge outwards by the matcher's own tolerance, so this gate can never be the stricter one. */
const loosenLow = (v: number | undefined): number =>
  v === undefined ? -Infinity : v - Math.abs(v) * NUMERIC_GATE_TOLERANCE;
const loosenHigh = (v: number | undefined): number =>
  v === undefined ? Infinity : v + Math.abs(v) * NUMERIC_GATE_TOLERANCE;

/**
 * The union of what the wanted species will accept.
 *
 * Union rather than intersection: several species are an "or", and a body only has to suit one of
 * them. `needLandable` is the one conjunction — it survives only if *every* wanted species demands
 * it, because a single species that does not would make the body worth showing.
 */
function cheapGateFor(entries: readonly SpeciesEntry[]): CheapGate {
  if (entries.length === 0) return WIDE;
  const g: CheapGate = {
    needLandable: true,
    tMin: Infinity,
    tMax: -Infinity,
    gMin: Infinity,
    gMax: -Infinity,
    pMin: Infinity,
    pMax: -Infinity,
  };
  for (const e of entries) {
    const c = e.criteria;
    if (c.landable !== true) g.needLandable = false;
    g.tMin = Math.min(g.tMin, loosenLow(c.surfaceTemperatureK?.min));
    g.tMax = Math.max(g.tMax, loosenHigh(c.surfaceTemperatureK?.max));
    g.gMin = Math.min(g.gMin, loosenLow(c.surfaceGravity?.min));
    g.gMax = Math.max(g.gMax, loosenHigh(c.surfaceGravity?.max));
    g.pMin = Math.min(g.pMin, loosenLow(c.surfacePressure?.min));
    g.pMax = Math.max(g.pMax, loosenHigh(c.surfacePressure?.max));
  }
  return g;
}

/**
 * Does this body clear the cheap gate?
 *
 * A zero is "the dump did not record it", not a measurement of zero, so an absent figure never
 * fails a band — the full matcher is the right place to decide what a missing value means, and it
 * already has an answer for it.
 */
function passesCheapGate(b: BioBodyCursor, g: CheapGate): boolean {
  if (g.needLandable && !b.landable) return false;
  const t = b.temperatureK;
  if (t > 0 && (t < g.tMin || t > g.tMax)) return false;
  const gr = b.gravityG;
  if (gr > 0 && (gr < g.gMin || gr > g.gMax)) return false;
  const p = b.pressureAtm;
  if (p > 0 && (p < g.pMin || p > g.pMax)) return false;
  return true;
}

/**
 * The dump does not spell a planet class the way the journal does, and the difference is not cosmetic.
 *
 * Spansh writes `High metal content world` and `Rocky Ice world`; the journal — and therefore every
 * `planetClassAnyOf` in the species data — writes `High metal content body` and `Rocky ice body`.
 * The comparison in the matcher is an exact string match, so handing the dump's spelling straight
 * across means the codex list never matches and the row survives only if
 * `observedOnPlanetClass` happens to overrule it.
 *
 * That is **806,020 bodies in Inner Orion Spur alone — 25 % of the region** — arriving under a name
 * the species data does not use. Well-observed species were rescued by the corpus and looked fine,
 * which is exactly why this was invisible: Stratum tectonicas came back with High metal content
 * worlds throughout, through the escape hatch rather than through the gate.
 *
 * `Icy body` and `Rocky body` are spelled the same on both sides. `Metal-rich body` was once listed
 * here as one of them; it is not — the journal writes `Metal rich body` — and neither are Spansh's
 * gas giants. All of them now go through one shared table.
 */
export function planetClassFromDump(subType: string): string | undefined {
  // One table for every Spansh/EDSM path — see `shared/spanshPlanetClass.ts`, which also corrects
  // `Metal-rich body`: the journal writes it without the hyphen.
  return journalPlanetClass(subType);
}

/**
 * The same problem, much smaller, for atmospheres.
 *
 * The journal splits what Spansh joins: `AtmosphereType` is the composition alone (`SulphurDioxide`)
 * and `Atmosphere` carries the prose (`hot thin sulphur dioxide atmosphere`). The dump writes one
 * string for both, and `normalizeScanAtmosphereForMatch` already strips a leading `Thin` or `Thick`
 * — but not `Hot`, so `Hot thin Sulphur dioxide` keys as itself and matches no species.
 *
 * 46 bodies in Inner Orion Spur, against 806,020 for the planet class. Fixed because it is one
 * regex and the alternative is a silent miss, not because it is common.
 */
export function atmosphereTypeFromDump(atmosphere: string): string | undefined {
  if (!atmosphere) return undefined;
  const t = atmosphere.replace(/^\s*(hot|cold|warm)\s+/i, "").trim();
  return t || undefined;
}

/**
 * Does this body have an atmosphere, as the dump spells it?
 *
 * The gravity curve was measured on atmosphere-bearing bodies only, and the airless population it
 * was measured beside carries biology at 0 in 8,239 — so applying the curve's numbers to an airless
 * row would answer a question they were never measured on.
 */
function dumpBodyHasAtmosphere(atmosphere: string): boolean {
  const a = atmosphere.trim();
  return a !== "" && !/^no atmosphere$/i.test(a);
}

/** A body record turned into the shape the matcher reads. */
function scanFromBody(
  row: BioBodyRow,
  systemName: string,
  bodyName: string,
  systemAddress: number,
): PlanetScan {
  return {
    BodyName: bodyName,
    BodyID: row.bodyId,
    StarSystem: systemName,
    SystemAddress: systemAddress,
    PlanetClass: planetClassFromDump(row.subType),
    AtmosphereType: atmosphereTypeFromDump(row.atmosphere),
    // The prose form keeps the dump's whole string, `Hot` and all, exactly as the journal's own
    // `Atmosphere` field does — the temperature estimator reads it for "thin" and "thick".
    Atmosphere: row.atmosphere || undefined,
    // The dump's gees back into the journal's m/s², because that is what the matcher converts from.
    SurfaceGravity: row.gravityG > 0 ? row.gravityG * EARTH_G_MS2 : undefined,
    SurfaceTemperature: row.temperatureK > 0 ? row.temperatureK : undefined,
    // Atmospheres, matching the criteria's own unit; see the note at the top of this file.
    SurfacePressure: row.pressureAtm > 0 ? row.pressureAtm : undefined,
    Volcanism: row.volcanism || undefined,
    Landable: (row.flags & 1) !== 0,
  };
}

/**
 * The host star, as far as this file knows it.
 *
 * The dump writes a spectral class (`K3`, `M9`) where the journal writes a `StarType`, so the
 * fragment gates read the raw string — `parentStarTypeIncludesAnyOf: ["K"]` is a substring test and
 * `K3` contains `K`. The class *set* needs the shared parser, which also knows that `M_RedGiant8`
 * is an M (§41); when that finds nothing, the leading letters are the class.
 */
function hostStarClassesOf(starType: string): string[] {
  if (!starType) return [];
  const keys = spectralKeysFromJournalStarType(starType);
  if (keys.length > 0) return keys;
  const head = starType.match(/^([A-Za-z]{1,3})/);
  return head ? [head[1]!.toUpperCase()] : [];
}

/** Which species the commander asked about, resolved against the database. */
function wantedEntries(query: GalaxyBodyScanQuery): SpeciesEntry[] {
  const db = getCachedSpeciesDatabase();
  const ids = new Set(query.speciesIds ?? []);
  if (ids.size > 0) return db.species.filter((e) => ids.has(e.id));
  const dirs = new Set(query.genusDirs ?? []);
  if (dirs.size > 0) return db.species.filter((e) => dirs.has(e.genusDataDir));
  return [];
}

function distance(
  a: { x: number; y: number; z: number } | null | undefined,
  b: { x: number; y: number; z: number },
): number | null {
  if (!a) return null;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** What the demotion helpers mutate — the rows `matchDatabaseToScan` builds, minus the display fields. */
type MatchRow = Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">;

/**
 * The body's temperature band, which for a dump record is a measurement or nothing.
 *
 * `matchDatabaseToScan` resolves this the same way: a measured temperature is a band of zero width,
 * and only a body the dump never measured falls back to the estimator.
 */
function tempBand(scan: PlanetScan): PlanetTemperatureBand | null {
  const t = scan.SurfaceTemperature;
  if (t != null && !Number.isNaN(t)) return { minK: t, maxK: t };
  const est = estimatedTemperatureRangeForScan(scan);
  return est ? { minK: est.tMin, maxK: est.tMax } : null;
}

function empty(regionId: number, available: boolean): GalaxyBodyScanDTO {
  return {
    available,
    regionId,
    regionName: regionName(regionId),
    systemsWithCandidates: 0,
    systemsSearched: 0,
    systemsInRegion: 0,
    bodiesScanned: 0,
    bodiesGated: 0,
    bodiesBelowGravityFloor: 0,
    bodiesMatched: 0,
    matchedSystems: 0,
    speciesConsidered: 0,
    truncated: false,
    elapsedMs: 0,
    hits: [],
    spread: [],
  };
}

let regionNamesCache: readonly (string | null)[] | null = null;

function regionNames(): readonly (string | null)[] {
  if (regionNamesCache) return regionNamesCache;
  try {
    const file = path.join(getProjectRoot(), "data", "exomastery", "region-map.json");
    const data = JSON.parse(readFileSync(file, "utf8")) as RegionMapData;
    return (regionNamesCache = data.regions);
  } catch {
    return (regionNamesCache = []);
  }
}

function regionName(regionId: number): string | null {
  return regionNames()[regionId] ?? null;
}

/**
 * The regions this file actually holds, with their system counts.
 *
 * The counts are the point: a picker that offers all forty-two identically hides the fact that
 * Inner Orion Spur carries two orders of magnitude more systems than the far arms, which is the
 * difference between a one-second search and a slow one.
 */
let regionsCache: GalaxyRegionsDTO | null = null;

export function galaxyRegions(): GalaxyRegionsDTO {
  if (regionsCache) return regionsCache;
  /*
    A partial read, not `loadBioBodies`.

    The map screen asks for this the moment it opens. Answering it by loading the file would leave
    536 MB resident for the rest of the session on the strength of somebody looking at a map, so the
    summary reads only the region byte of each system record and keeps nothing. The file itself is
    loaded when a scan is actually run.
  */
  const summary = readBioBodiesSummary();
  if (!summary) {
    return (regionsCache = { available: false, regions: [], systemCount: 0, bodyCount: 0, fileBytes: 0 });
  }
  const counts = summary.systemsByRegion;
  const names = regionNames();
  const regions: GalaxyRegionOptionDTO[] = [];
  for (let i = 1; i < counts.length; i++) {
    const systems = counts[i]!;
    if (systems === 0) continue;
    regions.push({ regionId: i, name: names[i] ?? `Region ${i}`, systemCount: systems });
  }
  regions.sort((a, b) => a.name.localeCompare(b.name));
  return (regionsCache = {
    available: true,
    regions,
    systemCount: summary.systemCount,
    bodyCount: summary.bodyCount,
    fileBytes: summary.fileBytes,
  });
}

/** Test seam. */
export function clearGalaxyRegionsCache(): void {
  regionsCache = null;
  regionNamesCache = null;
}

/**
 * A galaxy-wide-looking sample for the map: one system per sector cell.
 *
 * The same reasoning as `galaxyValueSearch`'s spread — the list answers "which of these is nearest"
 * and the map answers "where does this live", and a nearest-first sample collapses into a dozen
 * pixels around the commander. Within a region the effect is milder, but a region is still 2,000 ly
 * across and the map is what the owner cares about.
 */
const SPREAD_CELLS = 500;

export async function galaxyBodyScan(query: GalaxyBodyScanQuery): Promise<GalaxyBodyScanDTO> {
  const t0 = Date.now();
  const file = loadBioBodies();
  const regionId = Math.trunc(query.regionId);
  if (!file) return empty(regionId, false);
  if (!(regionId > 0)) return empty(regionId, true);

  const wanted = wantedEntries(query);
  if (wanted.length === 0) return empty(regionId, true);
  const wantedIds = new Set(wanted.map((e) => e.id));
  const gate = cheapGateFor(wanted);
  /*
    Asked once per distinct string rather than once per body. The file interns its vocabulary — six
    planet classes and twenty-two atmospheres across 10.3 M bodies — so these cost a few hundred
    matcher calls at setup and save millions in the walk.
  */
  const classAllowed = planetClassMask(wanted, file.planetClasses());
  const atmoAllowed = atmosphereMask(wanted, file.atmospheres());

  /*
    The evidence filter, the owner's design: three independent ticks, and unticking one excludes.
    The first two are a property of the *body* — the dump's `genuses` list is present only when
    somebody probed it. The third is a property of the *system*, and this file knows nothing about
    it: whether anybody has walked a system is exactly what `bio-index.bin` records.
  */
  const wantUnprobed = query.includeUnprobed !== false;
  const wantProbed = query.includeProbed === true;
  const wantWalked = query.includeWalked === true;
  if (!wantUnprobed && !wantProbed) return empty(regionId, true);

  const prices = getCachedPriceIndex();
  const catalogue = loadSpatialCatalogue(getProjectRoot());
  const index = loadBioIndex();

  /** Systems already ruled in or out by the codex index, so one lookup serves all of a system's bodies. */
  const systemWalked = new Map<number, boolean>();
  const walkedSystem = (systemIndex: number, id64: bigint): boolean => {
    let walked = systemWalked.get(systemIndex);
    if (walked === undefined) {
      const known = index?.lookup(id64) ?? null;
      // "Walked" means somebody logged a species here. A system with signals and nothing named is
      // still untouched, which is the whole set this feature exists to surface.
      walked = !!(known && known.species.length > 0);
      systemWalked.set(systemIndex, walked);
    }
    return walked;
  };

  /**
   * One body, decided.
   *
   * Inline in the walk rather than over a collected list: the cheap gate can leave a hundred
   * thousand rows on a loose question, and snapshotting all of them first is tens of megabytes held
   * for no reason when nearly all are about to be discarded.
   */
  const decide = (row: BioBodyRow, systemIndex: number): GalaxyBodyMatchDTO | null => {
    const sys = file.system(systemIndex);
    if (!wantWalked && walkedSystem(systemIndex, sys.id64)) return null;

    const bodyName = file.bodyName(systemIndex, row.bodyIndex);
    const scan = scanFromBody(row, sys.name, bodyName, Number(sys.id64));
    const region = regionName(sys.regionId);
    const ctx: SpeciesMatchContext = {
      systemCoords: { x: sys.x, y: sys.y, z: sys.z },
      regionIndex: sys.regionId,
      ...(region ? { regionName: region } : {}),
      ...(sys.starType ? { parentStarType: sys.starType } : {}),
      hostStarClasses: hostStarClassesOf(sys.starType),
      surfacePressureAtm: row.pressureAtm > 0 ? row.pressureAtm : null,
    };

    /*
      The wanted species only, rather than `matchDatabaseToScan`'s pass over all 108.

      This is the difference between a search and a coffee break: the full run weighs every species
      in the database against every body — measured at 23 s for one region — and 107 of those 108
      verdicts are thrown away a line later. `speciesMatchesCriteria` is the same function the full
      run calls per entry, so the gates are identical; only the ones nobody asked about are skipped.

      What is *not* reproduced is `restoreDemotionsBelowSignalCount`, which hands demotions back when
      the shown list would otherwise hold fewer genera than the FSS counted. It cannot be: that rule
      reasons about the whole candidate list, and there is no whole list here. It only ever adds
      rows, so its absence makes this shortlist narrower, never wider — the safe direction for a
      claim this weak.
    */
    const strict: MatchRow[] = [];
    const unlikely: MatchRow[] = [];
    const band = tempBand(scan);
    const est = estimatedTemperatureRangeForScan(scan);
    for (const entry of wanted) {
      const r = speciesMatchesCriteria(entry, scan, band, est, ctx);
      if (r.ok) strict.push({ entry, reasons: r.reasons });
      else if (r.softOnly) unlikely.push({ entry, reasons: r.reasons, unlikely: true });
    }
    if (strict.length === 0) return null;
    demoteFailedSpatialGates(strict, unlikely, ctx, catalogue);
    demoteFailedHostStarGates(strict, unlikely, ctx);

    /*
      Un-demoted only. `unlikely` is the matcher saying "this contradicts the body on one axis",
      which is useful on a body the commander is standing next to — where the full list is the
      honest answer — and noise in a shortlist drawn from ten million strangers' worlds.
    */
    const species = strict
      .filter((m) => wantedIds.has(m.entry.id) && !m.unlikely)
      .map((m) => {
        const baseCr = lookupPrice(prices, m.entry.displayName, m.entry.id) ?? 0;
        /*
          The 5× figure is the honest one here, and the only credit number in this feature that is
          not a guess: nobody has walked these bodies, which is the filter's whole premise, so first
          footfall is what a commander who flies out there would actually be paid.
        */
        return {
          speciesId: m.entry.id,
          displayName: m.entry.displayName,
          baseCr,
          firstFootfallCr: baseCr * 5,
        };
      })
      .sort((a, b) => b.baseCr - a.baseCr);
    if (species.length === 0) return null;

    return {
      bodyId: row.bodyId,
      bodyName,
      planetClass: row.subType,
      atmosphere: row.atmosphere,
      volcanism: row.volcanism,
      temperatureK: row.temperatureK,
      gravityG: row.gravityG,
      pressureAtm: row.pressureAtm,
      bioCount: row.bioCount,
      landable: (row.flags & 1) !== 0,
      probed: (row.flags & BODY_DSS) !== 0,
      species,
      gravityOdds: gravityBiologyOdds(row.gravityG, dumpBodyHasAtmosphere(row.atmosphere)),
    };
  };

  let bodiesScanned = 0;
  let bodiesGated = 0;
  /** Dropped by the commander's gravity floor, so the panel can say how many and not just show fewer. */
  let bodiesBelowGravityFloor = 0;
  const minGravityOddsPct = Math.max(0, Math.min(100, Math.round(query.minGravityOddsPct ?? 0)));
  let bodiesMatched = 0;
  let matchedSystems = 0;
  let truncated = false;
  const candidateSystems = new Set<number>();

  const limit = Math.max(1, Math.min(query.limit ?? 200, 2000));
  /*
    Bounded storage, because the counts and the rows are different sizes of answer.

    Stratum in Inner Orion Spur matches 357,089 bodies across 234,807 systems, and holding all of
    them as DTOs measured just under a gigabyte of heap for a list that shows two hundred. The
    counters below stay exact — they are integers — while only the nearest few hundred systems are
    kept, pruned whenever the buffer grows past a few times the limit. Nearest-first is therefore
    still *exact*: the walk covers the whole region and only the losers are discarded.
  */
  const kept: GalaxyBodyHitDTO[] = [];
  const better = query.from
    ? (a: GalaxyBodyHitDTO, b: GalaxyBodyHitDTO) => {
        if (a.distanceLy == null) return b.distanceLy == null ? 0 : 1;
        if (b.distanceLy == null) return -1;
        return a.distanceLy - b.distanceLy;
      }
    : (a: GalaxyBodyHitDTO, b: GalaxyBodyHitDTO) => b.bodies.length - a.bodies.length;
  const prune = () => {
    if (kept.length <= limit * 4) return;
    kept.sort(better);
    kept.length = limit;
  };

  // One system per sector cell for the map. Bounded by the region's own footprint — a region spans
  // a few hundred 1,280 ly cells — so this needs no pruning of its own.
  const best = new Map<string, GalaxyBodyHitDTO>();

  const systems = file.regionSystemIndices(regionId);
  let systemsSearched = 0;
  for (let s = 0; s < systems.length; s++) {
    const systemIndex = systems[s]!;
    systemsSearched++;
    let rows: GalaxyBodyMatchDTO[] | null = null;
    file.forEachBodyOfSystem(systemIndex, (b) => {
      bodiesScanned++;
      const probed = (b.flags & BODY_DSS) !== 0;
      if (probed ? !wantProbed : !wantUnprobed) return;
      if (!classAllowed.has(b.subType)) return;
      if (atmoAllowed && !atmoAllowed.has(b.atmosphere)) return;
      if (!passesCheapGate(b, gate)) return;
      /*
        The commander's gravity floor, when they set one.

        Here rather than after the matcher because it is cheap and skipping the matcher is the
        expensive work saved — and it is counted *out* of `bodiesGated`, so the panel's "gated" and
        "matched" figures keep meaning what they have always meant. Unlike everything else in this
        gate it is not a superset of the matcher: it is the commander deliberately narrowing the
        shortlist, which is why it is off unless asked for.
      */
      if (
        minGravityOddsPct > 0 &&
        !clearsGravityOdds(b.gravityG, dumpBodyHasAtmosphere(b.atmosphere), minGravityOddsPct)
      ) {
        bodiesBelowGravityFloor++;
        return;
      }
      bodiesGated++;
      candidateSystems.add(systemIndex);
      const hit = decide(b.snapshot(), systemIndex);
      if (!hit) return;
      bodiesMatched++;
      if (rows) rows.push(hit);
      else rows = [hit];
      return;
    });

    if (rows) {
      matchedSystems++;
      const sys = file.system(systemIndex);
      const hit: GalaxyBodyHitDTO = {
        systemAddress: Number(sys.id64),
        starSystem: sys.name,
        x: sys.x,
        y: sys.y,
        z: sys.z,
        regionId: sys.regionId,
        starType: sys.starType,
        distanceLy: distance(query.from, sys),
        walked: walkedSystem(systemIndex, sys.id64),
        bioBodyCount: sys.bioBodyCount,
        bodies: (rows as GalaxyBodyMatchDTO[]).sort((a, b) => b.bioCount - a.bioCount || a.bodyId - b.bodyId),
      };
      kept.push(hit);
      prune();
      const key = sectorCellKey(sectorCellFromCoords(hit.x, hit.y, hit.z));
      const held = best.get(key);
      if (!held || hit.bodies.length > held.bodies.length) best.set(key, hit);
    }

    /*
      Give the event loop a turn, and check the clock while we are here.

      Seconds of *uninterrupted* work would stop the journal watcher, the websocket and every other
      request in the process — a commander flying while they search would watch the app go deaf.
      Every 4,096 systems costs a few milliseconds of latency at most.

      The budget is checked at the same boundary because a region is walked in system order, so
      stopping anywhere makes the answer a prefix of the region rather than a sample of it. That is
      only honest if the caller is told, which is what `systemsSearched` is for.
    */
    if ((s & 0x0fff) === 0x0fff) {
      await new Promise<void>((r) => setImmediate(r));
      if (Date.now() - t0 > TIME_BUDGET_MS) {
        truncated = true;
        break;
      }
    }
  }

  kept.sort(better);
  const hits = kept.slice(0, limit);
  const spread = [...best.values()].sort((a, b) => b.bodies.length - a.bodies.length).slice(0, SPREAD_CELLS);

  return {
    available: true,
    regionId,
    regionName: regionName(regionId),
    systemsWithCandidates: candidateSystems.size,
    systemsSearched,
    systemsInRegion: systems.length,
    bodiesScanned,
    bodiesGated,
    bodiesBelowGravityFloor,
    bodiesMatched,
    matchedSystems,
    speciesConsidered: wanted.length,
    truncated,
    elapsedMs: Date.now() - t0,
    hits,
    spread,
    spreadCells: best.size,
  };
}
