/**
 * The rebuilt system map layout (owner, 2026-09-27): the game's arrangement, checked as invariants on
 * made-up systems shaped like real ones. Structure only — names and types, no commander data.
 */
import { describe, expect, it } from "vitest";
import {
  computeSystemMapLayout,
  neighbourInDirection,
  orbitChain,
  type MapLayout,
} from "../src/client/systemMapLayout.js";
import type { SystemMapNodeDTO } from "../src/shared/types.js";

let nextId = 1;
function body(
  name: string,
  children: SystemMapNodeDTO[] = [],
  over: Partial<SystemMapNodeDTO> = {},
): SystemMapNodeDTO {
  return {
    bodyId: nextId++,
    bodyName: name,
    label: "I",
    mapLabel: "I",
    isStar: false,
    hasExobiology: false,
    valuePlus: false,
    maxExoHeuristicCredits: 0,
    exoValueTier: 0,
    namePlus: false,
    starVisual: "default",
    orbitPrimaryKey: "",
    children,
    ...over,
  };
}
const star = (name: string, cls: string, children: SystemMapNodeDTO[] = []) =>
  body(name, children, { isStar: true, label: cls, mapLabel: cls.charAt(0) });
const bary = (children: SystemMapNodeDTO[]) =>
  body("", children, { isBarycentre: true, label: "×", mapLabel: "×" });

/** Tegnae IJ-A b58-0 as the game draws it: ((A B) C + ABC 1–6) D + D 1–6; ABC 2 a, ABC 5 a. */
function tegnae(): SystemMapNodeDTO[] {
  return [
    bary([
      bary([
        bary([star("A", "M"), star("B", "T")]),
        star("C", "L"),
        body("ABC 1", [], { label: "RI" }),
        body("ABC 2", [body("ABC 2 a")], { label: "RI" }),
        body("ABC 3"),
        body("ABC 4"),
        body("ABC 5", [body("ABC 5 a")]),
        body("ABC 6"),
      ]),
      star("D", "L", [body("D 1"), body("D 2"), body("D 3"), body("D 4"), body("D 5"), body("D 6")]),
    ]),
  ];
}

/** A star with a planet pair, a pair nested with a third planet, and a moon pair. */
function pairs(): SystemMapNodeDTO[] {
  return [
    star("★", "G", [
      body("1"),
      bary([body("2"), body("3")]),
      bary([bary([body("4"), body("5")]), body("6")]),
      body("7", [bary([body("7 a"), body("7 b")]), body("7 c")]),
    ]),
  ];
}

const at = (l: MapLayout, name: string) => {
  const it = l.items.find((i) => i.node.bodyName === name && i.kind !== "bary" && i.kind !== "hub");
  if (!it) throw new Error(`no ${name}`);
  return it;
};

/** Icon + mark boxes of real bodies must never touch. */
function overlaps(l: MapLayout): string[] {
  const boxes = l.items
    .filter((i) => i.kind !== "bary")
    .map((i) => ({
      n: i.node.bodyName || String(i.id),
      x0: i.cx - i.r - 5,
      x1: i.cx + i.r + 5,
      y0: i.cy - i.r - 5,
      y1: i.cy + i.r + 5,
    }));
  const bad: string[] = [];
  for (let a = 0; a < boxes.length; a++)
    for (let b = a + 1; b < boxes.length; b++) {
      const p = boxes[a]!;
      const q = boxes[b]!;
      if (p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1) bad.push(`${p.n} × ${q.n}`);
    }
  return bad;
}

