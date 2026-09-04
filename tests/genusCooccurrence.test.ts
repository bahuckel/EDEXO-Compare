import { describe, expect, it } from "vitest";
import {
  genusLikelihoods,
  pairLift,
  PAIR_TERM_MIN_KNOWN,
  type GenusCooccurrenceTable,
} from "../src/shared/genusCooccurrence.js";
import { tableFromGenusSets } from "../src/feeder/cooccurrence.js";

/**
 * A corpus where the split is the whole story: `ice` never shares a body with `rock` or `moss`, and
 * `common` turns up nearly everywhere. That is the shape the real table has — Fonticulua against the
 * rocky genera, with Bacterium on 82 % of bodies.
 */
function corpus(): GenusCooccurrenceTable {
  const sets: string[][] = [];
  for (let i = 0; i < 400; i++) sets.push(["common", "rock", "moss"]);
  for (let i = 0; i < 300; i++) sets.push(["common", "ice"]);
  for (let i = 0; i < 200; i++) sets.push(["common", "rock"]);
  for (let i = 0; i < 100; i++) sets.push(["moss"]);
  return tableFromGenusSets(sets);
}

describe("tableFromGenusSets", () => {
  const t = corpus();

  it("counts bodies, genera and pairs from the genus sets", () => {
    expect(t.bodies).toBe(1000);
    expect(t.genera.common!.bodies).toBe(900);
    expect(t.genera.ice!.bodies).toBe(300);
    expect(t.pairs["moss|rock"]).toBe(400);
    expect(t.setSizes["3"]).toBe(400);
  });

  it("records nothing for a pair that never shared a body", () => {
    expect(t.pairs["ice|rock"]).toBeUndefined();
    expect(t.pairs["ice|moss"]).toBeUndefined();
  });

  it("counts a genus once per body however many species were seen", () => {
    const dup = tableFromGenusSets([["a", "a", "b"]]);
    expect(dup.bodies).toBe(1);
    expect(dup.genera.a!.bodies).toBe(1);
    expect(dup.pairs["a|b"]).toBe(1);
  });
});

describe("pairLift", () => {
  const t = corpus();

  it("is below 1 for genera that avoid each other and above 1 for genera that travel together", () => {
    expect(pairLift(t, "ice", "rock")).toBeLessThan(1);
    expect(pairLift(t, "moss", "rock")).toBeGreaterThan(1);
  });

  /**
   * The rule the whole model rests on (§6): a pair the corpus has never recorded is unlikely, never
   * impossible. 10,000 bodies is not the galaxy.
   */
  it("never reaches zero for a pair never observed", () => {
    expect(pairLift(t, "ice", "rock")).toBeGreaterThan(0);
    const unknown = pairLift(t, "ice", "nothing-we-have-ever-seen");
    expect(unknown).toBe(1);
  });
});

describe("genusLikelihoods", () => {
  const t = corpus();

  it("distributes exactly the signal count across the candidates", () => {
    const r = genusLikelihoods(t, ["common", "rock", "moss", "ice"], 2)!;
    const total = r.likelihoods.reduce((s, l) => s + l.probability, 0);
    expect(total).toBeCloseTo(2, 6);
    expect(r.subsets).toBe(6);
  });

  it("ranks the genus the corpus sees most often first", () => {
    const r = genusLikelihoods(t, ["common", "ice", "moss"], 1)!;
    expect(r.likelihoods[0]!.genus).toBe("common");
    expect(r.likelihoods[0]!.probability).toBeGreaterThan(r.likelihoods[1]!.probability);
  });

  it("gives a confirmed genus probability 1 and ranks the rest around it", () => {
    const r = genusLikelihoods(t, ["common", "rock", "moss", "ice"], 2, ["ice"])!;
    const byGenus = new Map(r.likelihoods.map((l) => [l.genus, l.probability]));
    expect(byGenus.get("ice")).toBeCloseTo(1, 6);
    expect(r.known).toEqual(["ice"]);
    expect([...byGenus.values()].reduce((s, x) => s + x, 0)).toBeCloseTo(2, 6);
  });

  /**
   * Rarity is not unreliability (§15.2). A genus the corpus has never recorded is ranked on the
   * median prevalence rather than pushed to the bottom, and it says so.
   */
  it("does not punish a genus the corpus has never recorded", () => {
    const r = genusLikelihoods(t, ["ice", "brand-new"], 1)!;
    const row = r.likelihoods.find((l) => l.genus === "brand-new")!;
    expect(row.unmeasured).toBe(true);
    expect(row.probability).toBeGreaterThan(0.1);
  });

  /**
   * The measured gate. Below {@link PAIR_TERM_MIN_KNOWN} known genera the pair term is off, so the
   * answer is prevalence alone — measured over 37,176 held-out cases, switching it on earlier makes
   * the ranking worse.
   */
  it("leaves the pair term switched off until enough of the body is known", () => {
    const cands = ["common", "rock", "moss", "ice"];
    const withOne = genusLikelihoods(t, cands, 2, ["ice"])!;
    const forcedOff = genusLikelihoods(t, cands, 2, ["ice"], { usePairs: false })!;
    expect(withOne.likelihoods).toEqual(forcedOff.likelihoods);

    // Forced on, the pair term moves the answer — so the equality above is the gate, not a no-op.
    const forcedOn = genusLikelihoods(t, cands, 2, ["ice"], { usePairs: true })!;
    const off = new Map(forcedOff.likelihoods.map((l) => [l.genus, l.probability]));
    const on = new Map(forcedOn.likelihoods.map((l) => [l.genus, l.probability]));
    expect(on.get("rock")).toBeLessThan(off.get("rock")!);
    expect(PAIR_TERM_MIN_KNOWN).toBeGreaterThan(1);
  });

  it("returns null when there is nothing to solve", () => {
    expect(genusLikelihoods(t, [], 2)).toBeNull();
    expect(genusLikelihoods(t, ["common"], 0)).toBeNull();
    // Fewer candidates than signals is the under-covered case: a data defect, not a ranking problem.
    expect(genusLikelihoods(t, ["common"], 3)).toBeNull();
  });

  it("ignores a known genus that is not among the candidates", () => {
    const r = genusLikelihoods(t, ["common", "ice"], 1, ["moss"])!;
    expect(r.known).toEqual([]);
  });
});
