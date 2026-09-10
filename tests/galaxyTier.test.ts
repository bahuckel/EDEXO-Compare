/**
 * What the map says about a place.
 *
 * The rule the owner asked for, and the one an obvious implementation gets backwards: a sector with
 * a thousand plants where he has scanned one must not say "you scanned it all". Show what is left,
 * not what is best known.
 */
import { describe, expect, it } from "vitest";
import {
  TIER_ORDER,
  TIER_STYLE,
  mostActionable,
  tierFor,
  tierRank,
  type TierFacts,
} from "../src/shared/galaxyTier.js";

const facts = (over: Partial<TierFacts> = {}): TierFacts => ({
  visited: false,
  scannedByYou: 0,
  unscannedByYou: 0,
  confirmedElsewhere: false,
  genusKnown: false,
  signals: false,
  ...over,
});

describe("the thousand-plant sector", () => {
  it("does not claim you are finished when one body is outstanding", () => {
    // The exact case: masses of work done, one thing left. The one thing wins.
    expect(
      tierFor(facts({ visited: true, scannedByYou: 999, unscannedByYou: 1, confirmedElsewhere: true })),
    ).toBe("missed");
  });

  it("only says you scanned it all when nothing is outstanding", () => {
    expect(tierFor(facts({ visited: true, scannedByYou: 1000, unscannedByYou: 0 }))).toBe("done");
  });

  it("still points at other people's finds once yours are done", () => {
    // Finished your own work here, but somebody else logged a species you have not — that is a
    // reason to come back, so it must not read as done.
    expect(
      tierFor(facts({ visited: true, scannedByYou: 5, unscannedByYou: 0, confirmedElsewhere: true })),
    ).toBe("confirmed");
  });
});

describe("walking down the ladder", () => {
  it("prefers a confirmed species to a known genus", () => {
    expect(tierFor(facts({ confirmedElsewhere: true, genusKnown: true, signals: true }))).toBe("confirmed");
  });

  it("prefers a known genus to bare signals", () => {
    expect(tierFor(facts({ genusKnown: true, signals: true }))).toBe("genus");
  });

  it("falls to signals when nothing has been named", () => {
    expect(tierFor(facts({ signals: true }))).toBe("signals");
  });

  it("reports barren only when something says so", () => {
    expect(tierFor(facts({ knownBarren: true }))).toBe("barren");
    // Absence of signals is not evidence of barrenness — the export only carries systems with life.
    expect(tierFor(facts())).not.toBe("barren");
  });
});

describe("ranking", () => {
  it("puts what is actionable first and done last", () => {
    expect(TIER_ORDER[0]).toBe("missed");
    expect(TIER_ORDER[TIER_ORDER.length - 1]).toBe("done");
    expect(tierRank("missed")).toBeLessThan(tierRank("confirmed"));
    expect(tierRank("done")).toBeGreaterThan(tierRank("barren"));
  });

  it("draws a sector holding two states as the more actionable one", () => {
    expect(mostActionable("done", "missed")).toBe("missed");
    expect(mostActionable("signals", "confirmed")).toBe("confirmed");
    expect(mostActionable("genus", "genus")).toBe("genus");
  });
});

describe("the palette", () => {
  it("keeps hollow for one meaning only — your unfinished work", () => {
    // It used to mean three things at once, and the owner read a hollow green sector marker as his
    // own tier when it was the backdrop showing through.
    const hollow = TIER_ORDER.filter((t) => TIER_STYLE[t].fill === null);
    expect(hollow).toEqual(["missed"]);
  });

  it("uses one colour for your own work at both stages", () => {
    expect(TIER_STYLE.missed.stroke).toBe(TIER_STYLE.done.stroke);
  });

  it("gives every tier a label and an explanation", () => {
    for (const t of TIER_ORDER) {
      expect(TIER_STYLE[t].label.length).toBeGreaterThan(0);
      expect(TIER_STYLE[t].help.length).toBeGreaterThan(10);
    }
  });
});