describe("system map layout (game style)", () => {
  it("stacks Tegnae's column as the game does: A, B, ×ABC, C, D", () => {
    const l = computeSystemMapLayout(tegnae(), "Tegnae IJ-A b58-0");
    const column = l.items.filter((i) => i.kind === "star" || i.kind === "hub").sort((a, b) => a.cy - b.cy);
    expect(column.map((i) => (i.kind === "hub" ? "×" : i.node.bodyName))).toEqual(["A", "B", "×", "C", "D"]);
    expect(new Set(column.map((i) => i.cx)).size).toBe(1);
  });

  it("runs ABC's planets right from its × and D's from D, all starting on one line", () => {
    const l = computeSystemMapLayout(tegnae(), "Tegnae IJ-A b58-0");
    const hub = l.items.find((i) => i.kind === "hub")!;
    for (let k = 1; k <= 6; k++) expect(at(l, `ABC ${k}`).cy).toBe(hub.cy);
    for (let k = 1; k <= 6; k++) expect(at(l, `D ${k}`).cy).toBe(at(l, "D").cy);
    expect(at(l, "ABC 1").cx).toBe(at(l, "D 1").cx);
    const xs = [1, 2, 3, 4, 5, 6].map((k) => at(l, `ABC ${k}`).cx);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it("hangs moons under their planet, smaller", () => {
    const l = computeSystemMapLayout(tegnae(), "Tegnae IJ-A b58-0");
    const p = at(l, "ABC 2");
    const m = at(l, "ABC 2 a");
    expect(m.cx).toBe(p.cx);
    expect(m.cy).toBeGreaterThan(p.cy);
    expect(m.r).toBeLessThan(p.r);
  });

  it("draws the star brackets left of the column, nesting one step further out", () => {
    const l = computeSystemMapLayout(tegnae(), "Tegnae IJ-A b58-0");
    const colX = at(l, "A").cx;
    const rails = l.lines.filter((s) => s.kind === "bracket" && s.x1 === s.x2 && s.x1 < colX);
    const railXs = [...new Set(rails.map((s) => s.x1))].sort((a, b) => b - a);
    expect(railXs.length).toBe(3); // AB, ABC, root
    // AB spans A..B; ABC spans AB's midpoint..C; the root spans the ×..D.
    const span = (x: number) =>
      rails.filter((s) => s.x1 === x).map((s) => [Math.min(s.y1, s.y2), Math.max(s.y1, s.y2)])[0]!;
    const [ab, abc, root] = railXs.map(span);
    expect(ab).toEqual([at(l, "A").cy, at(l, "B").cy]);
    const hub = l.items.find((i) => i.kind === "hub")!;
    expect(abc![1]).toBe(at(l, "C").cy);
    expect(root).toEqual([hub.cy, at(l, "D").cy]);
  });

  it("never lets two bodies overlap", () => {
    expect(overlaps(computeSystemMapLayout(tegnae(), "Tegnae IJ-A b58-0"))).toEqual([]);
    expect(overlaps(computeSystemMapLayout(pairs(), "Pairs"))).toEqual([]);
  });

  it("draws every body exactly once", () => {
    const l = computeSystemMapLayout(pairs(), "Pairs");
    const names = l.items.filter((i) => i.kind !== "bary").map((i) => i.node.bodyName);
    expect(names.sort()).toEqual(["1", "2", "3", "4", "5", "6", "7", "7 a", "7 b", "7 c", "★"].sort());
    expect(new Set(l.items.map((i) => i.id)).size).toBe(l.items.length);
  });

  it("brackets a planet pair above the row and steps a nested pair one level higher", () => {
    const l = computeSystemMapLayout(pairs(), "Pairs");
    const baries = l.items
      .filter((i) => i.kind === "bary" && i.cy < at(l, "1").cy)
      .sort((a, b) => a.cx - b.cx);
    expect(baries.length).toBe(3);
    const [b23, b45, b456] = baries.sort((a, b) => a.cx - b.cx);
    expect(b23!.cx).toBe((at(l, "2").cx + at(l, "3").cx) / 2);
    expect(b45!.cy).toBe(b23!.cy);
    expect(b456!.cy).toBeLessThan(b45!.cy);
  });

  it("brackets a moon pair on the left of the moon column", () => {
    const l = computeSystemMapLayout(pairs(), "Pairs");
    const moonBary = l.items.find((i) => i.kind === "bary" && i.cy > at(l, "7").cy)!;
    expect(moonBary.cx).toBeLessThan(at(l, "7 a").cx - at(l, "7 a").r);
    expect(moonBary.cy).toBe((at(l, "7 a").cy + at(l, "7 b").cy) / 2);
    expect(at(l, "7 c").cy).toBeGreaterThan(at(l, "7 b").cy);
  });

  it("gives each body its chain to the top, through the barycentres", () => {
    const tree = tegnae();
    const l = computeSystemMapLayout(tree, "Tegnae IJ-A b58-0");
    const chain = orbitChain(l, at(l, "ABC 2 a").id);
    expect(chain.has(at(l, "ABC 2").id)).toBe(true);
    expect(chain.has(tree[0]!.bodyId)).toBe(true);
    expect(orbitChain(l, at(l, "B").id).has(tree[0]!.children[0]!.children[0]!.bodyId)).toBe(true);
  });

  it("puts a world the journal could not place on the barycentre its name says", () => {
    const planetAB = body("AB 1");
    const tree = [bary([star("A", "K", [planetAB]), star("B", "M")])];
    const l = computeSystemMapLayout(tree, "X");
    const hub = l.items.find((i) => i.kind === "hub")!;
    expect(hub.id).toBe(tree[0]!.bodyId);
    expect(at(l, "AB 1").cy).toBe(hub.cy);
    expect(at(l, "A").cy).toBeLessThan(hub.cy);
    expect(at(l, "B").cy).toBeGreaterThan(hub.cy);
  });

  it("orders the column by star letter, not by a barycentre's planets", () => {
    // Tegnae ZK-Z c28-3: (B C + BC 1–4) A — BC 1's designation must not sort the pair above A.
    const tree = [bary([bary([star("B", "M"), star("C", "T"), body("BC 1"), body("BC 2")]), star("A", "K")])];
    const l = computeSystemMapLayout(tree, "X");
    const column = l.items.filter((i) => i.kind === "star" || i.kind === "hub").sort((a, b) => a.cy - b.cy);
    expect(column.map((i) => (i.kind === "hub" ? "×" : i.node.bodyName))).toEqual(["A", "B", "×", "C"]);
  });

  it("spaces a row's planets evenly even when one has a moon", () => {
    const l = computeSystemMapLayout(tegnae(), "T");
    const xs = [1, 2, 3, 4, 5, 6].map((k) => at(l, `ABC ${k}`).cx);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.01);
  });

  it("makes an inferred × when there is no barycentre to put it on", () => {
    const l = computeSystemMapLayout([star("A", "K", [body("AB 1")]), star("B", "M")], "X");
    const hub = l.items.find((i) => i.kind === "hub")!;
    expect(hub.inferred).toBe(true);
    expect(at(l, "AB 1").cy).toBe(hub.cy);
  });

  it("sizes stars by class and keeps a bounding box round everything", () => {
    const l = computeSystemMapLayout(tegnae(), "Tegnae IJ-A b58-0");
    expect(at(l, "A").r).toBeGreaterThan(at(l, "C").r); // M over L
    expect(at(l, "C").r).toBeGreaterThan(at(l, "ABC 1").r);
    for (const it of l.items) {
      expect(it.cx - it.r).toBeGreaterThanOrEqual(l.minX);
      expect(it.cy - it.r).toBeGreaterThanOrEqual(l.minY);
      expect(it.cx + it.r).toBeLessThanOrEqual(l.minX + l.width);
      expect(it.cy + it.r).toBeLessThanOrEqual(l.minY + l.height);
    }
  });

  it("moves between bodies with the arrow keys the way the map is drawn", () => {
    const l = computeSystemMapLayout(tegnae(), "T");
    const go = (from: string, dir: "left" | "right" | "up" | "down") =>
      neighbourInDirection(l.items, at(l, from), dir)?.node.bodyName;
    expect(go("D 4", "right")).toBe("D 5");
    expect(go("D 4", "left")).toBe("D 3");
    expect(go("ABC 2", "down")).toBe("ABC 2 a");
    expect(go("ABC 2 a", "up")).toBe("ABC 2");
    expect(go("A", "down")).toBe("B");
    expect(go("D 1", "left")).toBe("D");
    expect(go("A", "up")).toBeUndefined();
  });

  it("is deterministic and empty for no bodies", () => {
    const t = tegnae();
    expect(JSON.stringify(computeSystemMapLayout(t, "T").lines)).toBe(
      JSON.stringify(computeSystemMapLayout(t, "T").lines),
    );
    expect(computeSystemMapLayout([], "T").width).toBe(0);
  });
});
