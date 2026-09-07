import type { BodyExoState, ExplorationScanRecord, PlanetScan, SpeciesMatchContext } from "../shared/types.js";
import { journalPressureToAtm, LIGHT_SECOND_METERS } from "../shared/journalPhysics.js";
import {
  allStarParentIds,
  barycentreSyntheticBodyId,
  hostStarBodyIdsForExobiology,
  parseJournalParentEntry,
  resolveHostStarBodyId,
} from "./orbitUtils.js";
import { hostStarClassKeys } from "../shared/hostStarGates.js";
import type { GameStateStore } from "./gameState.js";

function bodyKey(systemAddress: number, bodyId: number): string {
  return `${systemAddress}:${bodyId}`;
}

/**
 * Per-system index of exploration records, cached on the store's scan revision.
 *
 * Building it walks the *entire* `explorationScans` map — over 100k records after a long play
 * history — and it ran once per body, on every snapshot build. Records are replaced rather than
 * mutated on update, so the revision counter is the signature; map size alone would go stale.
 *
 * Sold systems are included: this index exists to find a body's host star and its physical fields,
 * and selling the data does not move the star. The sold archive only grows on a sale, so the
 * revision counter still covers it.
 */
let cachedScanIndex: { signature: string; byId: Map<number, ExplorationScanRecord> } | null = null;

export function systemExplorationScanIndex(
  store: GameStateStore,
  systemAddress: number,
): Map<number, ExplorationScanRecord> {
  const signature = `${systemAddress}:${store.explorationScansRevision}`;
  if (cachedScanIndex && cachedScanIndex.signature === signature) return cachedScanIndex.byId;
  const byId = new Map<number, ExplorationScanRecord>();
  for (const [, r] of store.soldExplorationScans) {
    if (r.systemAddress === systemAddress) byId.set(r.bodyId, r);
  }
  for (const [, r] of store.explorationScans) {
    if (r.systemAddress === systemAddress) byId.set(r.bodyId, r);
  }
  cachedScanIndex = { signature, byId };
  return byId;
}

/**
 * How far a body actually is from the star it orbits, in light seconds.
 *
 * ## What was wrong twice
 *
 * First this was `SemiMajorAxis / c` and nothing else — right for a planet, **wrong for a moon**,
 * whose semi-major axis is its orbit around its *planet*. A moon 3,000 ls from its star reported a
 * few light seconds, which put 20 of 298 Clypeus speculumi bodies under 50 ls when their real
 * distance was 2,858–206,459 ls.
 *
 * The fix for that walked the chain, but only through `Planet` hops, and the owner spotted what it
 * still missed: **barycentres**. Moons orbit each other, and the pair's barycentre is what orbits
 * the planet or the star. Across 26,809 scanned bodies in the owner's own logs those shapes are not
 * rare — `Null>Star` 1,007, `Planet>Null>Star` 829, `Null>Planet>Star` 366, and more — and every one
 * of them broke the climb at the first `Null` and returned nothing.
 *
 * ## Where a barycentre's own orbit comes from
 *
 * It is easy to conclude that a barycentre's orbit is unrecoverable: it has no `Scan` event, and the
 * EDSM system caches carry no row for one (checked — 0 non-star, non-planet rows across 400 system
 * files), so both of the obvious places are empty. The game reports it in a **separate
 * `ScanBaryCentre` event**, which EDSM and Spansh drop and the journal keeps. There are 2,030 of them
 * in the owner's logs, and `mergeBarycentreJournalLine` has been storing each one under
 * {@link barycentreSyntheticBodyId} since long before this function existed.
 *
 * So every rung of the ladder is available, and the cases are:
 *
 *  1. **The nearest star ancestor is the arrival star** → the arrival distance *is* the distance from
 *     that star, whatever the chain looks like in between. Exact, and it covers every barycentre and
 *     ring shape in a single-star system.
 *  2. **Otherwise read the ancestry** — `Parents` lists it in full, nearest-first — and take the
 *     entry sitting directly below the nearest star ancestor. That entry is the body orbiting the
 *     star, and its semi-major axis is the radius. Exact, and this is the case that matters in
 *     multi-star systems, where the arrival distance is measured from the *wrong* star.
 *  3. **No star anywhere in the chain** — a pure barycentre system. The stars sit at the point we
 *     arrive at, so the arrival distance is the right radius.
 *  4. **Anything else** — a ring parent, or a barycentre whose `ScanBaryCentre` we never saw —
 *     returns undefined. Substituting the arrival distance there would measure from the wrong star,
 *     and the difference between two radial distances is a lower bound that can read zero when the
 *     body and its star share a radius. A gate that fires on a fabricated zero is worse than one that
 *     abstains.
 *
 * `Ring` parents are left in case 4 rather than treated as transparent: all 7,314 of them in the
 * owner's logs are belt clusters, and **not one is landable**, so exobiology never asks.
 *
 * ## What it resolves
 *
 * Over the 9,691 landable bodies in the owner's journals: 69.0 % through the arrival star, 18.6 %
 * through an orbital radius, 8.9 % through a system whose chain names no star, and **3.5 % abstain**.
 * Reading the ancestry rather than hopping records recovers 34 bodies of the shape
 * `Null > Planet > Star` — a moon of a moon-pair whose barycentre orbits a planet — and loses none.
 *
 * Speculumi's rule under this resolution: 292 of 294 resolvable bodies ≥ 2,500 ls (99.3 %), against
 * 1.6 % of its 628 lacrimam and 2.5 % of its 198 margaritus siblings. The two below are 2,360 and
 * 2,494 ls, and the codex writes the rule as "5 AU", which is 2,495 ls.
 */
