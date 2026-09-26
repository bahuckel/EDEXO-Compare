import type {
  BodyExoState,
  ExplorationScanRecord,
  PlanetScan,
  SpeciesMatchContext,
} from "../shared/types.js";
import { journalPressureToAtm, LIGHT_SECOND_METERS } from "../shared/journalPhysics.js";
import {
  allStarParentIds,
  barycentreSyntheticBodyId,
  hostStarBodyIdsForExobiology,
  parseJournalParentEntry,
  resolveHostStarBodyId,
} from "./orbitUtils.js";
import { hostStarClassKeys } from "../shared/hostStarGates.js";
import { explorationRecordHasPlanetSlotDesignation } from "../shared/planetSlotDesignation.js";
import { hostStarClassKey } from "../shared/hostStarClass.js";
import { getProjectRoot } from "./paths.js";
import { regionForSystem, regionIndexForSystem } from "./regionMapData.js";
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
  const signature = `${systemAddress}:${store.explorationScansRevision}:${store.remoteSystems.get(systemAddress)?.fetchedAt ?? ""}`;
  if (cachedScanIndex && cachedScanIndex.signature === signature) return cachedScanIndex.byId;
  const byId = new Map<number, ExplorationScanRecord>();
  // A Spansh lookup is the weakest source, so it goes in first and anything of his own overwrites it.
  for (const r of store.remoteSystems.get(systemAddress)?.records ?? []) byId.set(r.bodyId, r);
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

/**
 * The class of the system's main star — the one you arrive at — as a host-class key.
 *
 * Not the body's host. For most species the two agree; for some they do not, and the difference is
 * the whole finding. Stratum araneamus is recorded under an A, neutron, B or black-hole **main**
 * star on 98.9 % of 13,732 codex sightings, yet a third of its bodies orbit a Y or T dwarf in those
 * systems — and the colour tokens say the same of every Y-dwarf host: the colour follows the main
 * star. A gate measured on the main star has to be judged on it.
 */
export function mainStarClassOf(byId: Map<number, ExplorationScanRecord>): string | undefined {
  const id = arrivalStarBodyId(byId);
  const key = id == null ? null : hostStarClassKey(byId.get(id)?.starType);
  return key ?? undefined;
}

/**
 * The star whose class sets a star-coloured species' colour (bug report 2026-09-26, Hypao Flee MS-T
 * d3-63 2 c: Stratum and Bacterium alcyoneum shown T-dwarf grey and red, really green and lime — the
 * moon orbits a brown dwarf "2" that orbits an F).
 *
 * Measured on 26,000 EDDN codex entries, whose variant suffix names the class the game used
 * (`$Codex_Ent_Stratum_07_TTS_Name;`), against each body's `Parents`:
 *
 * | host | above the host | the game used |
 * |---|---|---|
 * | any star with its own letter ("B", "C") | — | the host: L 663:24, T 221:7, normal ~99 % |
 * | brown dwarf (L/T/Y/T Tauri) in a planet slot ("2", "11", "A 4", "AB 5") | a normal star | **that star**: Y 476/477, T 24/24 |
 * | same | a black hole | the dwarf: T 6/6, Y 5/5 |
 * | T dwarf in a planet slot | only a barycentre | the dwarf, 16/19 |
 * | Y dwarf in a planet slot | only a barycentre | **the arrival star**, 88/90 |
 *
 * On the owner's own 507 confirmed star-coloured variants this is 507 right, where the host alone
 * was 500. Colour only: the host-star gates keep reading the real host.
 *
 * ## The rule under that table: the brightest star in the body's sky (re-check, same day)
 *
 * The table is what the game's real rule looks like from the designations. Around one *lettered*
 * dwarf the close planets keep its colour and the far ones take the arrival star's (Kyloaln HA-J
 * c24-5 C 3 at 90 ls: L; C 8 at 373 ls: K), and planets round a dim M companion take a bright A's.
 * The game colours a plant after the star that is brightest where the plant grows: luminosity
 * (R² T⁴) over distance². Scored on 4,643 EDDN codex entries: the table 95.7 %, brightest star
 * 99.5 %; on planets round a barycentre ("AB 1") 61 % against 100 %.
 *
 * So {@link brightestStarTypeFor} decides whenever the star the body orbits and the arrival star
 * both have a radius and a temperature, and the table below is only the fallback for systems that
 * lack them (an old Spansh lookup, a star never scanned).
 */
export function colourStarTypeFor(
  rec: ExplorationScanRecord,
  byId: Map<number, ExplorationScanRecord>,
): string | undefined {
  return brightestStarTypeFor(rec, byId) ?? colourStarTypeByDesignation(rec, byId);
}

