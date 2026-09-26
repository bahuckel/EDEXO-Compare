/**
 * Which star colours a plant (bug report 2026-09-26, Hypao Flee MS-T d3-63: Stratum and Bacterium
 * alcyoneum shown T-dwarf grey and red, really green and lime under the F star).
 */
import { describe, expect, it } from "vitest";
import {
  brightestStarTypeFor,
  colourStarTypeByDesignation,
  colourStarTypeFor,
} from "../src/server/speciesMatchContext.js";
import type { ExplorationScanRecord } from "../src/shared/types.js";

const SYS = "Blu Aec QI-B d18";
const rec = (bodyId: number, name: string, parents: unknown[], extra: Partial<ExplorationScanRecord> = {}) =>
  ({
    systemAddress: 1,
    bodyId,
    bodyName: `${SYS} ${name}`,
    starSystem: SYS,
    updatedAt: "2026-09-26T00:00:00Z",
    parents,
    ...extra,
  }) as ExplorationScanRecord;

describe("colour star", () => {
  it("a brown dwarf in a planet slot passes the colour to the star it orbits", () => {
    // Owner's journal: Blu Aec QI-B d18 11 f — Cactoida Peperatis Yellow and Frutexa Flammasis Green,
    // the F star's colours, while the moon's host "11" is a T dwarf.
    const byId = new Map(
      [
        rec(0, "A", [{ Null: 0 }], { starType: "F", distanceFromArrivalLs: 0 }),
        rec(65, "11", [{ Star: 0 }], { starType: "T", distanceFromArrivalLs: 2498 }),
        rec(70, "11 f", [{ Star: 65 }, { Star: 0 }], { planetClass: "Rocky body" }),
      ].map((r) => [r.bodyId, r]),
    );
    expect(colourStarTypeFor(byId.get(70)!, byId)).toBe("F");
  });

  it("a star-lettered brown dwarf colours its own plants", () => {
    // Wredguia IY-I b23-0 B 4: Stratum Tectonicas Grey under the T dwarf "B", 3 of 3.
    const byId = new Map(
      [
        rec(2, "A", [{ Null: 1 }, { Null: 0 }], { starType: "M", distanceFromArrivalLs: 0 }),
        rec(3, "B", [{ Null: 1 }, { Null: 0 }], { starType: "T", distanceFromArrivalLs: 40 }),
        rec(9, "B 4", [{ Star: 3 }, { Null: 1 }, { Null: 0 }], { planetClass: "Rocky body" }),
      ].map((r) => [r.bodyId, r]),
    );
    expect(colourStarTypeFor(byId.get(9)!, byId)).toBe("T");
  });

  it("an ordinary host is the colour star", () => {
    const byId = new Map(
      [
        rec(0, "A", [{ Null: 0 }], { starType: "K", distanceFromArrivalLs: 0 }),
        rec(5, "A 3", [{ Star: 0 }], { planetClass: "Icy body" }),
      ].map((r) => [r.bodyId, r]),
    );
    expect(colourStarTypeFor(byId.get(5)!, byId)).toBe("K");
  });

  it("a planet-slot dwarf that only orbits a barycentre falls back to the arrival star", () => {
    const byId = new Map(
      [
        rec(1, "A", [{ Null: 0 }], { starType: "G", distanceFromArrivalLs: 0 }),
        rec(31, "AB 5", [{ Null: 0 }], { starType: "Y", distanceFromArrivalLs: 900 }),
        rec(40, "AB 5 c", [{ Star: 31 }, { Null: 0 }], { planetClass: "Rocky body" }),
      ].map((r) => [r.bodyId, r]),
    );
    expect(colourStarTypeFor(byId.get(40)!, byId)).toBe("G");
  });

  it("a black hole above the dwarf colours nothing: the dwarf keeps its own", () => {
    const byId = new Map(
      [
        rec(0, "A", [{ Null: 0 }], { starType: "H", distanceFromArrivalLs: 0 }),
        rec(13, "2", [{ Star: 0 }], { starType: "T", distanceFromArrivalLs: 600 }),
        rec(14, "2 a", [{ Star: 13 }, { Star: 0 }], { planetClass: "Rocky body" }),
      ].map((r) => [r.bodyId, r]),
    );
    expect(colourStarTypeFor(byId.get(14)!, byId)).toBe("T");
  });

  it("a T dwarf with only a barycentre above keeps its own colour", () => {
    const byId = new Map(
      [
        rec(1, "A", [{ Null: 0 }], { starType: "F", distanceFromArrivalLs: 0 }),
        rec(33, "ABC 2", [{ Null: 0 }], { starType: "T", distanceFromArrivalLs: 900 }),
        rec(34, "ABC 2 a", [{ Star: 33 }, { Null: 0 }], { planetClass: "Rocky body" }),
      ].map((r) => [r.bodyId, r]),
    );
    expect(colourStarTypeFor(byId.get(34)!, byId)).toBe("T");
  });
});

/**
 * The rule under the table: the brightest star in the body's sky, R² T⁴ / distance² (re-check,
 * 2026-09-26). The tables above have no radius or temperature, so they exercise the fallback.
 * Fixtures are real EDDN codex entries, star data from the EDDN exports and EDSM.
 */
