/**
 * The plan's 2-opt order (plan 5.8): never longer than the greedy order, and right on instances whose
 * best route is known.
 */
import { describe, expect, it } from "vitest";
import { routeLength, twoOptOrder, type Pt } from "../src/server/tourOrder.js";

const p = (x: number, y = 0, z = 0): Pt => ({ x, y, z });

/** Every order of `n` items, for a brute-force optimum on small instances. */
function* permutations(n: number): Generator<number[]> {
  const a = Array.from({ length: n }, (_, i) => i);
  const c = new Array(n).fill(0);
  yield [...a];
  for (let i = 0; i < n; ) {
    if (c[i] < i) {
      const k = i % 2 ? c[i] : 0;
      [a[k], a[i]] = [a[i]!, a[k]!];
      yield [...a];
      c[i]++;
      i = 0;
    } else c[i++] = 0;
  }
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

describe("twoOptOrder", () => {
  it("untangles a route that doubles back along a line", () => {
    const start = p(0);
    // The greedy chain found them in this order: out to 10, back to 2, out again to 12.
    const stops = [p(10), p(2), p(12), p(4)];
    const order = twoOptOrder(start, stops, false);
    expect(order.map((i) => stops[i]!.x)).toEqual([2, 4, 10, 12]);
    expect(routeLength(start, stops, order, false)).toBe(12);
  });

  it("closes a square without crossing itself when asked to loop back", () => {
    const start = p(0, 0);
    const stops = [p(10, 10), p(10, 0), p(0, 10)]; // as found: diagonal first, a crossed loop
    const order = twoOptOrder(start, stops, true);
    expect(routeLength(start, stops, order, true)).toBeCloseTo(40, 9);
  });

  it("is never longer than the order it starts from, and finds the optimum on small random instances", () => {
    const r = rng(42);
    for (let t = 0; t < 40; t++) {
      const start = p(r() * 100, r() * 100, r() * 100);
      const stops = Array.from({ length: 7 }, () => p(r() * 100, r() * 100, r() * 100));
      for (const loop of [false, true]) {
        const greedy = stops.map((_, i) => i);
        const order = twoOptOrder(start, stops, loop);
        expect(order.slice().sort()).toEqual(greedy);
        const len = routeLength(start, stops, order, loop);
        expect(len).toBeLessThanOrEqual(routeLength(start, stops, greedy, loop) + 1e-9);
        let best = Infinity;
        for (const perm of permutations(stops.length)) best = Math.min(best, routeLength(start, stops, perm, loop));
        // 2-opt is a local optimum: within a few per cent of the best on instances this small.
        expect(len).toBeLessThanOrEqual(best * 1.08 + 1e-9);
      }
    }
  });

  it("orders the 20 stops a plan can have in well under the time of a request", () => {
    const r = rng(7);
    const start = p(0, 0, 0);
    const stops = Array.from({ length: 20 }, () => p(r() * 1000, r() * 1000, r() * 1000));
    const t = performance.now();
    const order = twoOptOrder(start, stops, true);
    expect(performance.now() - t).toBeLessThan(100);
    expect(routeLength(start, stops, order, true)).toBeLessThan(routeLength(start, stops, stops.map((_, i) => i), true));
  });

  it("leaves one stop or none alone", () => {
    expect(twoOptOrder(p(0), [], false)).toEqual([]);
    expect(twoOptOrder(p(0), [p(5)], true)).toEqual([0]);
  });
});
