/**
 * A genus colour table's "D": null / "W": null names every white dwarf / Wolf-Rayet, and the journal
 * names the subtype (code review A1, 2026-09-27: the rows never matched, so the gate never fired).
 */
import { describe, expect, it } from "vitest";
import { speciesMatchesCriteria } from "../src/server/matchSpecies.js";
import type { PlanetScan, SpeciesEntry } from "../src/shared/types.js";

const entry = {
  id: "t",
  displayName: "Test species",
  genus: "Test",
  genusDataDir: "test",
  criteria: { planetClassAnyOf: ["Rocky body"] },
  genusStarColorNullSpectralClasses: ["D", "W"],
} as unknown as SpeciesEntry;
const scan = { PlanetClass: "Rocky body", SurfaceTemperature: 200, Landable: true } as unknown as PlanetScan;
const starFailure = (host: string) =>
  (speciesMatchesCriteria(entry, scan, null, null, { parentStarType: host }).reasons ?? []).some(
    (r) => r.field === "StarType" && /no variant/.test(r.detail),
  );

describe("colour-null star families", () => {
  it("a white dwarf or Wolf-Rayet subtype hits its family's null", () => {
    for (const t of ["DA", "DAB", "DC", "DQ", "WC", "WN", "WNC", "WO"]) expect(starFailure(t), t).toBe(true);
  });
  it("other classes do not", () => {
    for (const t of ["K", "M", "TTS", "N", "H", "A"]) expect(starFailure(t), t).toBe(false);
  });
});
