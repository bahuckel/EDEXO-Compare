/**
 * A pasted body name finds its system (owner's test, 2026-09-26: "Flyai Flyuae XJ-A d5 A 2" showed
 * only the neighbouring systems).
 */
import { describe, expect, it } from "vitest";
import { bodyPartOfQuery, ownerFirst } from "../src/client/systemSearchMatch.js";

const SYS = "Flyai Flyuae XJ-A d5";

describe("system search", () => {
  it("reads the body part off a pasted body name", () => {
    expect(bodyPartOfQuery("Flyai Flyuae XJ-A d5 A 2", SYS)).toBe("A 2");
    expect(bodyPartOfQuery("  flyai flyuae xj-a d5 c 6 ", SYS)).toBe("c 6");
    expect(bodyPartOfQuery("Flyai Flyuae XJ-A d5", SYS)).toBe("");
  });

  it("does not take a neighbour for the owner", () => {
    // d5 is a prefix of d50: only a space after the name makes it the owner.
    expect(bodyPartOfQuery("Flyai Flyuae XJ-A d50 A 1", SYS)).toBeNull();
    expect(bodyPartOfQuery("Flyai Flyuae XJ-A d5 A 2", "Flyai Flyuae XJ-A d4")).toBeNull();
  });

  it("puts the owning system first", () => {
    const rows = [
      { starSystem: "Flyai Flyuae XJ-A d4" },
      { starSystem: SYS },
      { starSystem: "Flyai Flyuae XJ-A d7" },
    ];
    expect(ownerFirst(rows, "Flyai Flyuae XJ-A d5 A 2").map((r) => r.starSystem)).toEqual([
      SYS,
      "Flyai Flyuae XJ-A d4",
      "Flyai Flyuae XJ-A d7",
    ]);
  });
});
