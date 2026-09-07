import type { BodyExoState, ExplorationScanRecord, PlanetScan, SpeciesMatchContext } from "../shared/types.js";
import { journalPressureToAtm, LIGHT_SECOND_METERS } from "../shared/journalPhysics.js";
import {
  allStarParentIds,
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
 * This used to be `SemiMajorAxis / c` and nothing else, which is right for a planet and **wrong for
 * a moon**: a moon's semi-major axis is its orbit around its planet, so a moon 3,000 ls from its
 * star reported a few light seconds. Measured on the corpus, that single mistake put 20 of 298
 * Clypeus speculumi bodies at under 50 ls when their real distance was 2,858–206,459 ls — enough to
 * make speculumi's own 2,500 ls rule look like it failed a quarter of the time.
 *
 * Four cases, in order:
 *
 *  1. The body orbits the **arrival star** — then the arrival distance *is* the star distance, and it
 *     is a measurement rather than an orbital reconstruction.
 *  2. Otherwise climb the parent chain to the ancestor whose own immediate parent is a star, and use
 *     that ancestor's orbit. For a moon this is the planet's orbit, which is what we wanted.
 *  3. The chain names **no star at all** — the body orbits a barycentre. The stars sit at the point
 *     we arrive at, so the arrival distance is the right order of magnitude.
 *  4. Nothing resolves: return undefined, so the criterion is skipped rather than failed.
 *
 * Measured after the fix: 293 of 295 resolvable speculumi bodies are ≥ 2,500 ls (99.3 %), against
 * 1.7 % of its 637 lacrimam and 2.5 % of its 198 margaritus siblings. The two below are 2,360 and
 * 2,494 ls — and the codex writes the rule as "5 AU", which is 2,495 ls.
 */
function starDistanceLs(
  rec: ExplorationScanRecord | undefined | null,
  scan: PlanetScan | undefined | null,
  byId: Map<number, ExplorationScanRecord>,
): number | undefined {
  const arrival = rec?.distanceFromArrivalLs ?? scan?.distanceFromArrivalLs;
  const arrivalLs = typeof arrival === "number" && Number.isFinite(arrival) ? arrival : undefined;

  const parents = rec?.parents;
  const starIds = allStarParentIds(parents);

  // 1. The arrival star is the smallest star id in the system we know of — body 0 in practice.
  let mainStarId: number | null = null;
  for (const [bodyId, r] of byId) {
    if (r.starType?.trim() && (mainStarId == null || bodyId < mainStarId)) mainStarId = bodyId;
  }
  if (starIds.length && mainStarId != null && starIds[0] === mainStarId && arrivalLs !== undefined) {
    return arrivalLs;
  }

  // 2. Climb to whatever orbits a star, and take its semi-major axis.
  // `PlanetScan` is the merged view and carries no `Parents`, so the climb needs the exploration
  // record. Without one there is no chain to walk and case 3 answers instead.
  let cur: { parents?: unknown; semiMajorAxis?: number } | null = rec ?? null;
  const seen = new Set<number>();
  for (let d = 0; d < 24 && cur; d++) {
    const ps = cur.parents;
    if (!Array.isArray(ps) || ps.length === 0) break;
    const p0 = parseJournalParentEntry(ps[0]);
    if (!p0) break;
    if (p0.kind === "Star") {
      const sma = cur.semiMajorAxis;
      if (typeof sma === "number" && Number.isFinite(sma) && sma > 0) return sma / LIGHT_SECOND_METERS;
      break;
    }
    if (p0.kind !== "Planet" || seen.has(p0.id)) break;
    seen.add(p0.id);
    cur = byId.get(p0.id) ?? null;
  }

  // 3. A barycentre names no star; the stars are where we arrived.
  if (starIds.length === 0 && arrivalLs !== undefined) return arrivalLs;
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