const SOLAR_RADIUS_M = 695_700_000;
const SUN_TEMPERATURE_K = 5772;

/** Luminosity in suns from radius and temperature (R² T⁴). A black hole gives no light. */
function starLuminosity(r: ExplorationScanRecord | undefined): number | undefined {
  const type = r?.starType?.trim();
  if (!r || !type) return undefined;
  if (/^(H|SupermassiveBlackHole)$|blackhole/i.test(type)) return 0;
  const R = r.radius;
  const T = r.surfaceTemperature;
  const fromSize =
    typeof R === "number" && R > 0 && typeof T === "number" && T > 0
      ? (R / SOLAR_RADIUS_M) ** 2 * (T / SUN_TEMPERATURE_K) ** 4
      : undefined;
  /*
   * The brighter of the two readings (owner's HIP 36601 B 3, 2026-09-26). Catalogue stars keep the
   * real star's absolute magnitude while the game generates radius and temperature: HIP 36601 A is a
   * K0 V of 0.75 R☉ and 4,432 K (0.2 suns) at magnitude 1.1 (30 suns), and every commander who logged
   * B 3 got the K colour, not the dwarf's. For ordinary stars the two agree to 1 %; for neutron stars
   * the magnitude reads low, and radius and temperature are the ones the game follows there.
   */
  const M = r.absoluteMagnitude;
  // Neutron stars: the magnitude reads up to 3,000× low and occasionally 8× high; the game follows
  // radius and temperature (Myriesly RV-B d14-1839 1 a keeps its Y dwarf's colour).
  const fromMagnitude =
    !/^N$/i.test(type) && typeof M === "number" && Number.isFinite(M) ? 10 ** (-0.4 * (M - 4.83)) : undefined;
  if (fromSize === undefined) return fromMagnitude;
  return fromMagnitude === undefined ? fromSize : Math.max(fromSize, fromMagnitude);
}

type OrbitNode = { kind: "Star" | "Null"; id: number };
const nodeKey = (n: OrbitNode) => `${n.kind}:${n.id}`;

/**
 * Where the brightest-star rule gets its distances: a star's own `Parents` and semi-major axis, and
 * a barycentre's orbit from `ScanBaryCentre`. Built once per call from the system index.
 */
class StarTree {
  private readonly ancestry = new Map<string, OrbitNode[]>();
  private readonly mass = new Map<string, number>();
  private readonly children = new Map<string, Set<string>>();

  constructor(private readonly byId: Map<number, ExplorationScanRecord>) {
    for (const [id, r] of byId) {
      if (!r.starType?.trim()) continue;
      const chain = (Array.isArray(r.parents) ? r.parents : [])
        .map((e) => parseJournalParentEntry(e))
        .filter((e): e is OrbitNode => e?.kind === "Star" || e?.kind === "Null");
      const self: OrbitNode = { kind: "Star", id };
      this.ancestry.set(nodeKey(self), chain);
      const m = typeof r.stellarMass === "number" && r.stellarMass > 0 ? r.stellarMass : undefined;
      const path = [self, ...chain];
      for (let i = 0; i < path.length; i++) {
        const k = nodeKey(path[i]!);
        if (m !== undefined) this.mass.set(k, (this.mass.get(k) ?? 0) + m);
        // A barycentre's own ancestry is the tail of any star's chain that passes through it.
        if (path[i]!.kind === "Null" && !this.ancestry.has(k)) this.ancestry.set(k, path.slice(i + 1));
        if (i + 1 < path.length) {
          const pk = nodeKey(path[i + 1]!);
          if (!this.children.has(pk)) this.children.set(pk, new Set());
          this.children.get(pk)!.add(k);
        }
      }
    }
  }

  /** Stars that sit inside this barycentre, at any depth. */
  starsIn(bary: number): number[] {
    const out: number[] = [];
    for (const [k, chain] of this.ancestry) {
      if (k.startsWith("Star:") && chain.some((n) => n.kind === "Null" && n.id === bary))
        out.push(Number(k.slice(5)));
    }
    return out;
  }

  isStellarBarycentre(id: number): boolean {
    return this.ancestry.has(`Null:${id}`);
  }

