/**
 * The "info gather" mark: the species the app cannot fully answer for.
 *
 * Two different gaps wear one label, because to a commander deciding whether to land they are the
 * same question — *can you tell me what I would find here?*
 *
 *  - **thin data** — few corpus bodies and few of his own confirmations (`server/collectionFocus.ts`);
 *  - **the colour is not decided** — either no rule resolves, or two do and the honest answer is
 *    "Blue or Red", which is the grade-4 material precedence still waiting on observations.
 *
 * Beside it, `⌖N` says how many more of his own scans would clear the mark. The counting rule is the
 * owner's and is the part most likely to be "tidied" by someone later: **Analyse, Sample and Log all
 * count**. A species he logged once is one we can stop asking about — the mark exists to stop asking,
 * and making him finish a run he had decided to abandon would measure his patience, not the plant.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { infoGatherReasons, needsInfoGather } from "../src/shared/infoGather.js";

describe("what counts as a gap", () => {
  it("marks a species the corpus and the commander are both short of", () => {
    expect(infoGatherReasons({ collectionFocus: true, colourLabel: "Lime" })).toEqual(["thin-data"]);
  });

  it("marks a colour the rule cannot resolve here", () => {
    expect(infoGatherReasons({ colourLabel: "(unknown)" })).toEqual(["colour-unknown"]);
    expect(infoGatherReasons({ colourLabel: "" })).toEqual(["colour-unknown"]);
    expect(infoGatherReasons({ colourLabel: null })).toEqual(["colour-unknown"]);
  });

  it("marks a colour the evidence leaves undecided", () => {
    /*
      The reason this was asked for. Two colour-driving materials on one body and the rule genuinely
      does not decide; naming one would read exactly like a derivation. ~40 observations settle the
      precedence and these stop hedging for good.
    */
    expect(infoGatherReasons({ colourLabel: "Blue or Red" })).toEqual(["colour-ambiguous"]);
  });

  it("reports both gaps when both apply", () => {
    expect(infoGatherReasons({ collectionFocus: true, colourLabel: "Blue or Red" })).toEqual([
      "thin-data",
      "colour-ambiguous",
    ]);
  });

  it("leaves an ordinary prediction unmarked", () => {
    // A species with a known colour and a well-fed corpus needs nothing; marking it would make the
    // mark meaningless, which is the failure mode of every badge that appears on every row.
    expect(infoGatherReasons({ collectionFocus: false, colourLabel: "Lime" })).toEqual([]);
    expect(needsInfoGather({ colourLabel: "Emerald" })).toBe(false);
  });

  it("does not mistake a colour whose name contains 'or' for an ambiguous one", () => {
    // "Orange" and "Gold or..." are different sentences. The separator is " or ", with spaces.
    expect(infoGatherReasons({ colourLabel: "Orange" })).toEqual([]);
    expect(infoGatherReasons({ colourLabel: "Coral" })).toEqual([]);
  });
});

describe("how many more scans are wanted", () => {
  /** `computeCollectionFocus` reports `targetScans - ownScans`, floored at zero. */
  const remaining = (target: number, own: number) => Math.max(0, target - own);

  it("counts down to the configured target", () => {
    expect(remaining(3, 0)).toBe(3);
    expect(remaining(3, 2)).toBe(1);
    expect(remaining(3, 3)).toBe(0);
  });

  it("never goes negative when the commander has over-sampled", () => {
    expect(remaining(3, 7)).toBe(0);
  });

  it("follows a target the commander has changed", () => {
    // The threshold lives in an editable local file, which is why the number is computed server-side
    // rather than as `3 - ownScans` on the client.
    expect(remaining(5, 2)).toBe(3);
  });
});

describe("Analyse, Sample and Log all count", () => {
  const gameState = readFileSync(path.resolve(__dirname, "../src/server/gameState.ts"), "utf8");
  const focus = readFileSync(path.resolve(__dirname, "../src/server/collectionFocus.ts"), "utf8");

  it("treats all three scan types as a confirmation", () => {
    /*
      The owner's rule, stated twice: "it should detect LOG and SAMPLE, not just Analyse... even if I
      LOG it once, it should count." Only `Analyse` and `Sample` were recorded once, which silently
      lost every species he had logged.
    */
    expect(gameState).toMatch(
      /scanType === "Analyse" \|\| scanType === "Sample" \|\| scanType === "Log"/,
    );
  });

  it("counts confirmations from the locks those scans create, one per body", () => {
    // Distinct bodies, not ScanOrganic lines: a sampling run fires three or four events for one
    // plant and counting those would retire a species after a single patch of ground.
    expect(focus).toContain("b.organicGenusLocks");
    expect(focus).toContain("new Set(collectResolvedOrganicLockSpeciesIds");
  });
});

describe("the wiring", () => {
  const rows = readFileSync(path.resolve(__dirname, "../src/client/SpeciesRows.tsx"), "utf8");

  it("uses the shared rule rather than a second copy of it", () => {
    expect(rows).toContain("infoGatherReasons({");
  });

  it("shows the count from the server, not one computed in the row", () => {
    /*
      Comments stripped before the negative half: the note in the row explains that the number is
      *not* `3 - ownScans`, and the first version of this test matched that explanation and failed.
      A check that a piece of code is absent has to look at code.
    */
    const code = rows.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(rows).toContain("m.collectionFocusNote?.remaining");
    expect(code).not.toMatch(/\d+\s*-\s*\w*[Oo]wnScans/);
  });

  it("hides the crosshair once nothing more is wanted", () => {
    expect(rows).toMatch(/gatherRemaining != null && gatherRemaining > 0/);
  });
});
