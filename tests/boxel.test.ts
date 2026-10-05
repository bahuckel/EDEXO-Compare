/**
 * Boxels (src/shared/boxel.ts, src/server/boxel.ts; guild tester report, 2026-09-30).
 */
import { describe, expect, it } from "vitest";
import { boxelIndexOf, parseBoxel } from "../src/shared/boxel.js";
import { boxelSystems } from "../src/server/boxel.js";

describe("boxel names", () => {
  it("a system name gives its boxel and number", () => {
    expect(parseBoxel("Eol Prou AB-C d1-23")).toEqual({
      sector: "Eol Prou",
      boxel: "AB-C d1",
      massCode: "d",
      prefix: "Eol Prou AB-C d1-",
      index: 23,
    });
    // Boxel 0 leaves its number out.
    expect(parseBoxel("Bleethuia QV-L b16")).toMatchObject({ boxel: "QV-L b", prefix: "Bleethuia QV-L b", index: 16 });
    // The boxel itself, with a trailing dash.
    expect(parseBoxel("Eol Prou AB-C d1-")).toMatchObject({ prefix: "Eol Prou AB-C d1-", index: 0 });
    expect(parseBoxel("HIP 87621")).toBeNull();
    expect(parseBoxel("Sol")).toBeNull();
  });

  it("a name is in the boxel only with just a number after the prefix", () => {
    expect(boxelIndexOf("Eol Prou AB-C d1-7", "Eol Prou AB-C d1-")).toBe(7);
    expect(boxelIndexOf("Eol Prou AB-C d12-7", "Eol Prou AB-C d1-")).toBeNull();
    expect(boxelIndexOf("Bleethuia QV-L b16", "Bleethuia QV-L b")).toBe(16);
    expect(boxelIndexOf("Bleethuia QV-L b1-6", "Bleethuia QV-L b")).toBeNull();
  });
});

describe("the listing", () => {
  it("lists -0 to the end, marks what you flew, and names the next one", () => {
    const d = boxelSystems({
      query: "Eol Prou AB-C d1-2",
      end: null,
      index: null,
      visited: ["Eol Prou AB-C d1-0", "Eol Prou AB-C d1-2", "Eol Prou AB-C d1-5", "Eol Prou AB-C d12-9", "Sol"],
      speciesName: (id) => id,
    })!;
    expect(d.rows.map((r) => [r.n, r.visited])).toEqual([
      [0, true],
      [1, false],
      [2, true],
      [3, false],
      [4, false],
      [5, true],
    ]);
    expect(d.nextUnvisited).toBe("Eol Prou AB-C d1-1");
    expect(d).toMatchObject({ visitedCount: 3, knownCount: 0, cubeLy: 80, noIndex: true });
    // A known end number stretches the list.
    expect(boxelSystems({ query: "Eol Prou AB-C d1-2", end: 9, index: null, visited: [], speciesName: (i) => i })!.rows).toHaveLength(10);
  });
});