  /** A node's distance from the thing it orbits, in light seconds. */
  private offsetLs(n: OrbitNode, depth = 0): number | undefined {
    if (n.kind === "Star") {
      const sma = this.byId.get(n.id)?.semiMajorAxis;
      return typeof sma === "number" && sma > 0 ? sma / LIGHT_SECOND_METERS : undefined;
    }
    const sma = this.byId.get(barycentreSyntheticBodyId(n.id))?.semiMajorAxis;
    if (typeof sma === "number" && sma > 0) return sma / LIGHT_SECOND_METERS;
    // No `ScanBaryCentre`: the two sides of a pair balance, a₁m₁ = a₂m₂.
    if (depth > 4) return undefined;
    const parent = this.ancestry.get(nodeKey(n))?.[0];
    if (!parent) return undefined;
    const siblings = [...(this.children.get(nodeKey(parent)) ?? [])].filter((k) => k !== nodeKey(n));
    if (siblings.length !== 1) return undefined;
    const [kind, id] = siblings[0]!.split(":") as ["Star" | "Null", string];
    const other: OrbitNode = { kind, id: Number(id) };
    const a = this.offsetLs(other, depth + 1);
    const mOther = this.mass.get(siblings[0]!);
    const mSelf = this.mass.get(nodeKey(n));
    if (a === undefined || !mOther || !mSelf) return undefined;
    return (a * mOther) / mSelf;
  }

  /**
   * Distance between two nodes through their lowest common barycentre (or star): the two sides of
   * a pair are always on opposite sides of it, so the offsets add.
   */
  separationLs(a: OrbitNode, b: OrbitNode): number | undefined {
    const pathA = [a, ...(this.ancestry.get(nodeKey(a)) ?? [])];
    const pathB = [b, ...(this.ancestry.get(nodeKey(b)) ?? [])];
    const keysB = pathB.map(nodeKey);
    const iA = pathA.findIndex((n) => keysB.includes(nodeKey(n)));
    if (iA < 0) return undefined;
    const iB = keysB.indexOf(nodeKey(pathA[iA]!));
    let sum = 0;
    for (const n of [...pathA.slice(0, iA), ...pathB.slice(0, iB)]) {
      const o = this.offsetLs(n);
      if (o === undefined) return undefined;
      sum += o;
    }
    return sum;
  }
}

/**
 * The class of the star that shines brightest on this body: luminosity / distance². Undefined
 * when the star (or star group) the body orbits, or the arrival star, cannot be measured.
 *
 * Distances: to the star or barycentre the body orbits, its orbit (the planet's, for a moon); to the
 * arrival star, the body's own arrival distance, which is exact; to any other star, the orbit tree
 * (`StarTree`), combined with the body's orbit. A star the tree cannot place is left out.
 */
