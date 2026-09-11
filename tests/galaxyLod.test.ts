import { describe, expect, it } from "vitest";
import {
  groupByRegion,
  isOnScreen,
  lodLevel,
  REGION_VIEW_BELOW_SCALE,
  type LodRow,
} from "../src/client/galaxyLod.js";
import type { GalaxyTier } from "../src/shared/galaxyTier.js";

function row(name: string, x: number, bodies: number, tier: GalaxyTier): LodRow<string> {
  return { cell: name, x, y: 0, z: 0, bodies, tier };
}

describe("lodLevel", () => {
  it("groups into regions while zoomed out and splits into sectors past the threshold", () => {
    expect(lodLevel(1)).toBe("region");
    expect(lodLevel(REGION_VIEW_BELOW_SCALE - 0.01)).toBe("region");
    expect(lodLevel(REGION_VIEW_BELOW_SCALE)).toBe("sector");
    expect(lodLevel(60)).toBe("sector");
  });
});

describe("groupByRegion", () => {
  const inner = { id: 7, name: "Inner Orion Spur" };
  const outer = { id: 9, name: "Outer Arm" };

  it("collapses a region's sectors into one circle, summing what is recorded there", () => {
    const groups = groupByRegion(
      [row("a", 0, 10, "confirmed"), row("b", 2, 5, "confirmed"), row("c", 100, 1, "signals")],
      (r) => (r.cell === "c" ? outer : inner),
    );
    expect(groups).toHaveLength(2);
    const spur = groups.find((g) => g.regionId === 7)!;
    expect(spur.rows).toHaveLength(2);
    expect(spur.bodies).toBe(15);
    // The centroid is the middle of its members, so the circle sits over what it stands for.
    expect(spur.x).toBe(1);
  });

  it("reports a region as uniform only when every sector says the same thing", () => {
    const same = groupByRegion([row("a", 0, 1, "genus"), row("b", 1, 1, "genus")], () => inner);
    expect(same[0]!.uniform).toBe(true);

    const mixed = groupByRegion([row("a", 0, 1, "genus"), row("b", 1, 1, "missed")], () => inner);
    expect(mixed[0]!.uniform).toBe(false);
  });

  it("carries the most actionable tier, whatever order the sectors arrive in", () => {
    // "missed" outranks everything: one unfinished sector is what the region is worth going for.
    const forwards = groupByRegion([row("a", 0, 1, "done"), row("b", 1, 1, "missed")], () => inner);
    const backwards = groupByRegion([row("a", 0, 1, "missed"), row("b", 1, 1, "done")], () => inner);
    expect(forwards[0]!.tier).toBe("missed");
    expect(backwards[0]!.tier).toBe("missed");
    expect(forwards[0]!.uniform).toBe(false);
  });

  it("keeps unplaceable sectors as separate marks rather than one blob of nowhere", () => {
    const nowhere = { id: 0, name: "" };
    const groups = groupByRegion([row("a", 0, 1, "signals"), row("b", 900, 1, "signals")], () => nowhere);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.x).sort((p, q) => p - q)).toEqual([0, 900]);
  });
});

describe("isOnScreen", () => {
  const view = { scale: 1, tx: 0, ty: 0 };

  it("keeps what the viewport can see", () => {
    expect(isOnScreen(10, 10, view, 600, 400)).toBe(true);
    expect(isOnScreen(599, 399, view, 600, 400)).toBe(true);
  });

  it("drops what has left the view, so zooming in unloads rather than hides", () => {
    expect(isOnScreen(-500, 10, view, 600, 400)).toBe(false);
    expect(isOnScreen(10, 5000, view, 600, 400)).toBe(false);
  });

  it("accounts for the pan and zoom, not just the raw coordinates", () => {
    // Zoomed 10x with no pan, plot x=300 lands at screen x=3000 — well outside a 600 px plot.
    expect(isOnScreen(300, 0, { scale: 10, tx: 0, ty: 0 }, 600, 400)).toBe(false);
    // Panned back to bring it into frame, the same point is visible again.
    expect(isOnScreen(300, 0, { scale: 10, tx: -2800, ty: 0 }, 600, 400)).toBe(true);
  });

  it("keeps a mark whose centre is just outside, because its edge is still drawn", () => {
    expect(isOnScreen(-20, 10, view, 600, 400)).toBe(true);
    expect(isOnScreen(-20, 10, view, 600, 400, 5)).toBe(false);
  });
});
