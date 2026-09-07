/**
 * No spawn rule may sit in the data doing nothing.
 *
 * `buildCriterionFromRecord` reads a long alias list and ignores the rest in silence, which is how
 * four real conditions came to be present in the species files and absent from the matcher:
 *
 *  - `parent_star` on Electricae pluma — never gated on its host star, so it stood on an M3 red
 *    dwarf 175 ly from a nebula until §7.12;
 *  - `parent_star` on Amphora and `parent_star_types` on Anemone — the same claim, now measured
 *    against edastro's 4.85 M-row codex file and gated;
 *  - `distance_from_star` on Clypeus speculumi — measured at **293 of 295 bodies ≥ 2,500 ls**
 *    (99.3 %), against 1.7 % of lacrimam and 2.5 % of margaritus, and read by nothing.
 *
 * An unenforced condition is worse than a missing one: the species looks like it *passed*. So this
 * test pins the inventory. A new key in the data fails here until somebody decides what it means.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  UNGATED_CONDITION_KEYS,
  isRecognisedConditionKey,
  unrecognisedConditionKeys,
} from "../src/server/conditionKeyAudit.js";
import { getSpeciesDataWarnings, loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface Row {
  id?: string;
  conditions?: Record<string, unknown>;
}

function speciesRows(): { file: string; row: Row }[] {
  const out: { file: string; row: Row }[] = [];
  for (const file of globSync("data/species/*/*_new.json", { cwd: root })) {
    const doc = JSON.parse(readFileSync(path.join(root, file), "utf8")) as { species?: Row[] };
    for (const row of doc.species ?? []) out.push({ file, row });
  }
  return out;
}

describe("every condition key in the shipped data is accounted for", () => {
  it("finds the species files at all", () => {
    expect(speciesRows().length).toBeGreaterThan(100);
  });

  it("leaves no condition key unrecognised", () => {
    const offenders: string[] = [];
    for (const { file, row } of speciesRows()) {
      const unknown = unrecognisedConditionKeys(row.conditions);
      if (unknown.length) offenders.push(`${row.id ?? file}: ${unknown.join(", ")}`);
    }
    expect(offenders, "a condition nothing reads is a species that looks like it passed").toEqual([]);
  });

  /**
   * The keys we knowingly do not enforce, pinned exactly. Adding one should be a decision, not the
   * side effect of a parser shrugging — and removing one should mean a gate was built.
   */
  it("pins the list of conditions we know about and deliberately do not enforce", () => {
    expect(Object.keys(UNGATED_CONDITION_KEYS).sort()).toEqual(["gravity_constraints"]);
    for (const [key, reason] of Object.entries(UNGATED_CONDITION_KEYS)) {
      expect(reason.length, key).toBeGreaterThan(40);
    }
  });

  it("does not wave through a key nobody declared", () => {
    expect(isRecognisedConditionKey("max_gravity")).toBe(true);
    expect(isRecognisedConditionKey("distance_from_star")).toBe(true);
    expect(isRecognisedConditionKey("needs_a_wizard")).toBe(false);
    expect(unrecognisedConditionKeys({ max_gravity: 0.27, needs_a_wizard: true })).toEqual([
      "needs_a_wizard",
    ]);
  });

  it("shrugs at a missing or malformed conditions block rather than throwing", () => {
    expect(unrecognisedConditionKeys(undefined)).toEqual([]);
    expect(unrecognisedConditionKeys(null)).toEqual([]);
    expect(unrecognisedConditionKeys([1, 2, 3])).toEqual([]);
  });
});

describe("the condition that was being dropped", () => {
  /**
   * Clypeus speculumi's `distance_from_star: { min_ls: 2500, approx_AU: 5 }` now reaches the
   * matcher as an orbit range. Its siblings must not pick it up — they are the control that makes
   * the number mean something.
   */
  it("reads speculumi's 2,500 ls rule and gives it to no other Clypeus", () => {
    const db = loadSpeciesDatabaseFromTree(root);
    const spec = db.species.find((e) => e.id === "clypeus_clypeus_speculumi")!;
    expect(spec.criteria.orbitDistanceFromParentStarLs?.min).toBe(2500);

    for (const id of ["clypeus_clypeus_lacrimam", "clypeus_clypeus_margaritus"]) {
      const e = db.species.find((x) => x.id === id)!;
      expect(e.criteria.orbitDistanceFromParentStarLs?.min, id).toBeUndefined();
    }
  });
});

describe("a warning nobody can read is not a warning", () => {
  /**
   * The unknown-key report was a `console.warn`, and a packaged Electron build has no console — the
   * owner went looking for it in the app folder and in `%APPDATA%` and found nothing, which is the
   * correct outcome of writing to a stream that does not exist. It is collected and served on
   * `/api/status` instead.
   */
  it("collects nothing for the shipped tree", () => {
    loadSpeciesDatabaseFromTree(root);
    expect(getSpeciesDataWarnings()).toEqual([]);
  });

  it("replaces the list on reload rather than accumulating", () => {
    loadSpeciesDatabaseFromTree(root);
    const first = getSpeciesDataWarnings().length;
    loadSpeciesDatabaseFromTree(root);
    expect(getSpeciesDataWarnings()).toHaveLength(first);
  });
});
