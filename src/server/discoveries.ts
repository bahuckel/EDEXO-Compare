/**
 * Everything the commander has scanned, as three searchable tables.
 *
 * "My discoveries" has always shown what he confirmed on foot — 373 rows of certainty, and a tiny
 * fraction of where he has actually been. The journals hold the rest: every star, every body, every
 * system he ever honked, with the physics already merged. None of it was reachable.
 *
 * ## Why a request rather than the snapshot
 *
 * The store holds ~14,000 scanned bodies. Putting that on the websocket snapshot would send it on
 * every tick, to pay for a panel that is closed almost all of the time. So it is built on demand,
 * the way the feeder status is, and the cost lands on opening the panel.
 *
 * ## Value, and the two kinds of number in here
 *
 * **Estimated** is what the app thinks a body is worth — `explorationValue.ts`'s model, the same one
 * the system map prices with. **Sold** is what the commander was actually paid, from the journal's
 * own sale events. They are different claims and are never added together or silently swapped: a
 * system he has sold reads its real payment, one he is holding reads an estimate, and the row says
 * which. Exploration sales are apportioned across a batch by body count (see
 * `GameStateStore.soldExplorationBySystem`); exobiology sales are exact.
 *
 * ## What counts as "scanned"
 *
 * A row exists for every body with a journal `Scan`, including bodies whose cartographic data has
 * been sold — `soldExplorationScans` keeps the physics precisely so history does not vanish when he
 * cashes in. Value on those rows is the sale, not an estimate, because the estimate no longer
 * applies to anything he can sell again.
 */
import type {
  BodyExoState,
  DiscoveriesDTO,
  DiscoveryBodyRow,
  DiscoveryStarRow,
  DiscoverySystemRow,
  ExplorationScanRecord,
} from "../shared/types.js";
import type { GameStateStore } from "./gameState.js";
import { bodyScanValueCredits, starScanValueCredits } from "./explorationValue.js";
import { regionForSystem } from "./regionMapData.js";
import { journalSurfaceGravityToG } from "../shared/journalPhysics.js";

/**
 * Radii are reported against the Sun and the Earth, never in kilometres.
 *
 * That is how the game shows them, and kilometres carry a second problem: Elite has a km/miles
 * setting, so a column in kilometres is one the commander has to convert depending on how his game
 * is configured. A ratio has no such setting.
 */
const SOLAR_RADIUS_M = 695_700_000;
const EARTH_RADIUS_M = 6_371_000;

/** Metres to a ratio of some reference radius, or null when the scan carried none. */
function radiusIn(metres: number | undefined, reference: number): number | null {
  return metres != null && Number.isFinite(metres) ? metres / reference : null;
}

/** Earth gravities, from whichever unit the record carries. */
function gravityG(rec: ExplorationScanRecord): number | null {
  const g = rec.surfaceGravity;
  if (g == null || !Number.isFinite(g)) return null;
  return journalSurfaceGravityToG(g);
}

/**
 * Is this body one the commander could walk on?
 *
 * `landable` is the journal's own flag and the only honest answer; a missing flag is not a "no",
 * which is why this returns a tri-state rather than a boolean.
 */
function landable(rec: ExplorationScanRecord): boolean | null {
  return typeof rec.landable === "boolean" ? rec.landable : null;
}

/** `Earthlike body` -> `Earth-like`, and the rest left as the journal writes them. */
function prettyClass(planetClass: string | undefined): string {
  const s = (planetClass ?? "").trim();
  if (!s) return "";
  return /^earth-?like/i.test(s) ? "Earth-like world" : s;
}

/**
 * The species the commander has actually confirmed on this body.
 *
 * From the body's own organic locks rather than from the foot catalog, because the locks are what
 * the panel everywhere else in the app treats as proof.
 */
