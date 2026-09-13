import { describe, expect, it } from "vitest";
import { parseSpanshNameHits, spanshDumpToExplorationRecords } from "../src/server/spanshSystemHydration.js";

describe("Spansh as a galaxy source", () => {
  it("reads name completions with their id64 as the system address", () => {
    const hits = parseSpanshNameHits({
      min_max: [
        { id64: 1735468815882, name: "Traikee GL-Y c6", x: 1, y: 2, z: 3 },
        { id64: "nope", name: "Broken" },
        { id64: 911372064314, name: "Traikee GL-O c6-3" },
      ],
    });
    expect(hits).toEqual([
      { systemAddress: 1735468815882, starSystem: "Traikee GL-Y c6" },
      { systemAddress: 911372064314, starSystem: "Traikee GL-O c6-3" },
    ]);
    expect(parseSpanshNameHits(null)).toEqual([]);
  });

  it("maps a dump's bodies through the EDSM mapper and skips barycentres", () => {
    const dump = {
      system: {
        id64: 10477373803,
        name: "Sol",
        bodies: [
          { type: "Star", name: "Sol", bodyId: 0, subType: "G (White-Yellow) Star", spectralClass: "G2", luminosity: "V", solarMasses: 1 },
          { type: "Barycentre", name: "Sol A B", bodyId: 99 },
          {
            type: "Planet",
            name: "Earth",
            bodyId: 3,
            subType: "Earth-like world",
            atmosphereType: "Suitable for water-based life",
            gravity: 0.999,
            surfaceTemperature: 288,
            surfacePressure: 0.999,
            isLandable: false,
            volcanismType: "Rocky Magma",
            distanceToArrival: 500.89,
            parents: [{ Star: 0 }],
          },
        ],
      },
    };
    const r = spanshDumpToExplorationRecords(dump, 10477373803, "sol?");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.starSystem).toBe("Sol");
    expect(r.records.map((x) => x.bodyId)).toEqual([0, 3]);
    const earth = r.records[1]!;
    expect(earth.planetClass).toBe("Earth-like world");
    expect(earth.atmosphereType).toBe("Suitable for water-based life");
    expect(earth.landable).toBe(false);
    expect(earth.distanceFromArrivalLs).toBeCloseTo(500.89);
    expect(earth.edsmHydrated).toBe(true);
    expect(r.records[0]!.starType).toBe("G2");
  });

  it("says so when Spansh has no bodies yet", () => {
    const r = spanshDumpToExplorationRecords({ system: { name: "X", bodies: [] } }, 1, "X");
    expect(r).toEqual({ ok: false, error: "Spansh has no bodies for this system yet." });
  });
});
