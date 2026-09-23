import { describe, expect, it } from "vitest";
import { parseSpanshNameHits, spanshDumpToExplorationRecords } from "../src/server/spanshSystemHydration.js";
import { mapEdsmBodyToExplorationRecord } from "../src/server/edsmSystemHydration.js";
import { planetScanFromExplorationRecord } from "../src/server/footScannedCatalog.js";
import { gasSharePercent } from "../src/shared/atmosphereGasShare.js";
import { spectralKeysFromJournalStarType } from "../src/shared/starSpectralKeys.js";
import { hostStarClassKey } from "../src/shared/hostStarClass.js";

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
          {
            type: "Star",
            name: "Sol",
            bodyId: 0,
            subType: "G (White-Yellow) Star",
            spectralClass: "G2",
            luminosity: "V",
            solarMasses: 1,
          },
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
    expect(earth.planetClass).toBe("Earthlike body");
    expect(earth.atmosphereType).toBe("Suitable for water-based life");
    expect(earth.landable).toBe(false);
    expect(earth.distanceFromArrivalLs).toBeCloseTo(500.89);
    expect(earth.edsmHydrated).toBe(true);
    // Journal vocabulary: the class and the subclass apart, as a `Scan` writes them.
    expect(r.records[0]!.starType).toBe("G");
    expect(r.records[0]!.subclass).toBe(2);
  });

  it("says so when Spansh has no bodies yet", () => {
    const r = spanshDumpToExplorationRecords({ system: { name: "X", bodies: [] } }, 1, "X");
    expect(r).toEqual({ ok: false, error: "Spansh has no bodies for this system yet." });
  });

  it("splits every spectral class into the journal's type and subclass", () => {
    const star = (spectralClass: string) =>
      mapEdsmBodyToExplorationRecord({ type: "Star", name: "S", bodyId: 0, spectralClass }, 1, "S")!;
    expect([star("K2").starType, star("K2").subclass]).toEqual(["K", 2]);
    expect([star("DAB5").starType, star("DAB5").subclass]).toEqual(["DAB", 5]);
    expect([star("TTS5").starType, star("M_RedGiant8").starType, star("N0").starType]).toEqual([
      "TTS",
      "M_RedGiant",
      "N",
    ]);
    // What the split is for: the colour tables and the colour-null gate key on the class.
    expect(spectralKeysFromJournalStarType(star("Y2").starType!)).toEqual(["Y"]);
  });

  it("keeps a hydrated body's atmosphere composition, which the gas-share bands read", () => {
    const rec = mapEdsmBodyToExplorationRecord(
      {
        type: "Planet",
        name: "B 1",
        bodyId: 1,
        subType: "Rocky body",
        atmosphereType: "Thin Argon",
        atmosphereComposition: { Argon: 51.97, Nitrogen: 48.03 },
      },
      1,
      "B",
    )!;
    const scan = planetScanFromExplorationRecord(rec)!;
    expect(scan.atmosphereComposition).toHaveLength(2);
    expect(gasSharePercent(scan, "Argon")).toBeCloseTo(51.97);
    // Spansh spells gases with spaces; the journal does not. Both must land on one key.
    const co2 = mapEdsmBodyToExplorationRecord(
      { type: "Planet", name: "B 2", bodyId: 2, subType: "Rocky body", atmosphereComposition: { "Carbon dioxide": 99 } },
      1,
      "B",
    )!;
    expect(gasSharePercent(planetScanFromExplorationRecord(co2)!, "CarbonDioxide")).toBe(99);
  });

  it("writes planet classes the way the journal does, so the species gates can match them", () => {
    const cls = (subType: string) =>
      mapEdsmBodyToExplorationRecord({ type: "Planet", name: "P", bodyId: 1, subType }, 1, "S")!.planetClass;
    expect(cls("High metal content world")).toBe("High metal content body");
    expect(cls("Metal-rich body")).toBe("Metal rich body");
    expect(cls("Rocky Ice world")).toBe("Rocky ice body");
    expect(cls("Rocky body")).toBe("Rocky body");
  });

  it("names a star from its description when there is no spectral class", () => {
    const star = (subType: string) =>
      mapEdsmBodyToExplorationRecord({ type: "Star", name: "S", bodyId: 0, subType }, 1, "S")!.starType;
    // Taking the first word made these "White" and "Black": a Wolf-Rayet and a B star to the class key.
    expect(star("White Dwarf (DA) Star")).toBe("DA");
    expect(star("Black Hole")).toBe("H");
    expect(star("Neutron Star")).toBe("N");
    expect(star("T Tauri Star")).toBe("TTS");
    expect(star("Herbig Ae/Be Star")).toBe("AeBe");
    expect(star("B (Blue-White super giant) Star")).toBe("B");
    expect(hostStarClassKey(star("White Dwarf (DQ) Star"))).toBe("D");
    expect(hostStarClassKey(star("Black Hole"))).toBe("H");
  });
});
