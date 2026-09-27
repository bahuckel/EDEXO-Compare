/**
 * Structural reuse of incoming snapshots (client/snapshotMerge.ts): unchanged branches keep their
 * identity, so memoised panels do not re-render (code review §E, 2026-09-27).
 */
import { describe, expect, it } from "vitest";
import { reuseUnchanged } from "../src/client/snapshotMerge.js";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const base = {
  bodies: [
    { key: "a", matches: [{ id: 1 }, { id: 2 }] },
    { key: "b", matches: [{ id: 3 }] },
  ],
  header: { system: "X", n: 2 },
  map: null as null | { t: number },
};

describe("reuseUnchanged", () => {
  it("returns the previous object when nothing changed", () => {
    expect(reuseUnchanged(base, clone(base))).toBe(base);
  });

  it("rebuilds only the path to a change and keeps every sibling", () => {
    const next = clone(base);
    next.bodies[1]!.matches[0]!.id = 99;
    const out = reuseUnchanged(base, next);
    expect(out).not.toBe(base);
    expect(out).toEqual(next);
    expect(out.bodies[0]).toBe(base.bodies[0]);
    expect(out.header).toBe(base.header);
    expect(out.bodies[1]).not.toBe(base.bodies[1]);
  });

  it("handles keys and elements added or removed", () => {
    const added = { ...clone(base), extra: 1 };
    const out1 = reuseUnchanged(base as typeof added, added);
    expect(out1).toEqual(added);
    expect(out1.header).toBe(base.header);

    const fewer = clone(base);
    fewer.bodies.pop();
    const out2 = reuseUnchanged(base, fewer);
    expect(out2).toEqual(fewer);
    expect(out2.bodies[0]).toBe(base.bodies[0]);

    const swapped = { bodies: base.bodies, header: base.header, other: null } as unknown as typeof base;
    expect(reuseUnchanged(base, swapped)).toEqual(swapped);
  });

  it("keeps the key order of the new value", () => {
    const next = { header: clone(base.header), map: { t: 1 }, bodies: clone(base.bodies) };
    expect(Object.keys(reuseUnchanged(base, next as unknown as typeof base))).toEqual(["header", "map", "bodies"]);
  });
});
