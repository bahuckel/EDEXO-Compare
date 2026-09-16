/**
 * A species the commander has sampled here belongs in the list, banner and all.
 *
 * The owner, looking at Bacterium omentum on `Synookooe WW-F b55-0 A 2 a`: *"keep the [unlikely]
 * banner after the name. But do not continue to hide it in the unlikely list if the user scans it,
 * it should go into candidate species with the [unlikely] banner."*
 *
 * The two facts are not in competition. "Unlikely" is the app's opinion about a body it has never
 * stood on; a sample is his own boots. Omentum is the case that produced the request — its codex row
 * lists Neon, that body is Thin Methane, and the corpus has watched it grow under Methane once in 22
 * observed bodies. Rare, real, and not something to hide once he has proved it.
 *
 * So the demotion is **kept and still shown**: `unlikely` stays true and `unlikelyReasons` stays, so
 * the card keeps its banner and says which gate failed. Only where the row is filed changes — which
 * is the half the panel got wrong.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SpeciesMatch } from "../src/shared/types.js";

/** The split `BodyPane` applies, transcribed — the component cannot be imported in a node test. */
function split(matches: Pick<SpeciesMatch, "unlikely" | "sampledHere">[]) {
  return {
    candidates: matches.filter((m) => !m.unlikely || m.sampledHere === true),
    behindTheFold: matches.filter((m) => m.unlikely && m.sampledHere !== true),
  };
}

const row = (o: Partial<SpeciesMatch>) => o as Pick<SpeciesMatch, "unlikely" | "sampledHere">;

describe("where a demoted row is filed", () => {
  it("lists a demoted species the commander sampled here", () => {
    const { candidates, behindTheFold } = split([row({ unlikely: true, sampledHere: true })]);
    expect(candidates).toHaveLength(1);
    expect(behindTheFold).toHaveLength(0);
  });

  it("keeps the demotion itself, so the banner and its reasons survive", () => {
    /*
      The point of the request was "with the [unlikely] banner". The card renders that from
      `m.unlikely`, so moving the row must not clear the flag — if it did, the reason it was demoted
      would vanish, and on omentum that reason is the interesting part.
    */
    const m = row({ unlikely: true, sampledHere: true });
    const { candidates } = split([m]);
    expect(candidates[0]!.unlikely).toBe(true);
  });

  it("leaves a demoted species he has not sampled behind the fold", () => {
    const { candidates, behindTheFold } = split([row({ unlikely: true })]);
    expect(candidates).toHaveLength(0);
    expect(behindTheFold).toHaveLength(1);
  });

  it("does not disturb an ordinary candidate", () => {
    const { candidates, behindTheFold } = split([row({}), row({ unlikely: false })]);
    expect(candidates).toHaveLength(2);
    expect(behindTheFold).toHaveLength(0);
  });

  it("files every row exactly once", () => {
    // The two lists are rendered one after the other; an overlap would show a species twice.
    const all = [
      row({}),
      row({ unlikely: true }),
      row({ unlikely: true, sampledHere: true }),
      row({ sampledHere: true }),
    ];
    const { candidates, behindTheFold } = split(all);
    expect(candidates.length + behindTheFold.length).toBe(all.length);
    for (const m of all) {
      expect(candidates.includes(m) !== behindTheFold.includes(m)).toBe(true);
    }
  });

  it("is wired into the snapshot after every demotion pass", () => {
    /*
      A flag nobody sets is a rule that does not hold, and the order matters: it has to run after
      `demoteBelowPresenceFloor`, or the floor would demote the row again straight afterwards.
    */
    const src = readFileSync(path.resolve(__dirname, "../src/server/snapshot.ts"), "utf8");
    const floor = src.indexOf("demoteBelowPresenceFloor(matches, b, db);");
    const mark = src.indexOf("markSampledDespiteUnlikely(matches, b, db);");
    expect(floor).toBeGreaterThan(-1);
    expect(mark).toBeGreaterThan(floor);
  });

  it("travels over the websocket, or the rows view would never see it", () => {
    // The snapshot goes to the client through `wsChannels`; a field left out there is a field the
    // panel silently never receives.
    const ws = readFileSync(path.resolve(__dirname, "../src/server/wsChannels.ts"), "utf8");
    expect(ws).toContain("sampledHere");
  });
});