function arrivalStarBodyId(byId: Map<number, ExplorationScanRecord>): number | null {
  /**
   * The star you arrive at is the one the game reports at zero distance from arrival — 2,860 of the
   * 4,635 star scans in the owner's logs carry that, and it is the only direct statement of which
   * star the arrival distance is measured from.
   *
   * When the primary was never scanned, fall back to the lowest star `BodyID`, which is the primary
   * in practice. That is a guess, so it is only ever used to *accept* the arrival distance for a body
   * that orbits it — never to reject anything.
   */
  let zero: number | null = null;
  let lowest: number | null = null;
  for (const [bodyId, r] of byId) {
    if (!r.starType?.trim()) continue;
    if (lowest == null || bodyId < lowest) lowest = bodyId;
    if (r.distanceFromArrivalLs === 0 && (zero == null || bodyId < zero)) zero = bodyId;
  }
  return zero ?? lowest;
}

export function starDistanceLs(
  rec: ExplorationScanRecord | undefined | null,
  scan: PlanetScan | undefined | null,
  byId: Map<number, ExplorationScanRecord>,
): number | undefined {
  const arrival = rec?.distanceFromArrivalLs ?? scan?.distanceFromArrivalLs;
  const arrivalLs = typeof arrival === "number" && Number.isFinite(arrival) ? arrival : undefined;

  // `Parents` is nearest-first, so the first star listed is the one this body ultimately orbits.
  const starIds = allStarParentIds(rec?.parents);
  const hostStarId = starIds.length ? starIds[0]! : null;

  // 1. Host is the arrival star: the arrival distance is the answer, whatever is in between.
  if (hostStarId != null && hostStarId === arrivalStarBodyId(byId) && arrivalLs !== undefined) {
    return arrivalLs;
  }

  // 2. `Parents` is the whole ancestry, nearest-first, so no record-hopping is needed: find the
  //    nearest star ancestor and look at whatever sits immediately below it. That entry is the body
  //    orbiting the star, and its semi-major axis is the radius we want.
  //
  //      [{Planet:3},{Star:0}]           -> planet 3 orbits the star      -> sma of body 3
  //      [{Null:5},{Planet:3},{Star:0}]  -> planet 3 orbits the star      -> sma of body 3
  //      [{Star:0}]                      -> the body itself orbits it     -> its own sma
  //      [{Null:5},{Star:0}]             -> barycentre 5 orbits the star -> its ScanBaryCentre sma
  //
  //    The third line is the shape the previous version missed: it hopped records through `Planet`
  //    entries and stopped dead at the first `Null`, even when a planet with a perfectly good orbit
  //    was listed right behind it.
  const parents = Array.isArray(rec?.parents) ? rec.parents : [];
  const chain = parents.map((e) => parseJournalParentEntry(e));
  const starIndex = chain.findIndex((e) => e?.kind === "Star");
  if (starIndex === 0) {
    const sma = rec?.semiMajorAxis;
    if (typeof sma === "number" && Number.isFinite(sma) && sma > 0) return sma / LIGHT_SECOND_METERS;
  } else if (starIndex > 0) {
    const orbiter = chain[starIndex - 1];
    /**
     * A `Null` here is a **barycentre** orbiting the star, and the game does report its orbit — in a
     * separate `ScanBaryCentre` event, which `mergeBarycentreJournalLine` has been storing all along
     * under {@link barycentreSyntheticBodyId} so it cannot collide with a real `BodyID`. EDSM and
     * Spansh both drop that event, which is why the system caches have no row for a barycentre; the
     * journal keeps it, and the journal is what this reads.
     */
    const orbiterId =
      orbiter?.kind === "Planet"
        ? orbiter.id
        : orbiter?.kind === "Null"
          ? barycentreSyntheticBodyId(orbiter.id)
          : null;
    if (orbiterId != null) {
      const sma = byId.get(orbiterId)?.semiMajorAxis;
      if (typeof sma === "number" && Number.isFinite(sma) && sma > 0) return sma / LIGHT_SECOND_METERS;
    }
  }

  // 3. A chain that names no star at all: the stars are where we arrived.
  if (starIds.length === 0 && arrivalLs !== undefined) return arrivalLs;

  // 4. A non-arrival host reached only through a barycentre or a ring. Not measurable — say so.
  return undefined;
}

