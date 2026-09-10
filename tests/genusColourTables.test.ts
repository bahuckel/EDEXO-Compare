/**
 * A genus whose colour table names star classes must be read as a star table.
 *
 * Reported from Blu Thua ML-P b47-2 A 3: Fonticulua campestris came out "(unknown)" and the foot
 * scan said Amethyst — which is exactly what the shipped table maps the body's M-class parent to.
 * One entry in that table, `Ae/Be`, is not a single letter and not `TTS`, so the loader counted it
 * as a material name and switched the whole genus over to the material rule, which Fonticulua does
 * not have. Tussock's `Black Hole` entry did the same thing.
 */
import { describe, expect, it } from "vitest";
import {
  isStellarSpectralMappingKey,
  normalizeStellarMappingKey,
  spectralKeysFromJournalStarType,
} from "../src/shared/starSpectralKeys.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import { candidateMorphColorShortLabel } from "../src/shared/candidateSpawnHints.js";
import type { SpeciesEntry } from "../src/shared/types.js";

describe("multi-character spectral keys", () => {
  it("reads Ae/Be and Black Hole as star classes, not materials", () => {
    expect(isStellarSpectralMappingKey("Ae/Be")).toBe(true);
    expect(isStellarSpectralMappingKey("Black Hole")).toBe(true);
    expect(isStellarSpectralMappingKey("Yttrium")).toBe(false);
  });

  it("normalises them away from the letter they start with", () => {
    // "Ae/Be" collapsing to "A" would put Herbig colours on every A-class star.
    expect(normalizeStellarMappingKey("Ae/Be")).toBe("AEBE");
    expect(normalizeStellarMappingKey("Black Hole")).toBe("H");
    expect(normalizeStellarMappingKey("M")).toBe("M");
    expect(normalizeStellarMappingKey("TTS")).toBe("TTS");
  });

  it("maps the journal's own spelling of a Herbig star", () => {
    // 2 of the 4,635 star scans in the owner's logs are `AeBe`, and they named no class at all.
    expect(spectralKeysFromJournalStarType("AeBe")).toContain("AEBE");
    expect(spectralKeysFromJournalStarType("H")).toEqual(["H"]);
    expect(spectralKeysFromJournalStarType("M")).toEqual(["M"]);
  });
});

describe("shipped genus colour tables", () => {
  const db = loadSpeciesDatabase();
  const entries = (db as unknown as { species: SpeciesEntry[] }).species;
  const find = (name: string): SpeciesEntry => {
    const e = entries.find((x) => x.displayName.toLowerCase() === name.toLowerCase());
    if (!e) throw new Error(`no species entry for ${name}`);
    return e;
  };

  it("does not mark a star-table genus material-driven", () => {
    for (const name of ["Fonticulua Campestris", "Tussock Propagito"]) {
      const e = find(name) as SpeciesEntry & { genusColorMaterialDriven?: boolean };
      expect(e.genusColorMaterialDriven).not.toBe(true);
    }
  });

  it("names the colour the commander actually found on Blu Thua ML-P b47-2 A 3", () => {
    // M-class parent (body A, `Scan` AutoScan, StarType M) → Amethyst, confirmed by the foot scan.
    expect(candidateMorphColorShortLabel(find("Fonticulua Campestris"), "M", null)).toBe("Amethyst");
  });

  it("still reads Bacterium off the body's materials", () => {
    // Vesicula's own `color_rules` map yttrium to Lime and tellurium to Red; the star says nothing.
    const v = find("Bacterium Vesicula");
    expect(candidateMorphColorShortLabel(v, "M", [{ Name: "yttrium" }])).toBe("Lime");
    expect(candidateMorphColorShortLabel(v, "M", [{ Name: "tellurium" }])).toBe("Red");
  });
});
