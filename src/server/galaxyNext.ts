/**
 * "Next target" (G5, docs/galaxy-plan-28092026.md — the reason the map was rebuilt): the nearest
 * system to the ship worth at least X that the commander has not already done.
 *
 * - Worth: the recorded species at 1× (his answer, 2026-09-28: the index is other commanders'
 *   records, so first footfall is mostly gone there).
 * - Not done: no DSS and no plants scanned on foot there (his rule); visited-only systems are skipped
 *   too when asked.
 * - Skip: the client sends what it has skipped this session and gets the next one.
 *
 * One pass over the index with no allocation per system (forEachPoint); only systems that clear the
 * value and are not excluded are measured, and a short sorted list keeps the nearest few.
 *
 * The plan (G5.3): a greedy chain — the target, then the nearest qualifying system to it, and so on.
 * Each hop is answered from the few hundred systems nearest the ship that the same pass keeps; a hop
 * whose answer could lie outside them (stop's distance from the ship + hop > the farthest one kept)
 * takes one more pass over the index, so the chain is exactly greedy either way.
 *
 * Then the order (plan 5.8): the greedy chain picks the stops, 2-opt (tourOrder.ts) visits them in
 * the shortest order it can find from the ship — never longer than the chain's own — and, asked to
 * loop, back to where the ship is.
 */
import type { BioIndex } from "./bioIndex.js";
import type { GameStateStore } from "./gameState.js";
import { footOrganicLocks } from "./organicLocks.js";
import type { GalaxyNextDTO, GalaxyNextRow } from "../shared/dto/galaxy.js";
import { routeLength, twoOptOrder } from "./tourOrder.js";

/** Systems this commander has analysed (a DSS or plants on foot), and every system they visited. */
export function doneAddresses(store: GameStateStore): { analysed: Set<number>; visited: Set<number> } {
  const analysed = new Set<number>();
  for (const key of store.dssMappedBodyKeys) {
    const addr = Number(key.slice(0, key.indexOf(":")));
    if (Number.isFinite(addr)) analysed.add(addr);
  }
  for (const b of store.bodies.values()) if (footOrganicLocks(b.organicGenusLocks).length) analysed.add(b.systemAddress);
  return { analysed, visited: new Set(store.visitedSystems.keys()) };
}

/** Addresses to index ordinals; one that does not survive as a number, or is not indexed, is dropped. */
export function ordinalsOf(index: BioIndex, addrs: Iterable<number>): Set<number> {
  const out = new Set<number>();
  for (const a of addrs) {
    try {
      const i = index.ordinalOf(BigInt(a));
      if (i >= 0) out.add(i);
    } catch {
      /* not an integer */
    }
  }
  return out;
}

/** Most stops a plan can have. */
export const MAX_PLAN_STOPS = 20;
/** How many of the nearest systems the first pass keeps for the plan's hops. */
const PLAN_POOL = 400;

type Pos = { x: number; y: number; z: number };

export function nextTarget(
  index: BioIndex,
  values: Uint16Array,
  from: Pos | null,
  /** 100,000 CR units; 0 means "anything with a recorded species value". */
  minUnits: number,
  exclude: Set<number>,
  count = 6,
  /** Stops in the plan (the target counts as the first); 0 = no plan. */
  planStops = 0,
  /** The plan returns to where the ship is. */
  loop = false,
): GalaxyNextDTO {
  const floor = Math.max(1, Math.floor(minUnits));
  if (!from) return { from: null, qualifying: 0, target: null, next: [] };
  const stops = Math.max(0, Math.min(MAX_PLAN_STOPS, Math.floor(planStops)));
  const keep = stops > 1 ? Math.max(count, PLAN_POOL) : count;
  const best: { i: number; d: number }[] = [];
  let qualifying = 0;
  index.forEachPoint((i, x, y, z) => {
    if (values[i]! < floor || exclude.has(i)) return;
    qualifying++;
    const dx = x - from.x;
    const dy = y - from.y;
    const dz = z - from.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (best.length < keep || d < best[best.length - 1]!.d) {
      let k = best.length;
      while (k > 0 && best[k - 1]!.d > d) k--;
      best.splice(k, 0, { i, d });
      if (best.length > keep) best.pop();
    }
  });
  const row = (i: number, fromShipSq: number): GalaxyNextRow => {
    const [x, y, z, , species] = index.pointAt(i);
    return { ordinal: i, name: index.nameOf(i), x, y, z, valueCr: values[i]! * 100_000, species, distanceLy: Math.sqrt(fromShipSq) };
  };
  const rows = best.slice(0, count).map(({ i, d }) => row(i, d));
  const out: GalaxyNextDTO = { from, qualifying, target: rows[0] ?? null, next: rows.slice(1) };
  if (stops > 0 && rows[0]) out.plan = planChain(index, values, from, floor, exclude, best, keep, stops, row, loop);
  return out;
}