describe("saved boxels (owner, 2026-09-30)", () => {
  it("keeps a boxel by its last system, lists -0 up to it and ticks off what was flown", async () => {
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { createSavedBoxels } = await import("../src/server/savedBoxels.js");
    const file = join(mkdtempSync(join(tmpdir(), "edexo-boxels-")), "edexo-boxels.json");
    const s = createSavedBoxels({ filePath: file });
    expect(s.add("Eol Prou")).toBeNull();
    const { id } = s.add("  Eol Prou AB-C d1-5 ")!;
    const visited = ["Eol Prou AB-C d1-0", "eol prou ab-c d1-2", "Eol Prou AB-C d1-9", "Eol Prou AB-C d2-1", "Sol"];
    expect(s.list(visited)).toEqual([
      expect.objectContaining({ id, boxel: "AB-C d1", sector: "Eol Prou", end: 5, total: 6, flown: 2, next: "Eol Prou AB-C d1-1" }),
    ]);
    // The same boxel again moves its end instead of adding a second one.
    expect(s.add("Eol Prou AB-C d1-9")!.id).toBe(id);
    expect(s.list(visited)[0]).toMatchObject({ end: 9, flown: 3 });
    // All flown: no next.
    const all = Array.from({ length: 10 }, (_, n) => `Eol Prou AB-C d1-${n}`);
    expect(s.list(all)[0]).toMatchObject({ flown: 10, next: null });
    // Skip: counts as done without being flown; next moves past it.
    expect(s.setSkipped(id, 1, true)).toBe(true);
    expect(s.list(visited)[0]).toMatchObject({ skipped: [1], next: "Eol Prou AB-C d1-3" });
    expect(s.setSkipped(id, 42, true)).toBe(false);
    // Cut from -7: ends at -6; the flown -9 is now past the end and says so.
    expect(s.cutFrom(id, 7)).toBe(true);
    expect(s.list(visited)[0]).toMatchObject({ end: 6, lastSystem: "Eol Prou AB-C d1-6", flownBeyond: [9] });
    expect(s.cutFrom(id, 0)).toBe(false);
    expect(s.cutFrom(id, 7)).toBe(false);
    // A skip beyond a cut goes with it.
    s.setSkipped(id, 5, true);
    s.cutFrom(id, 5);
    expect(s.list(visited)[0]).toMatchObject({ end: 4, skipped: [1] });
    // Back to -9 for the rest.
    s.add("Eol Prou AB-C d1-9");
    s.setSkipped(id, 1, false);
    // Bodies and notable ones across its flown systems (addresses known), and which boxel he is in.
    const stats = (addr: number) => ({ bodies: { scanned: addr, total: addr === 2 ? null : addr + 1 }, notable: 1 });
    const withAddr: [number, string][] = [
      [1, "Eol Prou AB-C d1-0"],
      [3, "Eol Prou AB-C d1-4"],
    ];
    expect(s.list(withAddr, stats, "Eol Prou AB-C d1-4")[0]).toMatchObject({
      bodiesScanned: 4,
      bodiesTotal: 6,
      notable: 2,
      current: true,
    });
    expect(s.list([...withAddr, [2, "Eol Prou AB-C d1-5"]], stats, "Sol")[0]).toMatchObject({ bodiesTotal: null, current: false });
    // Survives a restart; deletes.
    const again = createSavedBoxels({ filePath: file });
    expect(again.list([])).toHaveLength(1);
    expect(JSON.parse(readFileSync(file, "utf8")).items[0].lastSystem).toBe("Eol Prou AB-C d1-9");
    expect(again.remove(id)).toBe(true);
    expect(again.remove(id)).toBe(false);
    expect(createSavedBoxels({ filePath: file }).list([])).toEqual([]);
  });
});

describe("the Boxels screen's table (owner, 2026-10-05)", () => {
  it("lists every system of every ticked boxel, grouped, with skips and visit times", async () => {
    const { boxelTable } = await import("../src/server/boxel.js");
    const boxel = (id: string, prefix: string, end: number, skipped: number[] = []) =>
      ({
        id,
        prefix,
        end,
        skipped,
        boxel: parseBoxel(`${prefix}0`)!.boxel,
        sector: parseBoxel(`${prefix}0`)!.sector,
      }) as never;
    const t = boxelTable({
      boxels: [boxel("a", "Eol Prou AB-C d1-", 2, [1]), boxel("b", "Bleethuia QV-L b", 1)],
      index: null,
      visited: [
        [11, "Eol Prou AB-C d1-0"],
        [12, "Bleethuia QV-L b1"],
        [13, "Sol"],
      ],
      speciesName: (id) => id,
      journal: () => ({
        mainStar: "K5 V",
        otherStars: ["M3 Va"],
        starClasses: ["K", "M"],
        bodies: { scanned: 3, total: 5 },
        notables: [{ kind: "helium", n: 1 }],
        bodyTypes: ["icy"],
        bio: { signals: 2, species: ["Bacterium Vesicula"] },
      }),
      visitedAt: (addr) => (addr === 11 ? "2026-10-05T10:00:00Z" : null),
    });
    expect(t.rows.map((r) => [r.boxelId, r.n, r.flown, r.skipped])).toEqual([
      ["a", 0, true, false],
      ["a", 1, false, true],
      ["a", 2, false, false],
      ["b", 0, false, false],
      ["b", 1, true, false],
    ]);
    expect(t.rows[0]).toMatchObject({
      boxel: "AB-C d1",
      from: "journal",
      visitedAt: "2026-10-05T10:00:00Z",
      mainStar: "K5 V",
      starClasses: ["K", "M"],
      bodies: { scanned: 3, total: 5 },
      notables: [{ kind: "helium", n: 1 }],
      bio: { signals: 2, seen: true, species: ["Bacterium Vesicula"] },
    });
    // Not flown and not in the index: nothing known yet (a look-up fills it).
    expect(t.rows[2]).toMatchObject({ from: null, mainStar: null, bodies: null, notables: [], bio: null });
    expect(t.noIndex).toBe(true);
  });
});
