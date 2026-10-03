/**
 * Starlight on a body and the species gate on it (owner, 2026-09-27: "every species gets a range of
 * luminosity where it thrives").
 */
import { describe, expect, it } from "vitest";
import { stellarIrradianceFor } from "../src/server/speciesMatchContext.js";
import { weighOutsideStarlight } from "../src/server/matchSpecies.js";
import { starlightOutsideFactor, starlightRangeFor } from "../src/server/starlightRanges.js";
import { buildEncyclopediaSpawnConditionCards } from "../src/shared/speciesSpawnConditionCards.js";
import type { ExplorationScanRecord, SpeciesEntry, SpeciesMatch } from "../src/shared/types.js";

const AU_M = 149_597_870_700;
const rec = (bodyId: number, parents: unknown[], extra: Partial<ExplorationScanRecord> = {}) =>
  ({
    systemAddress: 1,
    bodyId,
    bodyName: `Test ${bodyId}`,
    starSystem: "Test",
    updatedAt: "2026-09-27T00:00:00Z",
    parents,
    ...extra,
  }) as ExplorationScanRecord;
const system = (...r: ExplorationScanRecord[]) => new Map(r.map((x) => [x.bodyId, x]));

describe("stellarIrradianceFor", () => {
  it("reads 1 for a Sun at 1 AU", () => {
    const byId = system(
      rec(0, [], { starType: "G", radius: 695_700_000, surfaceTemperature: 5772, absoluteMagnitude: 4.83, distanceFromArrivalLs: 0 }),
      rec(1, [{ Star: 0 }], { planetClass: "Rocky body", semiMajorAxis: AU_M, distanceFromArrivalLs: 499 }),
    );
    expect(stellarIrradianceFor(byId.get(1)!, byId, "magnitude")).toBeCloseTo(1, 2);
  });

  it("the magnitude reading does not take a hot star's radius x temperature (HIP 49706)", () => {
    // B star: 5.72 R☉ at 32,960 K reads 34,800 suns from its size, 10.8 from its magnitude; its
    // moons 19 AU out sit at 170 K, which only the magnitude explains.
    const byId = system(
      rec(1, [], { starType: "B", radius: 5.72 * 695_700_000, surfaceTemperature: 32_960, absoluteMagnitude: 2.254, distanceFromArrivalLs: 0 }),
      rec(44, [{ Star: 1 }], { planetClass: "Rocky body", semiMajorAxis: 19 * AU_M, distanceFromArrivalLs: 9422 }),
    );
    const mag = stellarIrradianceFor(byId.get(44)!, byId, "magnitude")!;
    const size = stellarIrradianceFor(byId.get(44)!, byId, "size")!;
    expect(mag).toBeGreaterThan(0.02);
    expect(mag).toBeLessThan(0.04);
    expect(size / mag).toBeGreaterThan(1000);
  });

  it("abstains when the star the body orbits was never scanned", () => {
    const byId = system(
      rec(0, [], { starType: "G", radius: 695_700_000, surfaceTemperature: 5772, distanceFromArrivalLs: 0 }),
      rec(5, [{ Star: 3 }], { planetClass: "Rocky body", semiMajorAxis: AU_M, distanceFromArrivalLs: 4000 }),
    );
    expect(stellarIrradianceFor(byId.get(5)!, byId)).toBeUndefined();
  });
});

describe("weighOutsideStarlight", () => {
  type Row = Omit<SpeciesMatch, "photoUrl" | "photoNote" | "priceCredits">;
  const row = (id: string): Row => ({ entry: { id, displayName: id } as SpeciesEntry, reasons: [] });

  // No misses first (2026-10-03): outside the range a gated species stays, at a lower chance.
  it("weighs a gated species down outside its range, keeps it, and leaves the rest alone", () => {
    const volu = starlightRangeFor("bacterium_bacterium_volu");
    expect(volu?.gate).toBe(true);
    const strict = [row("bacterium_bacterium_volu"), row("tussock_tussock_cultro")];
    const unlikely: Row[] = [];
    weighOutsideStarlight(strict, unlikely, { stellarIrradiance: volu!.hi * 10 });
    expect(strict.map((m) => m.entry.id)).toEqual(["bacterium_bacterium_volu", "tussock_tussock_cultro"]);
    expect(unlikely).toHaveLength(0);
    // Volu: 4.6 % of its own bodies outside, 10.4 % of its siblings' — 0.44.
    expect(strict[0]!.presenceFactor).toBeCloseTo(starlightOutsideFactor(volu!), 5);
    expect(strict[0]!.presenceFactor).toBeCloseTo(0.0462 / 0.1043, 2);
    expect(strict[0]!.reasons.at(-1)?.field).toBe("Starlight");
    expect(strict[1]!.presenceFactor).toBeUndefined();
  });

  it("keeps Stratum araneamus under 0.025x Earth's light (Eol Prou QX-S d4-3465 6, EDDN set)", () => {
    const strict = [row("stratum_stratum_araneamus")];
    weighOutsideStarlight(strict, [], { stellarIrradiance: 0.025 });
    expect(strict).toHaveLength(1);
    expect(strict[0]!.presenceFactor).toBeGreaterThan(0.3);
  });

  it("keeps it inside the range, and says nothing when the light is unknown", () => {
    const volu = starlightRangeFor("bacterium_bacterium_volu")!;
    for (const ctx of [{ stellarIrradiance: Math.sqrt(volu.lo * volu.hi) }, {}]) {
      const strict = [row("bacterium_bacterium_volu")];
      const unlikely: Row[] = [];
      weighOutsideStarlight(strict, unlikely, ctx);
      expect(strict).toHaveLength(1);
      expect(unlikely).toHaveLength(0);
    }
  });
});

describe("Encyclopedia starlight card", () => {
  const entry = (gate: boolean) =>
    ({
      id: "x",
      displayName: "X",
      genus: "X",
      genusDataDir: "x",
      criteria: { planetClassAnyOf: ["Rocky body"] },
      starlight: { gate, lo: 0.03, hi: 4.8, n: 7493 },
    }) as unknown as SpeciesEntry;
  const card = (gate: boolean, light?: number) =>
    buildEncyclopediaSpawnConditionCards({
      entry: entry(gate),
      scan: null,
      estimatedSurfaceTempK: null,
      speciesMatchContext: light === undefined ? null : { stellarIrradiance: light },
    }).find((c) => c.id === "starlight")!;

  it("states the range and judges the body", () => {
    expect(card(true, 1).lines[0]).toBe("0.03–4.8× Earth's (99 % of 7,493 sightings)");
    expect(card(true, 1).tier).toBe("blue");
    expect(card(true, 20).tier).toBe("yellow");
    expect(card(true, 20).caption).toContain("brighter than seen");
    // Not gated: shown for reference, never flagged.
    expect(card(false, 20).tier).toBe("neutral");
    expect(card(true).caption).toBe("Stars not measured yet");
  });
});