function confirmedOn(b: BodyExoState | undefined): string[] {
  if (!b) return [];
  const out = new Set<string>();
  for (const lock of b.organicGenusLocks ?? []) {
    const label = (lock.speciesLocalised || lock.genusLocalised || "").trim();
    if (label) out.add(label);
  }
  for (const v of b.confirmedVariants ?? []) {
    const label = String(v ?? "").trim();
    if (label) out.add(label);
  }
  return [...out].sort();
}

export function buildDiscoveries(store: GameStateStore, projectRoot: string): DiscoveriesDTO {
  /* Physics first: a sold system still has its bodies, it just has no price left. */
  const scans = new Map<string, ExplorationScanRecord>();
  for (const [k, r] of store.soldExplorationScans) scans.set(k, r);
  for (const [k, r] of store.explorationScans) scans.set(k, r);

  const stars: DiscoveryStarRow[] = [];
  const bodies: DiscoveryBodyRow[] = [];
  /** systemAddress -> accumulating row. */
  const systems = new Map<number, DiscoverySystemRow>();

  const systemRow = (addr: number, name: string): DiscoverySystemRow => {
    let row = systems.get(addr);
    if (!row) {
      const pos = store.systemPositions.get(addr);
      row = {
        systemAddress: addr,
        name,
        region: pos ? regionForSystem(projectRoot, pos.x, pos.y, pos.z) : null,
        x: pos?.x ?? null,
        y: pos?.y ?? null,
        z: pos?.z ?? null,
        stars: 0,
        bodies: 0,
        landables: 0,
        terraformables: 0,
        earthLikes: 0,
        waterWorlds: 0,
        ammoniaWorlds: 0,
        bioBodies: 0,
        bioSignals: 0,
        speciesConfirmed: 0,
        firstDiscoveries: 0,
        // The game's own answer, straight from the main star. `false` means nobody had been here.
        firstDiscoveredSystem: (() => {
          const wd = store.mainStarWasDiscoveredBySystem.get(addr);
          return typeof wd === "boolean" ? !wd : null;
        })(),
        firstFootfalls: 0,
        dssMapped: 0,
        primaryStarType: null,
        estimatedCredits: 0,
        soldExplorationCredits: null,
        soldExobiologyCredits: null,
        fullyScanned: store.fssAllBodiesCompleteSystems.has(addr),
        firstVisit: null,
        lastVisit: null,
      };
      systems.set(addr, row);
    }
    return row;
  };

  // Every system he has been to gets a row, even one he flew through without scanning — the absence
  // of scans is itself an answer to "where have I not looked".
  for (const [addr, name] of store.visitedSystems) systemRow(addr, name);

  for (const [key, rec] of scans) {
    const addr = rec.systemAddress;
    const sys = systemRow(addr, rec.starSystem || String(addr));
    const b = store.bodies.get(key);
    const at = rec.updatedAt || "";
    if (at && (!sys.firstVisit || at < sys.firstVisit)) sys.firstVisit = at;
    if (at && (!sys.lastVisit || at > sys.lastVisit)) sys.lastVisit = at;

    const firstDiscoverer = rec.wasDiscovered === false;
    /*
      The system's own verdict, carried onto each row so the Bodies and Stars tabs can ask the same
      question the Systems tab asks. Read from the store rather than recomputed: `gameState` decides
      it on the arrival star and that is the only definition the game itself uses.
    */
    const wdSystem = store.mainStarWasDiscoveredBySystem.get(addr);
    const firstDiscoveredSystem = typeof wdSystem === "boolean" ? !wdSystem : null;
    if (firstDiscoverer) sys.firstDiscoveries += 1;

    if (rec.starType?.trim()) {
      const mass = Number(rec.stellarMass);
      const v = starScanValueCredits(Number.isFinite(mass) ? mass : 0, rec.starType, firstDiscoverer);
      sys.stars += 1;
      sys.estimatedCredits += v.value;
      // The arrival star is body 0 in almost every system, and is what a commander means by "the
      // star" when filtering a system list.
      if (sys.primaryStarType == null || rec.bodyId === 0) sys.primaryStarType = rec.starType;
      stars.push({
        key,
        systemAddress: addr,
        system: sys.name,
        region: sys.region,
        bodyName: rec.bodyName,
        starType: rec.starType,
        subclass: rec.subclass ?? null,
        luminosity: rec.luminosity ?? null,
        solarMasses: Number.isFinite(mass) ? mass : null,
        radiusSolar: radiusIn(rec.radius, SOLAR_RADIUS_M),
        surfaceTemperatureK: rec.surfaceTemperature ?? null,
        distanceLs: rec.distanceFromArrivalLs ?? null,
        firstDiscoverer,
        firstDiscoveredSystem,
        estimatedCredits: Math.round(v.value),
        scannedAt: at || null,
      });
      continue;
    }

    const planetClass = rec.planetClass?.trim();
    if (!planetClass) continue;

    const terraformable = /terraformable/i.test(rec.terraformState ?? "");
    const massEM = Number(rec.massEM);
    const firstMapper = store.dssFirstMapperEligibleByBodyKey.get(key) === true;
    const dssComplete = store.dssMappedBodyKeys.has(key);
    const v = bodyScanValueCredits(
      planetClass,
      terraformable,
      Number.isFinite(massEM) ? massEM : 0,
      firstDiscoverer,
      firstMapper,
      false,
      store.dssMappingEfficientByBodyKey.get(key) === true,
    );
    const estimated = dssComplete ? v.dssMapped : v.fss;
    const species = confirmedOn(b);
    const signals = b?.biologicalSignals ?? null;
    const isLandable = landable(rec);
    const footfall = store.firstFootfallBodies.has(key);

    sys.bodies += 1;
    sys.estimatedCredits += estimated;
    if (isLandable) sys.landables += 1;
    if (terraformable) sys.terraformables += 1;
    if (/earth-?like/i.test(planetClass)) sys.earthLikes += 1;
    if (/^water world/i.test(planetClass)) sys.waterWorlds += 1;
    if (/^ammonia world/i.test(planetClass)) sys.ammoniaWorlds += 1;
    if (signals && signals > 0) {
      sys.bioBodies += 1;
      sys.bioSignals += signals;
    }
    sys.speciesConfirmed += species.length;
    if (dssComplete) sys.dssMapped += 1;
    if (footfall) sys.firstFootfalls += 1;

    bodies.push({
      key,
      systemAddress: addr,
      system: sys.name,
      region: sys.region,
      bodyName: rec.bodyName,
      planetClass: prettyClass(planetClass),
      atmosphere: rec.atmosphereType?.trim() || null,
      volcanism: rec.volcanism?.trim() || null,
      terraformState: rec.terraformState?.trim() || null,
      landable: isLandable,
      gravityG: gravityG(rec),
      surfaceTemperatureK: rec.surfaceTemperature ?? null,
      surfacePressurePa: rec.surfacePressure ?? null,
      radiusEarth: radiusIn(rec.radius, EARTH_RADIUS_M),
      massEM: Number.isFinite(massEM) ? massEM : null,
      distanceLs: rec.distanceFromArrivalLs ?? null,
      bioSignals: signals,
      speciesConfirmed: species,
      dssMapped: dssComplete,
      firstDiscoverer,
      firstDiscoveredSystem,
      firstFootfall: footfall,
      estimatedCredits: Math.round(estimated),
      scannedAt: at || null,
    });
  }

  for (const [addr, tally] of store.soldExplorationBySystem) {
    const row = systems.get(addr);
    if (row) row.soldExplorationCredits = Math.round(tally.credits);
  }
  for (const [addr, tally] of store.soldOrganicBySystem) {
    const row = systems.get(addr);
    if (row) row.soldExobiologyCredits = Math.round(tally.credits);
  }
  for (const row of systems.values()) row.estimatedCredits = Math.round(row.estimatedCredits);

  return {
    generatedAt: new Date().toISOString(),
    systems: [...systems.values()],
    bodies,
    stars,
  };
}
