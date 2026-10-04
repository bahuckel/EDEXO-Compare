/**
 * The plan's order (plan 5.8, Fable review: "Plan as a TSP, not nearest-next"). The greedy chain
 * chooses the stops well — each the nearest worthwhile system to the last — but visits them in the
 * order it found them, and a chain that wandered doubles back. 2-opt reverses any stretch of the
 * route whose two end legs cross, until no reversal shortens it: for the 20 stops a plan can have
 * that is well under a millisecond, and it never makes the route longer than the greedy one.
 *
 * The start (the ship) is fixed. An open route ends wherever is shortest; `loop` closes it back at
 * the start ("back to the carrier").
 *
 * 2-opt alone stalls on an open route with a fixed start: a stop the chain left behind the ship can
 * only be reached through a longer route first. Or-opt fixes that — move a run of one to three stops
 * elsewhere, either way round — and the two take turns until neither shortens the route.
 */
export type Pt = { x: number; y: number; z: number };

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Length of start → stops in `order` (→ start again when `loop`). */
export function routeLength(start: Pt, stops: Pt[], order: number[], loop: boolean): number {
  let len = 0;
  let at = start;
  for (const i of order) {
    len += dist(at, stops[i]!);
    at = stops[i]!;
  }
  if (loop && order.length) len += dist(at, start);
  return len;
}

/**
 * The visiting order of `stops` from `start`, improved by 2-opt and Or-opt from the given one
 * (default: as listed). Returns indices into `stops`.
 */
export function twoOptOrder(start: Pt, stops: Pt[], loop: boolean, initial?: number[]): number[] {
  let order = initial ? [...initial] : stops.map((_, i) => i);
  let len = routeLength(start, stops, order, loop);
  for (let round = 0; round < 100; round++) {
    order = twoOptPass(start, stops, loop, order);
    order = orOptPass(start, stops, loop, order);
    const next = routeLength(start, stops, order, loop);
    if (next >= len - 1e-9) break;
    len = next;
  }
  return order;
}

/** Or-opt: the best single move of a run of 1–3 stops to another place, as is or reversed, repeated. */
function orOptPass(start: Pt, stops: Pt[], loop: boolean, initial: number[]): number[] {
  let order = initial;
  let best = routeLength(start, stops, order, loop);
  for (let improved = true, guard = 0; improved && guard < 1000; guard++) {
    improved = false;
    for (let len = 1; len <= 3 && !improved; len++) {
      for (let i = 0; i + len <= order.length && !improved; i++) {
        const run = order.slice(i, i + len);
        const rest = [...order.slice(0, i), ...order.slice(i + len)];
        for (let at = 0; at <= rest.length && !improved; at++) {
          if (at === i) continue;
          for (const r of len > 1 ? [run, [...run].reverse()] : [run]) {
            const cand = [...rest.slice(0, at), ...r, ...rest.slice(at)];
            const l = routeLength(start, stops, cand, loop);
            if (l < best - 1e-9) {
              order = cand;
              best = l;
              improved = true;
              break;
            }
          }
        }
      }
    }
  }
  return order;
}

function twoOptPass(start: Pt, stops: Pt[], loop: boolean, initial: number[]): number[] {
  // Node 0 is the start; nodes 1..n the stops in the current order.
  const order = [...initial];
  const n = order.length;
  if (n < 2) return order;
  const node = (k: number): Pt => (k === 0 ? start : stops[order[k - 1]!]!);
  // With a loop the route returns to node 0; without, the leg after the last stop does not exist.
  const after = (k: number): Pt | null => (k < n ? node(k + 1) : loop ? start : null);
  const EPS = 1e-9;
  for (let improved = true, guard = 0; improved && guard < 1000; guard++) {
    improved = false;
    // Reverse stops i..j (positions 1-based): legs (i-1 → i) and (j → j+1) become (i-1 → j), (i → j+1).
    for (let i = 1; i < n; i++) {
      for (let j = i + 1; j <= n; j++) {
        const a = node(i - 1);
        const b = node(i);
        const c = node(j);
        const d = after(j);
        const before = dist(a, b) + (d ? dist(c, d) : 0);
        const afterLen = dist(a, c) + (d ? dist(b, d) : 0);
        if (afterLen < before - EPS) {
          let lo = i - 1;
          let hi = j - 1;
          while (lo < hi) {
            const t = order[lo]!;
            order[lo] = order[hi]!;
            order[hi] = t;
            lo++;
            hi--;
          }
          improved = true;
        }
      }
    }
  }
  return order;
}
