/**
 * Star colours the ED-DSN tables leave blank, settled by the game's own variant tokens (EDDN codex
 * entries and the EDDN ScanOrganic test set, 2026-10-03).
 */
import { describe, expect, it } from "vitest";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import { candidateMorphColorLabelByLight } from "../src/shared/candidateSpawnHints.js";

const db = loadSpeciesDatabase();
const colour = (id: string, ...stars: string[]) => {
  const entry = db.species.find((e) => e.id === id);
  if (!entry) throw new Error(`no species ${id}`);
  return candidateMorphColorLabelByLight(entry, stars, undefined);
};

describe("round a neutron star the game uses the F colour", () => {
  it("Tussock: Yellow, 14 of 14 sightings (Clookia TZ-W d2-562 logged it on seven bodies)", () => {
    expect(colour("tussock_tussock_catena", "N")).toBe("Yellow");
    expect(colour("tussock_tussock_propagito", "N")).toBe("Yellow");
    // The neutron star outshines the Y dwarf there; the dwarf's own colour stays as it was.
    expect(colour("tussock_tussock_catena", "N", "Y")).toBe("Yellow");
    expect(colour("tussock_tussock_catena", "Y")).toBe("Red");
  });
  it("Stratum: Emerald, 2 of 2", () => {
    expect(colour("stratum_stratum_tectonicas", "N")).toBe("Emerald");
    expect(colour("stratum_stratum_tectonicas", "M")).toBe("Green");
  });
  it("a class nothing has settled stays unknown rather than assumed F", () => {
    expect(colour("tussock_tussock_catena", "A")).toBe("(unknown)");
  });
});

describe("Stratum araneamus has one colour", () => {
  it("is Emerald whatever star lights it", () => {
    for (const s of ["F", "A", "N", "Y", "T", "H"])
      expect(colour("stratum_stratum_araneamus", s), s).toBe("Emerald");
  });
});
