import { describe, expect, it } from "vitest";
import {
  hostStarClassKey,
  hostStarClassSimilarity,
  hostStarHarvardIndex,
} from "../src/shared/hostStarClass.js";

/**
 * Two vocabularies for one star. The journal writes `Scan.StarType` (`F`, `DA`, `N`, `H`); EDSM, and
 * therefore every feeder profile, writes `F6`, `White Dwarf (DA) Star`, `Neutron Star`, `Black Hole`.
 * Nothing reconciled them, so the habitat scorer compared them as free text.
 */
describe("hostStarClassKey", () => {
  it("reads the journal's own spelling", () => {
    expect(hostStarClassKey("F")).toBe("F");
    expect(hostStarClassKey("DA")).toBe("D");
    expect(hostStarClassKey("N")).toBe("N");
    expect(hostStarClassKey("H")).toBe("H");
    expect(hostStarClassKey("TTS")).toBe("TTS");
  });

  it("reads EDSM's spelling of the same stars", () => {
    expect(hostStarClassKey("F6")).toBe("F");
    expect(hostStarClassKey("Y4")).toBe("Y");
    expect(hostStarClassKey("TTS7")).toBe("TTS");
    expect(hostStarClassKey("White Dwarf (DA) Star")).toBe("D");
    expect(hostStarClassKey("White Dwarf (DBZ) Star")).toBe("D");
    expect(hostStarClassKey("Neutron Star")).toBe("N");
    expect(hostStarClassKey("Black Hole")).toBe("H");
    expect(hostStarClassKey("Supermassive Black Hole")).toBe("H");
  });

  it("keeps an unrecognised star as a star rather than as nothing", () => {
    // "other" and null mean different things: one is a host we cannot name, the other is no host.
    expect(hostStarClassKey("C-J")).toBe("other");
    expect(hostStarClassKey("")).toBeNull();
    expect(hostStarClassKey(null)).toBeNull();
  });
});

describe("hostStarClassSimilarity", () => {
  it("matches a journal letter against an EDSM label for the same star", () => {
    expect(hostStarClassSimilarity("DA", "White Dwarf (DA) Star")).toBe(1);
    expect(hostStarClassSimilarity("F", "F6")).toBe(1);
    expect(hostStarClassSimilarity("N", "Neutron Star")).toBe(1);
  });

  it("gives neighbouring Harvard classes partial credit and distant ones none", () => {
    expect(hostStarClassSimilarity("F", "G5")).toBe(0.8);
    expect(hostStarClassSimilarity("F", "A2")).toBe(0.8);
    expect(hostStarClassSimilarity("F", "K1")).toBe(0.5);
    expect(hostStarClassSimilarity("O", "Y4")).toBe(0);
  });

  /**
   * The defect this replaces: the old path fell through to a substring test, so `"D"` scored 0.85
   * against `"White Dwarf (DA) Star"` for containing the letter d — and so did `"A"`.
   */
  it("gives a white dwarf nothing against a main-sequence star", () => {
    expect(hostStarClassSimilarity("A", "White Dwarf (DA) Star")).toBe(0);
    expect(hostStarClassSimilarity("K", "Neutron Star")).toBe(0);
    expect(hostStarClassSimilarity("M", "Black Hole")).toBe(0);
  });

  it("places the Harvard sequence and nothing else", () => {
    expect(hostStarHarvardIndex("O")).toBe(0);
    expect(hostStarHarvardIndex("Y")).toBe(9);
    expect(hostStarHarvardIndex("D")).toBeNull();
    expect(hostStarHarvardIndex("TTS")).toBeNull();
  });
});
