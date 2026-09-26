/**
 * @vitest-environment jsdom
 *
 * The held order behind "Most profitable" (owner's test, 2026-09-26): it must follow the figures when
 * they move — a DSS map narrowing the genera — and hold still otherwise.
 */
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act, useState } from "react";
import { useSortedBodies, type BodySortMode } from "../src/client/bodySort";
import type { BodyComputed } from "../src/shared/types";

function body(id: number, label: string, price: number): BodyComputed {
  return {
    state: { key: `1:${id}`, bodyId: id, biologicalSignals: 1 },
    tabLabel: label,
    matches: [{ entry: { genus: "Stratum" }, priceCredits: price, unlikely: false }],
    exoPayoutRange: null,
  } as unknown as BodyComputed;
}

function run(steps: BodyComputed[][], mode: BodySortMode): string[][] {
  const seen: string[][] = [];
  let set: (b: BodyComputed[]) => void = () => {};
  function Probe({ initial }: { initial: BodyComputed[] }) {
    const [bodies, setBodies] = useState(initial);
    set = setBodies;
    const out = useSortedBodies(bodies, mode, null, 1);
    seen.push(out.map((b) => b.tabLabel));
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe initial={steps[0]!} />));
  for (const s of steps.slice(1)) act(() => set(s));
  act(() => root.unmount());
  return seen;
}

describe("useSortedBodies", () => {
  it("re-sorts Most profitable when a body's value changes", () => {
    const before = [body(1, "A 2", 1_000_000), body(2, "C 6", 500_000)];
    const after = [body(1, "A 2", 1_000_000), body(2, "C 6", 19_000_000)];
    const seen = run([before, after], "profit");
    expect(seen[0]).toEqual(["A 2", "C 6"]);
    expect(seen[seen.length - 1]).toEqual(["C 6", "A 2"]);
  });

  it("holds Alphabetical still when only values change", () => {
    const seen = run(
      [
        [body(1, "2", 1), body(2, "1", 2)],
        [body(1, "2", 50), body(2, "1", 60)],
      ],
      "alpha",
    );
    expect(seen[seen.length - 1]).toEqual(["1", "2"]);
  });
});