export function brightestStarTypeFor(
  rec: ExplorationScanRecord,
  byId: Map<number, ExplorationScanRecord>,
): string | undefined {
  const tree = new StarTree(byId);
  const chain = (Array.isArray(rec.parents) ? rec.parents : []).map((e) => parseJournalParentEntry(e));
  // What the body orbits: the nearest star, else the nearest barycentre that holds stars.
  let anchorIndex = chain.findIndex((e) => e?.kind === "Star");
  if (anchorIndex < 0)
    anchorIndex = chain.findIndex((e) => e?.kind === "Null" && tree.isStellarBarycentre(e.id));
  if (anchorIndex < 0) return undefined;
  const anchor = chain[anchorIndex] as OrbitNode;
  const orbiter = anchorIndex === 0 ? null : chain[anchorIndex - 1];
  const orbitSma =
    orbiter == null
      ? rec.semiMajorAxis
      : orbiter.kind === "Planet"
        ? byId.get(orbiter.id)?.semiMajorAxis
        : orbiter.kind === "Null"
          ? byId.get(barycentreSyntheticBodyId(orbiter.id))?.semiMajorAxis
          : undefined;
  const arrivalId = arrivalStarBodyId(byId);
  const arrivalLs =
    typeof rec.distanceFromArrivalLs === "number" && Number.isFinite(rec.distanceFromArrivalLs)
      ? rec.distanceFromArrivalLs
      : undefined;
  const members = anchor.kind === "Star" ? [anchor.id] : tree.starsIn(anchor.id);
  let orbitLs = typeof orbitSma === "number" && orbitSma > 0 ? orbitSma / LIGHT_SECOND_METERS : undefined;
  // A planet pair's barycentre with no `ScanBaryCentre` (EDSM and Spansh drop it): when the arrival
  // star is in the group the body orbits, the arrival distance is that orbit, as in starDistanceLs.
  if (orbitLs === undefined && arrivalId != null && members.includes(arrivalId)) orbitLs = arrivalLs;
  if (orbitLs === undefined) return undefined;

  // Every star the body orbits has to be measurable, or the missing one may be the bright one.
  if (!members.length || members.some((id) => starLuminosity(byId.get(id)) === undefined)) return undefined;
  let best: { type: string; flux: number } | null = null;
  let anchorSeen = false;
  let arrivalSeen = arrivalId == null;
  for (const [id, r] of byId) {
    const L = starLuminosity(r);
    if (L === undefined) continue;
    let d: number | undefined;
    if (id === arrivalId && arrivalLs !== undefined && !(anchor.kind === "Star" && anchor.id === id)) {
      d = Math.max(arrivalLs, 1);
    } else if (members.includes(id)) {
      const off = anchor.kind === "Star" ? 0 : tree.separationLs({ kind: "Star", id }, anchor);
      d = Math.hypot(orbitLs, off ?? 0);
    } else {
      // Round the arrival star (or a group holding it), another star's own arrival distance is how
      // far it is right now; the orbit tree only knows how far apart two orbits can be.
      const ownArrival = r.distanceFromArrivalLs;
      const hasOwn = typeof ownArrival === "number" && ownArrival > 0;
      let sep =
        arrivalId != null && members.includes(arrivalId) && hasOwn
          ? ownArrival
          : tree.separationLs({ kind: "Star", id }, anchor);
      /*
       * A star the tree cannot place (a barycentre with more than two members and no
       * `ScanBaryCentre`): both distances from the arrival star are known, the angle between them is
       * not, so take them at right angles — between the closest and farthest they can be.
       * Drumbaae KX-U f2-427 ABC 1 e: a neutron star 1,160 ls out outshines the moon's T dwarf.
       */
      if (sep === undefined && hasOwn && arrivalLs !== undefined) {
        sep = Math.hypot(ownArrival, arrivalLs);
        d = sep;
      }
      if (d === undefined && sep !== undefined) d = Math.hypot(sep, orbitLs);
    }
    if (d === undefined || !(d > 0)) continue;
    if (members.includes(id)) anchorSeen = true;
    if (id === arrivalId) arrivalSeen = true;
    const flux = L / (d * d);
    if (!best || flux > best.flux) best = { type: r.starType!.trim(), flux };
  }
  // Nothing measured but black holes: no light to go by.
  if (!best || !(best.flux > 0) || !anchorSeen || !arrivalSeen) return undefined;
  return best.type;
}

