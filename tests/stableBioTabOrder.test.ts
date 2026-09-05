import { describe, expect, it } from "vitest";
import type { BodyComputed } from "../src/shared/types.js";
import { nextOrder, sameOrder } from "../src/client/useStableBioTabOrder.js";

function body(key: string, bodyId: number): BodyComputed {
  return { state: { key, bodyId } } as unknown as BodyComputed;
}

const A = body("a", 1);
const B = body("b", 2);
const C = body("c", 3);

/**
 * The guard that turns the loop off. The effect can only bail out of a re-render if it can tell
 * "the same order, in a different array" from "a different order" — §49.
 */
describe("sameOrder", () => {
  it("sees two different arrays holding the same order as the same order", () => {
    expect(sameOrder(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameOrder([], [])).toBe(true);
  });

  it("sees a reorder, an addition and a removal", () => {
    expect(sameOrder(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameOrder(["a"], ["a", "b"])).toBe(false);
    expect(sameOrder(["a", "b"], ["a"])).toBe(false);
  });
});

describe("nextOrder", () => {
  it("takes journal order on a system change, whatever was there before", () => {
    expect(nextOrder(["c", "b"], [A, B, C], true)).toEqual(["a", "b", "c"]);
  });

  it("takes journal order from nothing", () => {
    expect(nextOrder([], [A, B], false)).toEqual(["a", "b"]);
  });

  /** The whole point of the hook: a body scanned mid-system must not shuffle the strip. */
  it("keeps the established order and appends new bodies by bodyId", () => {
    expect(nextOrder(["c", "a"], [A, B, C], false)).toEqual(["c", "a", "b"]);
  });

  it("drops bodies that are gone", () => {
    expect(nextOrder(["a", "b", "c"], [A, C], false)).toEqual(["a", "c"]);
  });

  it("appends several new bodies in bodyId order, not journal order", () => {
    expect(nextOrder(["a"], [C, B, A], false)).toEqual(["a", "b", "c"]);
  });

  /**
   * The loop itself, as a test. Before §49 this returned a fresh `[]` for every render that had no
   * snapshot yet, and the caller's `?? []` handed it a fresh `[]` right back.
   */
  it("is stable when nothing changed, so the effect can hand back the old state", () => {
    const prev = ["a", "b"];
    expect(sameOrder(prev, nextOrder(prev, [A, B], false))).toBe(true);
    expect(sameOrder([], nextOrder([], [], false))).toBe(true);
  });
});