/** Build optional matching context from merged exploration scans + scanner signal hints on the body. */
export function buildSpeciesMatchContext(exo: BodyExoState, store: GameStateStore): SpeciesMatchContext {
  const sk = bodyKey(exo.systemAddress, exo.bodyId);
  const rec = store.physicsExplorationScan(sk);
  const scan = exo.scan;

  const byId = systemExplorationScanIndex(store, exo.systemAddress);

  let parentStarType: string | undefined;
  let parentStarSubclass: number | undefined;
  let parentStarLuminosity: string | undefined;
  if (rec) {
    const starId = resolveHostStarBodyId(rec, byId);
    if (starId != null) {
      const starRec = byId.get(starId);
      const st = starRec?.starType?.trim();
      if (st) parentStarType = st;
      if (typeof starRec?.subclass === "number" && Number.isFinite(starRec.subclass)) {
        parentStarSubclass = starRec.subclass;
      }
      const lum = starRec?.luminosity?.trim();
      if (lum) parentStarLuminosity = lum;
    }
  }

  /**
   * The host-star class *set*, which is not always one star (§7.12).
   *
   * A body orbiting a barycentre names no star in its parents chain, and picking one of the pair is
   * how a neutron-star system came to contribute an M-dwarf observation to Electricae pluma. Collect
   * every star the chain names, and every star in the system when it names none.
   */
  let hostStarClasses: string[] | undefined;
  if (rec) {
    const keys = hostStarClassKeys(
      hostStarBodyIdsForExobiology(rec, byId).map((id) => byId.get(id)?.starType),
    );
    if (keys.length) hostStarClasses = keys;
  }

  const orbitDistanceFromParentStarLs = starDistanceLs(rec, scan, byId);

  let signalHints: string[] | undefined;
  if (exo.signalHints?.length) {
    const s = new Set<string>();
    for (const h of exo.signalHints) {
      const t = h.trim().toLowerCase();
      if (t) s.add(t);
    }
    signalHints = s.size ? [...s] : undefined;
  }

  const ctx: SpeciesMatchContext = {};
  if (parentStarType) ctx.parentStarType = parentStarType;
  if (parentStarSubclass !== undefined) ctx.parentStarSubclass = parentStarSubclass;
  if (parentStarLuminosity) ctx.parentStarLuminosity = parentStarLuminosity;
  if (orbitDistanceFromParentStarLs !== undefined)
    ctx.orbitDistanceFromParentStarLs = orbitDistanceFromParentStarLs;
  if (signalHints?.length) ctx.signalHints = signalHints;
  if (hostStarClasses?.length) ctx.hostStarClasses = hostStarClasses;
  /**
   * The system's position (Phase 7).
   *
   * `commanderPos` is where the commander last jumped to, so it is the right coordinate for bodies
   * in the *current* system and the wrong one for a system being viewed remotely. Only attach it
   * when the body actually belongs to the commander's current system — a wrong coordinate would
   * demote candidates for a reason that has nothing to do with them.
   */
  if (store.commanderPos && exo.systemAddress === store.currentSystemAddress) {
    ctx.systemCoords = store.commanderPos;
  }
  const rawP = scan?.SurfacePressure ?? rec?.surfacePressure;
  if (rawP != null && Number.isFinite(rawP)) ctx.surfacePressureAtm = journalPressureToAtm(rawP);

  return ctx;
}