/** The greedy chain from the ship; `pool` is the first pass's nearest systems, ascending. */
function planChain(
  index: BioIndex,
  values: Uint16Array,
  from: Pos,
  floor: number,
  exclude: Set<number>,
  pool: { i: number; d: number }[],
  poolSize: number,
  stops: number,
  row: (i: number, fromShipSq: number) => GalaxyNextRow,
  loop: boolean,
): NonNullable<GalaxyNextDTO["plan"]> {
  // Everything that qualified fits in the pool → the pool is the whole candidate set.
  const poolRadius = pool.length < poolSize ? Infinity : Math.sqrt(pool[pool.length - 1]!.d);
  const cand = pool.map(({ i }) => {
    const [x, y, z] = index.pointAt(i);
    return { i, x, y, z };
  });
  const used = new Set<number>();
  const out: (GalaxyNextRow & { legLy: number })[] = [];
  let totalLy = 0;
  let totalValueCr = 0;
  let fullPasses = 0;
  let at: Pos = from;
  let atFromShip = 0;
  for (let n = 0; n < stops; n++) {
    let pick = -1;
    let pickSq = Infinity;
    for (const c of cand) {
      if (used.has(c.i)) continue;
      const sq = (c.x - at.x) ** 2 + (c.y - at.y) ** 2 + (c.z - at.z) ** 2;
      if (sq < pickSq) {
        pickSq = sq;
        pick = c.i;
      }
    }
    // Anything nearer to this stop than the pool's answer lies within atFromShip + hop of the ship;
    // when that reaches past the pool, only a full pass can say.
    if (pick < 0 ? poolRadius !== Infinity : atFromShip + Math.sqrt(pickSq) > poolRadius) {
      fullPasses++;
      const here = at;
      index.forEachPoint((i, x, y, z) => {
        if (values[i]! < floor || exclude.has(i) || used.has(i)) return;
        const sq = (x - here.x) ** 2 + (y - here.y) ** 2 + (z - here.z) ** 2;
        if (sq < pickSq) {
          pickSq = sq;
          pick = i;
        }
      });
    }
    if (pick < 0) break;
    used.add(pick);
    const [x, y, z] = index.pointAt(pick);
    const shipSq = (x - from.x) ** 2 + (y - from.y) ** 2 + (z - from.z) ** 2;
    const legLy = Math.sqrt(pickSq);
    out.push({ ...row(pick, shipSq), legLy });
    totalLy += legLy;
    totalValueCr += values[pick]! * 100_000;
    at = { x, y, z };
    atFromShip = Math.sqrt(shipSq);
  }
  // The order: 2-opt over the chosen stops, from the ship (and back to it with `loop`).
  const greedyLy = routeLength(from, out, out.map((_, k) => k), loop);
  const order = twoOptOrder(from, out, loop);
  let prev: Pos = from;
  const ordered = order.map((k) => {
    const s = out[k]!;
    const legLy = Math.hypot(s.x - prev.x, s.y - prev.y, s.z - prev.z);
    prev = s;
    return { ...s, legLy };
  });
  totalLy = routeLength(from, out, order, loop);
  const last = ordered[ordered.length - 1];
  const returnLy = loop && last ? Math.hypot(last.x - from.x, last.y - from.y, last.z - from.z) : undefined;
  return {
    stops: ordered,
    totalLy,
    totalValueCr,
    fullPasses,
    greedyLy,
    loop,
    ...(returnLy !== undefined ? { returnLy } : {}),
  };
}
