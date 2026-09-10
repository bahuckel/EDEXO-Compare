/**
 * Which payout the commander is shown.
 *
 * The rule is the owner's: show both figures only while nobody knows, and the moment the journal
 * settles it, show only the number they will actually be paid. A ×5 column beside a body somebody
 * already walked is an invitation to misread, and the misreading costs a trip.
 */
import { describe, expect, it } from "vitest";
import {
  footfallCertainty,
  footfallValueNote,
  settledMultiplier,
  showsFootfallPrice,
  showsListPrice,
} from "../src/shared/footfallValue.js";

describe("reading the journal's answer", () => {
  it("calls a reported footfall walked", () => {
    expect(footfallCertainty({ journalWasFootfalled: true })).toBe("walked");
  });

  it("calls a reported absence unwalked", () => {
    expect(footfallCertainty({ journalWasFootfalled: false })).toBe("unwalked");
  });

  it("calls silence unknown, not opportunity", () => {
    // WasFootfalled did not exist before 2025-09-29, so absent is absent — never false.
    expect(footfallCertainty({ journalWasFootfalled: null })).toBe("unknown");
  });

  it("lets this commander's own claim settle it", () => {
    // Already flagged for the bonus here: a stale scan saying otherwise does not take it away.
    expect(
      footfallCertainty({ journalWasFootfalled: true, commanderFirstFootfall: true }),
    ).toBe("unwalked");
  });
});

describe("what gets drawn", () => {
  it("shows only the list price once somebody has landed", () => {
    const c = footfallCertainty({ journalWasFootfalled: true });
    expect(showsListPrice(c)).toBe(true);
    expect(showsFootfallPrice(c)).toBe(false);
    expect(settledMultiplier(c)).toBe(1);
  });

  it("shows only the bonus once we know nobody has", () => {
    const c = footfallCertainty({ journalWasFootfalled: false });
    expect(showsListPrice(c)).toBe(false);
    expect(showsFootfallPrice(c)).toBe(true);
    expect(settledMultiplier(c)).toBe(5);
  });

  it("shows both while it is genuinely open", () => {
    const c = footfallCertainty({ journalWasFootfalled: null });
    expect(showsListPrice(c)).toBe(true);
    expect(showsFootfallPrice(c)).toBe(true);
    // Null, not a guess: picking one here would be inventing an answer.
    expect(settledMultiplier(c)).toBeNull();
  });

  it("never hides both", () => {
    for (const f of [true, false, null] as const) {
      const c = footfallCertainty({ journalWasFootfalled: f });
      expect(showsListPrice(c) || showsFootfallPrice(c)).toBe(true);
    }
  });
});

describe("the note beside it", () => {
  it("says when the observation was made, because a false decays", () => {
    const note = footfallValueNote(footfallCertainty({ journalWasFootfalled: false }), "3 months ago");
    expect(note).toContain("3 months ago");
  });

  it("says footfall is permanent when somebody has been", () => {
    expect(footfallValueNote(footfallCertainty({ journalWasFootfalled: true }))).toMatch(/permanent/i);
  });
});