describe("colour star: brightest in the sky", () => {
  const SUN_R = 695_700_000;
  const AU = 149_597_870_700;
  const LS = 299_792_458;
  const star = (
    bodyId: number,
    name: string,
    parents: unknown[],
    type: string,
    rSun: number,
    tempK: number,
    arrivalLs: number,
    extra: Partial<ExplorationScanRecord> = {},
  ) =>
    rec(bodyId, name, parents, {
      starType: type,
      radius: rSun * SUN_R,
      surfaceTemperature: tempK,
      distanceFromArrivalLs: arrivalLs,
      ...extra,
    });
  const index = (rows: ExplorationScanRecord[]) => new Map(rows.map((r) => [r.bodyId, r]));

  it("a planet round a dim M companion takes the bright A star's colour (Phylurn PJ-I d9-29 B 4)", () => {
    const byId = index([
      star(1, "A", [{ Null: 0 }], "A", 1.256, 8446, 0),
      star(2, "B", [{ Null: 0 }], "M", 0.5235, 3474, 11999),
      rec(9, "B 4", [{ Star: 2 }, { Null: 0 }], {
        planetClass: "Rocky body",
        semiMajorAxis: 270_262_235_403,
        distanceFromArrivalLs: 12619,
      }),
    ]);
    expect(colourStarTypeByDesignation(byId.get(9)!, byId)).toBe("M");
    expect(colourStarTypeFor(byId.get(9)!, byId)).toBe("A");
  });

  it("round one lettered dwarf the close planet keeps its colour, the far one takes the arrival star's (Kyloaln HA-J c24-5)", () => {
    const rows = [
      star(2, "A", [{ Null: 0 }], "K", 0.7643, 4511, 0),
      star(3, "B", [{ Null: 0 }], "L", 0.312, 1806, 536),
      star(4, "C", [{ Null: 0 }], "L", 0.3297, 1816, 4018),
      rec(20, "C 3", [{ Star: 4 }, { Null: 0 }], {
        planetClass: "High metal content body",
        semiMajorAxis: 26_924_449_205,
        distanceFromArrivalLs: 4092,
      }),
      rec(25, "C 8", [{ Star: 4 }, { Null: 0 }], {
        planetClass: "Icy body",
        semiMajorAxis: 111_711_925_268,
        distanceFromArrivalLs: 4271,
      }),
    ];
    const byId = index(rows);
    expect(colourStarTypeFor(byId.get(20)!, byId)).toBe("L");
    expect(colourStarTypeFor(byId.get(25)!, byId)).toBe("K");
  });

  it("a star the body does not orbit is placed through the orbit tree (Thaikeau NU-V d3-43 E 4 and E 6)", () => {
    // D and E orbit barycentre 6 on opposite sides: 0.59 + 3.29 AU apart. E 6 is far enough from
    // the T dwarf E that the K star D outshines it; E 4 is not.
    const byId = index([
      star(3, "A", [{ Null: 2 }, { Null: 1 }, { Null: 0 }], "G", 0.951, 5449, 0, {
        stellarMass: 1.023,
        semiMajorAxis: 0.00302 * AU,
      }),
      star(4, "B", [{ Null: 2 }, { Null: 1 }, { Null: 0 }], "M", 0.57, 3344, 5, {
        stellarMass: 0.402,
        semiMajorAxis: 0.00769 * AU,
      }),
      star(5, "C", [{ Null: 1 }, { Null: 0 }], "K", 0.581, 4008, 1101, {
        stellarMass: 0.492,
        semiMajorAxis: 1.134 * AU,
      }),
      star(7, "D", [{ Null: 6 }, { Null: 0 }], "K", 0.637, 4020, 205922, {
        stellarMass: 0.5,
        semiMajorAxis: 0.5917 * AU,
      }),
      star(8, "E", [{ Null: 6 }, { Null: 0 }], "T", 0.239, 1202, 204656, {
        stellarMass: 0.0898,
        semiMajorAxis: 3.2927 * AU,
      }),
      rec(25, "E 4", [{ Star: 8 }, { Null: 6 }, { Null: 0 }], {
        semiMajorAxis: 0.0952 * AU,
        distanceFromArrivalLs: 204642,
      }),
      rec(28, "E 6", [{ Star: 8 }, { Null: 6 }, { Null: 0 }], {
        semiMajorAxis: 0.169 * AU,
        distanceFromArrivalLs: 204723,
      }),
    ]);
    expect(colourStarTypeFor(byId.get(25)!, byId)).toBe("T");
    expect(colourStarTypeFor(byId.get(28)!, byId)).toBe("K");
  });

  it("a black hole gives no light: a moon round the arrival black hole takes a far B star's colour (Phroea Bluae EG-Y g2368 A 1 a)", () => {
    const byId = index([
      star(1, "A", [{ Null: 0 }], "H", 0.0000313, 0, 0),
      star(3, "B", [{ Null: 0 }], "B", 2.5212, 13054, 22976),
      star(4, "C", [{ Null: 0 }], "TTS", 1.4025, 8488, 23525),
      rec(9, "A 1", [{ Star: 1 }, { Null: 0 }], {
        planetClass: "Gas giant",
        semiMajorAxis: 3135 * LS,
        distanceFromArrivalLs: 3135,
      }),
      rec(10, "A 1 a", [{ Planet: 9 }, { Star: 1 }, { Null: 0 }], {
        semiMajorAxis: 0.0912 * AU,
        distanceFromArrivalLs: 3135,
      }),
    ]);
    expect(colourStarTypeFor(byId.get(10)!, byId)).toBe("B");
  });

  it("a planet round a star pair takes the brighter star, one colour instead of two", () => {
    const byId = index([
      star(1, "A", [{ Null: 1 }, { Null: 0 }], "F", 1.2, 6500, 0, {
        stellarMass: 1.2,
        semiMajorAxis: 10 * LS,
      }),
      star(2, "B", [{ Null: 1 }, { Null: 0 }], "K", 0.8, 4500, 30, {
        stellarMass: 0.8,
        semiMajorAxis: 15 * LS,
      }),
      rec(5, "AB 2", [{ Null: 1 }, { Null: 0 }], {
        planetClass: "Rocky body",
        semiMajorAxis: 800 * LS,
        distanceFromArrivalLs: 800,
      }),
    ]);
    expect(colourStarTypeByDesignation(byId.get(5)!, byId)).toBeUndefined();
    expect(colourStarTypeFor(byId.get(5)!, byId)).toBe("F");
  });

  it("a star the tree cannot place is taken at right angles to the body (Drumbaae KX-U f2-427 ABC 1 e)", () => {
    // Four members round barycentre 0 and no ScanBaryCentre: the N+G pair cannot be placed exactly,
    // but even at √(2634² + 1156²) ls the neutron star outshines the moon's T dwarf.
    const byId = index([
      star(1, "A", [{ Null: 0 }], "H", 0.0000193, 0, 0, { stellarMass: 4.55, semiMajorAxis: 0.9665 * AU }),
      star(3, "B", [{ Null: 2 }, { Null: 0 }], "N", 0.00001256, 1837572, 1156, {
        stellarMass: 1.543,
        semiMajorAxis: 0.0243 * AU,
      }),
      star(4, "C", [{ Null: 2 }, { Null: 0 }], "G", 0.9894, 5980, 1165, {
        stellarMass: 1.113,
        semiMajorAxis: 0.0336 * AU,
      }),
      star(5, "ABC 1", [{ Null: 0 }], "T", 0.1687, 920, 2640, {
        stellarMass: 0.0547,
        semiMajorAxis: 5.408 * AU,
      }),
      star(15, "ABC 2", [{ Null: 0 }], "Y", 0.1039, 574, 3481, {
        stellarMass: 0.0234,
        semiMajorAxis: 7.203 * AU,
      }),
      rec(10, "ABC 1 e", [{ Star: 5 }, { Null: 0 }], {
        semiMajorAxis: 0.032 * AU,
        distanceFromArrivalLs: 2634,
      }),
    ]);
    expect(colourStarTypeFor(byId.get(10)!, byId)).toBe("N");
  });

  it("a catalogue star is as bright as its magnitude says (HIP 36601 B 3)", () => {
    // HIP 36601 A: K0 V, 0.754 R☉, 4,432 K — 0.2 suns by size — but absolute magnitude 1.12, the real
    // star's 30 suns. Every commander who logged B 3 got K variants, not the L dwarf's.
    const byId = index([
      star(2, "A", [{ Null: 1 }, { Null: 0 }], "K", 0.7543, 4432, 0, { absoluteMagnitude: 1.117874 }),
      star(3, "B", [{ Null: 1 }, { Null: 0 }], "L", 0.2867, 1839, 13936, { absoluteMagnitude: 12.5 }),
      rec(11, "B 3", [{ Star: 3 }, { Null: 1 }, { Null: 0 }], {
        semiMajorAxis: 0.6868 * AU,
        distanceFromArrivalLs: 13901,
      }),
    ]);
    expect(colourStarTypeFor(byId.get(11)!, byId)).toBe("K");
    // Without the magnitude the dwarf would win, 7 to 1.
    const noMag = index([...byId.values()].map((r) => ({ ...r, absoluteMagnitude: undefined })));
    expect(colourStarTypeFor(noMag.get(11)!, noMag)).toBe("L");
  });

  it("falls back to the table when the arrival star has no radius", () => {
    const byId = index([
      rec(0, "A", [{ Null: 0 }], { starType: "F", distanceFromArrivalLs: 0 }),
      star(65, "11", [{ Star: 0 }], "T", 0.1, 900, 2498),
      rec(70, "11 f", [{ Star: 65 }, { Star: 0 }], { semiMajorAxis: 20 * LS, distanceFromArrivalLs: 2500 }),
    ]);
    expect(brightestStarTypeFor(byId.get(70)!, byId)).toBeUndefined();
    expect(colourStarTypeFor(byId.get(70)!, byId)).toBe("F");
  });
});
