/**
 * Previous boxels (src/server/boxel.ts previousBoxels; owner, 2026-10-05): every boxel flown through,
 * notable ones first, within a time range, marked when already saved.
 */
import { describe, expect, it } from "vitest";
import { previousBoxels, type JournalSystemFacts } from "../src/server/boxel.js";

const facts = (extra: Partial<JournalSystemFacts> = {}): JournalSystemFacts => ({
  mainStar: "K5 V",
  otherStars: [],
  starClasses: ["K"],
  bodies: { scanned: 1, total: 1 },
  notables: [],
  bodyTypes: [],
  bio: { signals: 0, species: [] },
  ...extra,
});

describe("Previous boxels", () => {
  const visited: [number, string][] = [
    [1, "Eol Prou AB-C d1-0"],
    [2, "Eol Prou AB-C d1-7"],
    [3, "Bleethuia QV-L b3"],
    [4, "Sol"],
  ];
  const at: Record<number, string> = { 1: "2026-09-01T00:00:00Z", 2: "2026-10-04T00:00:00Z", 3: "2026-10-05T00:00:00Z" };
  const journal = (addr: number) =>
    addr === 1 ? facts({ notables: [{ kind: "helium", n: 1 }], starClasses: ["K", "N"] }) : facts();

  it("lists every boxel flown through, the notable one first, with what made it so", () => {
    const out = previousBoxels({
      visited,
      visitedAt: (a) => at[a] ?? null,
      journal,
      sinceIso: null,
      savedPrefixes: new Set(["bleethuia qv-l b"]),
    });
    expect(out.map((p) => p.boxel)).toEqual(["AB-C d1", "QV-L b"]);
    expect(out[0]).toMatchObject({
      flown: 2,
      highest: 7,
      lastSystem: "Eol Prou AB-C d1-7",
      lastVisit: "2026-10-04T00:00:00Z",
      notables: [{ kind: "helium", n: 1 }],
      rareStars: ["N"],
      saved: false,
    });
    expect(out[1]!.saved).toBe(true);
  });

  it("keeps to the time range by the last visit", () => {
    const out = previousBoxels({
      visited,
      visitedAt: (a) => at[a] ?? null,
      journal,
      sinceIso: "2026-10-05T00:00:00Z",
      savedPrefixes: new Set(),
    });
    expect(out.map((p) => p.boxel)).toEqual(["QV-L b"]);
  });
});
