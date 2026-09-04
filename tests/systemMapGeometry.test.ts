import { describe, expect, it } from "vitest";
import { computeSystemMapLayout } from "../src/client/systemMapGeometry.js";
import type { SystemMapNodeDTO } from "../src/shared/types.js";

function node(
  over: Partial<SystemMapNodeDTO> & Pick<SystemMapNodeDTO, "bodyId" | "bodyName">,
): SystemMapNodeDTO {
  return {
    label: "HMC",
    mapLabel: "HMC",
    isStar: false,
    hasExobiology: false,
    valuePlus: false,
    maxExoHeuristicCredits: 0,
    exoValueTier: 0,
    namePlus: false,
    starVisual: "default",
    orbitPrimaryKey: "0",
    children: [],
    ...over,
  };
}

const SYSTEM = "Test Sector AB-C d1-2";

/** One star, two planets, one of them with two moons. */
const roots: SystemMapNodeDTO[] = [
  node({
    bodyId: 0,
    bodyName: `${SYSTEM}`,
    label: "G",
    mapLabel: "G",
    isStar: true,
    orbitPrimaryKey: "",
    children: [
      node({ bodyId: 1, bodyName: "1", semiMajorAxis: 1e11 }),
      node({
        bodyId: 2,
        bodyName: "2",
        hasExobiology: true,
        exoValueTier: 2,
        semiMajorAxis: 5e11,
        children: [
          node({ bodyId: 3, bodyName: "2 a", semiMajorAxis: 1e8 }),
          node({ bodyId: 4, bodyName: "2 b", semiMajorAxis: 2e8 }),
        ],
      }),
    ],
  }),
];

describe("computeSystemMapLayout", () => {
  it("lays out every node exactly once", () => {
    const l = computeSystemMapLayout(roots, SYSTEM);
    expect(l.items.map((i) => i.bodyId).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it("runs the star and its planets along one row, ordered outwards", () => {
    const l = computeSystemMapLayout(roots, SYSTEM);
    const at = (id: number) => l.items.find((i) => i.bodyId === id)!;
    expect(at(0).cx).toBeLessThan(at(1).cx);
    expect(at(1).cx).toBeLessThan(at(2).cx);
    expect(at(0).cy).toBe(at(1).cy);
    expect(at(1).cy).toBe(at(2).cy);
  });

  it("hangs moons under their planet, in orbit order", () => {
    const l = computeSystemMapLayout(roots, SYSTEM);
    const at = (id: number) => l.items.find((i) => i.bodyId === id)!;
    expect(at(3).cx).toBe(at(2).cx);
    expect(at(4).cx).toBe(at(2).cx);
    expect(at(3).cy).toBeGreaterThan(at(2).cy);
    expect(at(4).cy).toBeGreaterThan(at(3).cy);
    expect(at(3).r).toBeLessThan(at(2).r);
  });

  it("produces a bounding box that contains every node with its radius", () => {
    const l = computeSystemMapLayout(roots, SYSTEM);
    for (const i of l.items) {
      expect(i.cx - i.r).toBeGreaterThanOrEqual(l.minX);
      expect(i.cy - i.r).toBeGreaterThanOrEqual(l.minY);
      expect(i.cx + i.r).toBeLessThanOrEqual(l.minX + l.width);
      expect(i.cy + i.r).toBeLessThanOrEqual(l.minY + l.height);
    }
    expect(l.width).toBeGreaterThan(0);
    expect(l.height).toBeGreaterThan(0);
  });

  it("draws a connector for every parent/child edge", () => {
    const l = computeSystemMapLayout(roots, SYSTEM);
    expect(l.segments.length).toBeGreaterThanOrEqual(4);
    for (const s of l.segments) {
      expect(Number.isFinite(s.x1) && Number.isFinite(s.y1)).toBe(true);
      expect(Number.isFinite(s.x2) && Number.isFinite(s.y2)).toBe(true);
    }
  });

  it("carries the exobiology ring class and value tier through to the drawn item", () => {
    const l = computeSystemMapLayout(roots, SYSTEM);
    const exo = l.items.find((i) => i.bodyId === 2)!;
    expect(exo.ringClass).toBe("exo");
    expect(exo.exoValueTier).toBe(2);
    expect(l.items.find((i) => i.bodyId === 1)!.ringClass).toBe("plain");
    expect(l.items.find((i) => i.bodyId === 0)!.isStar).toBe(true);
  });

  it("keeps the short body designations it was given", () => {
    const l = computeSystemMapLayout(roots, SYSTEM);
    expect(l.items.find((i) => i.bodyId === 3)!.bodyName).toBe("2 a");
  });

  it("is deterministic", () => {
    expect(computeSystemMapLayout(roots, SYSTEM)).toEqual(computeSystemMapLayout(roots, SYSTEM));
  });

  /**
   * An empty tree collapses the bounding box to a negative width. SystemMapModal's
   * `layout.width <= 0` check is what turns that into the empty state, so the sign matters.
   */
  it("reports a non-positive width for an empty system", () => {
    const l = computeSystemMapLayout([], SYSTEM);
    expect(l.items).toEqual([]);
    expect(l.segments).toEqual([]);
    expect(l.width <= 0).toBe(true);
  });

  it("keeps a placeholder body visually distinct", () => {
    const withPlaceholder: SystemMapNodeDTO[] = [
      {
        ...roots[0]!,
        children: [...roots[0]!.children, node({ bodyId: 9, bodyName: "9", isInferredPlaceholder: true })],
      },
    ];
    const l = computeSystemMapLayout(withPlaceholder, SYSTEM);
    expect(l.items.find((i) => i.bodyId === 9)!.ringClass).toBe("placeholder");
  });
});