/** The designation table above: the fallback when the stars cannot be measured. */
export function colourStarTypeByDesignation(
  rec: ExplorationScanRecord,
  byId: Map<number, ExplorationScanRecord>,
): string | undefined {
  const hostId = resolveHostStarBodyId(rec, byId);
  if (hostId == null) return undefined;
  const host = byId.get(hostId);
  const hostType = host?.starType?.trim() || undefined;
  if (!host || !hostType) return hostType;
  const system = rec.starSystem?.trim() || host.starSystem?.trim() || "";
  const brownDwarf = /^(L|T|Y)/i.test(hostType); // T Tauri ("TTS") included, as the data has it
  if (!brownDwarf || !explorationRecordHasPlanetSlotDesignation(host, system)) return hostType;

  // The star the dwarf orbits: next in the body's own chain, else in the dwarf's scan.
  const chain = allStarParentIds(rec.parents);
  const at = chain.indexOf(hostId);
  const aboveId = at >= 0 && at + 1 < chain.length ? chain[at + 1] : allStarParentIds(host.parents)[0];
  if (aboveId !== undefined) {
    const aboveType = byId.get(aboveId)?.starType?.trim();
    if (!aboveType) return hostType;
    if (/^H$|blackhole/i.test(aboveType)) return hostType; // a black hole colours nothing
    return aboveType;
  }
  // Only a barycentre above: a Y dwarf defers to the arrival star, a T dwarf keeps its own colour.
  if (/^Y/i.test(hostType)) {
    const arrival = arrivalStarBodyId(byId);
    return (arrival != null ? byId.get(arrival)?.starType?.trim() : undefined) || hostType;
  }
  return hostType;
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

  // 3. A chain that names no star at all: the body's stars are a pair (or more) round a barycentre.
  if (starIds.length === 0) {
    /**
     * Which barycentre holds the stars is written on the stars: a star whose own `Parents` starts
     * `{Null: n}` orbits barycentre n. The body's host group is the nearest such barycentre in its
     * chain, and whatever sits immediately below it — the body, its planet, or a pair barycentre —
     * is what orbits the stars.
     *
     * The arrival distance is right only when that group is the arrival star's. In a system laid
     * out as A + (B + C), a moon in the BC group has no `Star` in its chain either, and the arrival
     * distance there is the distance from A — measured on the corpus at 3,500 to 409,000 ls for
     * Clypeus lacrimam moons that sit a few hundred ls from their own stars, which put lacrimam out
     * where only speculumi grows.
     */
    const stellarBarycentres = new Set<number>();
    for (const r of byId.values()) {
      if (!r.starType?.trim()) continue;
      const p0 = Array.isArray(r.parents) ? parseJournalParentEntry(r.parents[0]) : null;
      if (p0?.kind === "Null") stellarBarycentres.add(p0.id);
    }
    // Every barycentre the arrival star sits inside, however deep: in (A + B) + C, a body round the
    // outer barycentre has A among its stars too.
    const arrivalId = arrivalStarBodyId(byId);
    const arrivalParents = arrivalId != null ? byId.get(arrivalId)?.parents : undefined;
    const holdsArrival = new Set(
      (Array.isArray(arrivalParents) ? arrivalParents : [])
        .map((e) => parseJournalParentEntry(e))
        .filter((e) => e?.kind === "Null")
        .map((e) => e!.id),
    );
    const groupIndex = chain.findIndex((e) => e?.kind === "Null" && stellarBarycentres.has(e.id));
    if (groupIndex < 0) return arrivalLs; // no star says where it sits: the old reading, the stars are where we arrived
    if (holdsArrival.has(chain[groupIndex]!.id)) return arrivalLs;
    // A group the arrival star is not in: the orbit around that group's barycentre.
    const orbiter = groupIndex === 0 ? null : chain[groupIndex - 1];
    const sma =
      orbiter == null
        ? rec?.semiMajorAxis
        : orbiter.kind === "Planet"
          ? byId.get(orbiter.id)?.semiMajorAxis
          : orbiter.kind === "Null"
            ? byId.get(barycentreSyntheticBodyId(orbiter.id))?.semiMajorAxis
            : undefined;
    return typeof sma === "number" && Number.isFinite(sma) && sma > 0 ? sma / LIGHT_SECOND_METERS : undefined;
  }

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
  const pos =
    store.systemPositions.get(exo.systemAddress) ?? store.remoteSystems.get(exo.systemAddress)?.coords;
  if (pos) {
    const root = getProjectRoot();
    const idx = regionIndexForSystem(root, pos.x, pos.z);
    if (idx != null && idx > 0) {
      const name = regionForSystem(root, pos.x, pos.y, pos.z);
      if (name) {
        ctx.regionName = name;
        ctx.regionIndex = idx;
      }
    }
  }
  if (parentStarType) ctx.parentStarType = parentStarType;
  if (parentStarSubclass !== undefined) ctx.parentStarSubclass = parentStarSubclass;
  if (parentStarLuminosity) ctx.parentStarLuminosity = parentStarLuminosity;
  if (orbitDistanceFromParentStarLs !== undefined)
    ctx.orbitDistanceFromParentStarLs = orbitDistanceFromParentStarLs;
  if (signalHints?.length) ctx.signalHints = signalHints;
  if (hostStarClasses?.length) ctx.hostStarClasses = hostStarClasses;
  const mainStar = mainStarClassOf(byId);
  if (mainStar) ctx.systemMainStarClass = mainStar;
  const colourStar = rec ? colourStarTypeFor(rec, byId) : undefined;
  if (colourStar) ctx.colourStarType = colourStar;
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
  } else {
    // A looked-up system carries its own coordinates from Spansh, so the nebula / core gates can judge it.
    const remoteCoords = store.remoteSystems.get(exo.systemAddress)?.coords;
    if (remoteCoords) ctx.systemCoords = remoteCoords;
  }
  /**
   * What else is in this system, for the companion-body conditions (Amphora, the Brain Trees).
   *
   * Every body but this one: a metal-rich world does not satisfy its own requirement, and including
   * it would let a species vouch for itself in a one-body system. Completeness comes from the honk —
   * without `FSSAllBodiesFound` a missing Earth-like world only means the FSS has not got to it.
   */
  const classes: string[] = [];
  for (const [bodyId, r] of byId) {
    if (bodyId === exo.bodyId) continue;
    const pc = r.planetClass?.trim();
    if (pc) classes.push(pc);
  }
  if (classes.length) ctx.systemBodyClasses = [...new Set(classes)];
  ctx.systemBodyListComplete = store.fssAllBodiesCompleteSystems.has(exo.systemAddress);

  const rawP = scan?.SurfacePressure ?? rec?.surfacePressure;
  if (rawP != null && Number.isFinite(rawP)) ctx.surfacePressureAtm = journalPressureToAtm(rawP);

  return ctx;
}
