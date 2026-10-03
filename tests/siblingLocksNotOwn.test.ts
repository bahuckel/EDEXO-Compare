/**
 * A sibling moon's species are a hint here, not a find (2026-10-03): Skaude EX-A d1-228 5 c and 5 d
 * carried 5 b's five species as "logged by you" and as the accuracy probe's truth.
 */
import { describe, expect, it } from "vitest";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import {
  collectOwnOrganicLockSpeciesIds,
  collectResolvedOrganicLockSpeciesIds,
} from "../src/server/organicLocks.js";
import type { OrganicGenusLock, SpeciesDatabase } from "../src/shared/types.js";

const db = loadSpeciesDatabase() as unknown as SpeciesDatabase;
const lock = (fromSibling: boolean): OrganicGenusLock => ({
  genusLocalised: "Aleoida",
  genusSymbol: "$Codex_Ent_Aleoids_Genus_Name;",
  speciesLocalised: "Aleoida Gravis",
  speciesSymbol: "$Codex_Ent_Aleoids_05_Name;",
  variantLocalised: "Aleoida Gravis - Teal",
  ...(fromSibling ? { fromSibling: true } : {}),
});

describe("a body's own finds", () => {
  it("leave out what was copied from a sibling moon", () => {
    expect(collectResolvedOrganicLockSpeciesIds([lock(true)], db)).toEqual(["aleoida_aleoida_gravis"]);
    expect(collectOwnOrganicLockSpeciesIds([lock(true)], db)).toEqual([]);
    expect(collectOwnOrganicLockSpeciesIds([lock(false)], db)).toEqual(["aleoida_aleoida_gravis"]);
  });
});
