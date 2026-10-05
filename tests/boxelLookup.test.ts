/**
 * Look up a boxel on Spansh (src/server/boxelLookup.ts; owner, 2026-10-05, plan Q1).
 */
import { describe, expect, it } from "vitest";
import { createBoxelLookups, spanshSearchSystemFacts } from "../src/server/boxelLookup.js";
import { boxelTable } from "../src/server/boxel.js";
import type { SavedBoxelDTO } from "../src/shared/boxel.js";

const isPlant = (g: string) => ["Bacterium", "Stratum"].includes(g);
const body = (name: string, type: string, subtype: string, extra: Record<string, unknown> = {}) => ({
  name,
  type,
  subtype,
  distance_to_arrival: type === "Star" && extra.is_main_star ? 0 : 100,
  ...extra,
});
const system = (n: number, bodies: unknown[]) => ({
  name: `Eol Prou AB-C d1-${n}`,
  body_count: bodies.length,
  bodies,
});

describe("a Spansh search result's facts", () => {
  it("reads stars, notables and species, a Helium-rich gas giant never as Helium", () => {
    const f = spanshSearchSystemFacts(
      system(3, [
        body("A", "Star", "K (Yellow-Orange) Star", { is_main_star: true }),
        body("B", "Star", "M (Red giant) Star"),
        body("1", "Planet", "Helium gas giant"),
        body("2", "Planet", "Helium-rich gas giant"),
        body("3", "Planet", "Earth-like world", { terraforming_state: "Candidate for terraforming" }),
        body("4", "Planet", "Rocky body", {
          terraforming_state: "Not terraformable",
          landmarks: [
            { type: "Bacterium", subtype: "Bacterium Aurasus" },
            { type: "Fumarole", subtype: "Silicate Vapour Fumarole" },
          ],
        }),
      ]),
      isPlant,
    )!;
    expect(f.mainStar).toBe("K");
    expect(f.otherStars).toEqual(["M giant"]);
    expect(f.starClasses).toEqual(["K", "M", "SG"]);
    expect(f.notables).toEqual([
      { kind: "earthlike", n: 1 },
      { kind: "helium", n: 1 },
    ]);
    expect(f.bodyTypes).toEqual(expect.arrayContaining(["helium_gg", "elw", "rocky", "terraformable"]));
    expect(f.species).toEqual(["Bacterium Aurasus"]);
    expect(f.bodyCount).toBe(6);
  });
});

describe("looking a boxel up", () => {
  it("pages until the boxel's systems end, then marks the rest not on Spansh", async () => {
    const pages = [
      {
        count: 10_000,
        results: [...Array.from({ length: 99 }, (_, i) => system(i * 2, [])), system(300, [])],
      },
      { count: 10_000, results: [system(5, []), { name: "Eol Prou AB-C d12-4", bodies: [] }] },
    ];
    const asked: number[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const page = (JSON.parse(String(init.body)) as { page: number }).page;
      asked.push(page);
      return new Response(JSON.stringify(pages[page]), { status: 200 });
    }) as unknown as typeof fetch;
    const l = createBoxelLookups({ filePath: null, isPlant, fetchImpl, gapMs: 0 });
    expect(l.start("Eol Prou AB-C d1-")).toBe(true);
    expect(l.start("Eol Prou AB-C d2-")).toBe(false);
    while (l.status()?.running) await new Promise((r) => setTimeout(r, 5));
    expect(asked).toEqual([0, 1]);
    const rec = l.get("eol prou ab-c d1-")!;
    expect(rec.complete).toBe(true);
    expect(Object.keys(rec.systems)).toHaveLength(101);

    const saved = {
      id: "a",
      prefix: "Eol Prou AB-C d1-",
      end: 6,
      skipped: [],
      boxel: "AB-C d1",
      sector: "Eol Prou",
    } as unknown as SavedBoxelDTO;
    const t = boxelTable({
      boxels: [saved],
      index: null,
      visited: [],
      speciesName: (i) => i,
      lookup: (p) => l.get(p),
    });
    expect(t.rows.map((r) => [r.n, r.from, !!r.notOnSpansh])).toEqual([
      [0, "lookup", false],
      [1, null, true],
      [2, "lookup", false],
      [3, null, true],
      [4, "lookup", false],
      [5, "lookup", false],
      [6, "lookup", false],
    ]);
    expect(t.lookups).toEqual([
      { boxelId: "a", fetchedAt: rec.fetchedAt, complete: true, systems: 101, highest: 300 },
    ]);
    // A look-up that found none of the boxel marks nothing: it cannot tell undiscovered from missed.
    const none = boxelTable({
      boxels: [saved],
      index: null,
      visited: [],
      speciesName: (i) => i,
      lookup: () => ({ prefix: saved.prefix, fetchedAt: rec.fetchedAt, complete: true, systems: {} }),
    });
    expect(none.rows.some((r) => r.notOnSpansh)).toBe(false);
  });
});
