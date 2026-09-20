/**
 * Searching the carrier list.
 *
 * Five fields, because all five are on screen and a box that silently ignores four of them is worse
 * than no box. Coverage across the 90,077 unique carriers in the 2026-09-19 file:
 *
 * ```
 * name 88,372 (98.1 %)   system 90,069   region 90,077 (100 %)   DSSA commander 101
 * ```
 *
 * The two behaviours that would be wrong in a way nobody reports: terms ORing instead of ANDing, so
 * a second word widens the list rather than narrowing it, and a callsign that will not match unless
 * the hyphen is typed.
 */
import { describe, expect, it } from "vitest";
import { carrierMatchesQuery, parseCarrierQuery } from "../src/shared/carrierSearch.js";

const row = {
  callsign: "T9J-L2N",
  name: "CRV Haruspex",
  system: "Kuelua RY-R d4-0",
  region: "Norma Expanse",
  dssa: null,
};

const networkRow = {
  callsign: "TNY-4TL",
  name: "DSSA [FRHT] Epsilon 62",
  system: "Whaireau OC-M d7-3",
  region: "Trojan Belt",
  dssa: { commander: "Gleaner Chalmers" },
};

const find = (r: typeof row | typeof networkRow, q: string) => carrierMatchesQuery(r, parseCarrierQuery(q));

describe("parseCarrierQuery", () => {
  it("splits on whitespace and lowercases", () => {
    expect(parseCarrierQuery("  DSSA   Trojan ")).toEqual(["dssa", "trojan"]);
  });

  it("treats an empty box as no query", () => {
    expect(parseCarrierQuery("")).toEqual([]);
    expect(parseCarrierQuery("   ")).toEqual([]);
    expect(parseCarrierQuery(null)).toEqual([]);
  });
});

describe("what it searches", () => {
  it("finds a carrier by each of the five fields", () => {
    expect(find(row, "T9J-L2N")).toBe(true);
    expect(find(row, "haruspex")).toBe(true);
    expect(find(row, "Kuelua")).toBe(true);
    expect(find(row, "Norma")).toBe(true);
    expect(find(networkRow, "Gleaner")).toBe(true);
  });

  it("ignores case", () => {
    expect(find(row, "CRV HARUSPEX")).toBe(true);
    expect(find(row, "crv haruspex")).toBe(true);
  });

  it("matches everything when the box is empty", () => {
    expect(find(row, "")).toBe(true);
    expect(carrierMatchesQuery(row, [])).toBe(true);
  });

  it("says no when nothing matches", () => {
    expect(find(row, "colonia")).toBe(false);
  });
});

describe("terms are ANDed, and may land in different fields", () => {
  it("narrows on a second word", () => {
    /*
      THE ONE THAT MATTERS. With OR, typing a second word makes the list longer, which is the
      opposite of what typing more is for. "dssa trojan" has to mean a network carrier in the Trojan
      Belt -- one term in the name, one in the region -- and not everything matching either.
    */
    expect(find(networkRow, "dssa trojan")).toBe(true);
    expect(find(networkRow, "dssa colonia")).toBe(false);
    // The row matches "dssa" on its own, so an OR implementation would return true above.
    expect(find(networkRow, "dssa")).toBe(true);
  });

  it("requires every term, however many", () => {
    expect(find(networkRow, "dssa epsilon whaireau trojan gleaner")).toBe(true);
    expect(find(networkRow, "dssa epsilon whaireau trojan nobody")).toBe(false);
  });
});

describe("callsigns match with or without the hyphen", () => {
  it("finds T9J-L2N typed either way", () => {
    // A commander reading a callsign off a screen types it both ways, and 2,406 callsigns in the
    // file are not in the XXX-XXX shape at all, so neither side can assume the format.
    expect(find(row, "T9J-L2N")).toBe(true);
    expect(find(row, "t9jl2n")).toBe(true);
    expect(find(row, "T9JL")).toBe(true);
  });

  it("does not let the squashed form invent matches", () => {
    /*
      The guard on the hyphen-insensitive path. Without a floor on the term length, a one- or
      two-character query would match a large share of all callsigns and the list would look
      unfiltered; and a term that does not appear in the callsign at all must still fail.
    */
    expect(find(row, "zz")).toBe(false);
    expect(find(row, "xyz")).toBe(false);
  });

  it("still matches the other fields normally when the callsign does not", () => {
    expect(find(row, "kuelua")).toBe(true);
  });
});

describe("rows with missing fields", () => {
  it("searches what is there when the name is empty", () => {
    // 1,705 carriers have no name. They must still be findable by callsign, system and region.
    const unnamed = { ...row, name: "" };
    expect(find(unnamed, "T9J-L2N")).toBe(true);
    expect(find(unnamed, "Norma")).toBe(true);
    expect(find(unnamed, "haruspex")).toBe(false);
  });

  it("does not trip over a missing DSSA record", () => {
    expect(find({ ...row, dssa: null }, "gleaner")).toBe(false);
  });
});
