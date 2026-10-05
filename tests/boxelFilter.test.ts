/**
 * The Boxels screen's filter (src/client/boxelFilter.ts; owner, 2026-10-05).
 */
import { describe, expect, it } from "vitest";
import { boxelRowFilter } from "../src/client/boxelFilter.js";
import type { BoxelTableRowDTO } from "../src/shared/boxel.js";

const row = (extra: Partial<BoxelTableRowDTO>): BoxelTableRowDTO => ({
  boxelId: "a",
  boxel: "AB-C d1",
  sector: "Eol Prou",
  n: 0,
  name: "Eol Prou AB-C d1-0",
  flown: true,
  skipped: false,
  visitedAt: null,
  systemAddress: null,
  from: "journal",
  mainStar: null,
  otherStars: [],
  starClasses: [],
  bodies: null,
  notables: [],
  bodyTypes: [],
  bio: null,
  ...extra,
});

describe("the Boxels filter", () => {
  it("Body type: a Helium gas giant matches, a Helium-rich one is never asked for", () => {
    const he = row({ bodyTypes: ["helium_gg"], notables: [{ kind: "helium", n: 1 }] });
    const plain = row({ bodyTypes: ["icy"] });
    expect(boxelRowFilter("body", "helium gas giant")(he)).toBe(true);
    expect(boxelRowFilter("body", "helium gas giant")(plain)).toBe(false);
    expect(boxelRowFilter("body", "helium rich gas giant")(he)).toBe(false);
    expect(boxelRowFilter("body", "ggg")(row({ notables: [{ kind: "green", n: 1 }] }))).toBe(true);
    expect(boxelRowFilter("body", "earth-like")(row({ bodyTypes: ["elw"] }))).toBe(true);
  });

  it("Star type: a class key exactly, a class name, or the star as scanned", () => {
    const r = row({ mainStar: "K5 V", otherStars: ["neutron star"], starClasses: ["K", "N"] });
    expect(boxelRowFilter("star", "K")(r)).toBe(true);
    expect(boxelRowFilter("star", "neutron")(r)).toBe(true);
    expect(boxelRowFilter("star", "M")(r)).toBe(false);
    expect(boxelRowFilter("star", "k5")(r)).toBe(true);
  });

  it("Exobio species and System name: plain substrings, an empty query lets all through", () => {
    const r = row({ bio: { signals: 2, seen: true, species: ["Stratum Tectonicas"] } });
    expect(boxelRowFilter("species", "stratum")(r)).toBe(true);
    expect(boxelRowFilter("species", "tussock")(r)).toBe(false);
    expect(boxelRowFilter("system", "d1-0")(r)).toBe(true);
    expect(boxelRowFilter("system", "  ")(r)).toBe(true);
  });
});
