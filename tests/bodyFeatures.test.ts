/**
 * Body features (src/shared/bodyFeatures.ts, owner 2026-09-30): each check at its threshold, the ring
 * maths, the parent-dependent ones, the void cross, and the notices they raise when switched on.
 */
import { describe, expect, it } from "vitest";
import {
  BODY_FEATURES,
  bodyFeatures,
  defaultFeaturePrefs,
  featureRecordFromScan,
  inVoidCross,
  scanRings,
} from "../src/shared/bodyFeatures.js";
import { DEFAULT_NOTIFY_PREFS, mergeNotifyPrefs } from "../src/shared/notices.js";
import { createNoticesService, type NoticesContext } from "../src/server/notices.js";
import type { ExplorationScanRecord } from "../src/shared/types.js";

const keys = (r: Partial<ExplorationScanRecord>, p?: Partial<ExplorationScanRecord> | null) =>
  bodyFeatures(r, p).map((f) => f.key);
const LS = 299_792_458;
const ring = (name: string, inner: number, outer: number, massMt = 1e9) => ({
  name,
  ringClass: "eRingClass_Icy",
  massMt,
  innerRadM: inner,
  outerRadM: outer,
});

describe("scan rings", () => {
  it("keeps rings and drops belts", () => {
    expect(
      scanRings([
        { Name: "X A Belt", RingClass: "eRingClass_Rocky", MassMT: 1, InnerRad: 1, OuterRad: 2 },
        { Name: "X 1 A Ring", RingClass: "eRingClass_Icy", MassMT: 5, InnerRad: 10, OuterRad: 20 },
      ]),
    ).toEqual([{ name: "X 1 A Ring", ringClass: "eRingClass_Icy", massMt: 5, innerRadM: 10, outerRadM: 20 }]);
    expect(scanRings(undefined)).toBeUndefined();
  });
});

describe("orbit and size", () => {
  it("each at its threshold", () => {
    expect(keys({ planetClass: "Icy body", radius: 300_000 })).toContain("smallBody");
    expect(keys({ planetClass: "Icy body", radius: 300_001 })).not.toContain("smallBody");
    expect(keys({ planetClass: "Icy body", radius: 1e6, orbitalPeriod: 28_800 })).toContain("fastOrbit");
    expect(keys({ planetClass: "Icy body", radius: 1e6, orbitalPeriod: 28_801 })).not.toContain("fastOrbit");
    const hj = { planetClass: "Sudarsky class I gas giant", radius: 7e7, orbitalPeriod: 5 * 86_400, parents: [{ Star: 0 }] };
    expect(keys(hj)).toContain("hotJupiter");
    expect(keys({ ...hj, parents: [{ Planet: 3 }] })).not.toContain("hotJupiter");
    expect(keys({ ...hj, planetClass: "Water giant" })).not.toContain("hotJupiter");
    expect(keys({ planetClass: "Sudarsky class II gas giant", radius: 7e7, massEM: 3300.5 })).toContain("massivePlanet");
    expect(keys({ planetClass: "Water world", radius: 6e6, rings: [ring("W 1 A Ring", 1e7, 2e7)] })).toContain("ringedRare");
    expect(keys({ planetClass: "Rocky body", radius: 6e6, rings: [ring("R 1 A Ring", 1e7, 2e7)] })).not.toContain("ringedRare");
    expect(keys({ starType: "K", ageMy: 13_000 })).toContain("ancientStar");
    expect(keys({ starType: "K", ageMy: 12_999 })).not.toContain("ancientStar");
    expect(keys({ starType: "DA", rings: [ring("S A Ring", 1e8, 2e8)] })).toContain("ringedStar");
    expect(keys({ starType: "G", rings: [ring("S A Ring", 1e8, 2e8)] })).not.toContain("ringedStar");
  });
});

describe("landables", () => {
  const land = { planetClass: "Rocky body", landable: true, radius: 2e6 };
  it("gravity, size, heat, atmosphere", () => {
    expect(keys({ ...land, surfaceGravity: 2.01 * 9.80665 })).toContain("highGravity");
    expect(keys({ ...land, radius: 18_000_001 })).toContain("largeLandable");
    expect(bodyFeatures({ ...land, surfaceTemperature: 820 }).find((f) => f.key === "hotLandable")?.label).toBe("Lethal heat");
    expect(bodyFeatures({ ...land, surfaceTemperature: 520 }).find((f) => f.key === "hotLandable")?.label).toBe("Hot landable");
    expect(keys({ ...land, surfaceTemperature: 499 })).not.toContain("hotLandable");
    expect(keys({ ...land, atmosphere: "thin oxygen atmosphere", surfacePressure: 0.095 * 101_325 })).toContain("brightAtmosphere");
    expect(keys({ ...land, atmosphere: "thin oxygen atmosphere", surfacePressure: 0.05 * 101_325 })).not.toContain("brightAtmosphere");
    // Not landable: none of these.
    expect(keys({ ...land, landable: false, surfaceGravity: 30, surfaceTemperature: 900 })).toEqual([]);
  });

  it("the parent-dependent ones", () => {
    const moon = { ...land, parents: [{ Planet: 1 }], semiMajorAxis: 1.2 * LS };
    expect(keys(moon, { planetClass: "Earthlike body", radius: 6e6 })).toContain("moonOfRare");
    expect(keys({ ...moon, semiMajorAxis: 1.6 * LS }, { planetClass: "Earthlike body", radius: 6e6 })).not.toContain("moonOfRare");
    // A parent of 70,000 km radius from 150,000 km away is about 50° across.
    expect(keys({ ...moon, semiMajorAxis: 1.5e8 }, { planetClass: "Sudarsky class I gas giant", radius: 7e7 })).toContain("bigInSky");
    expect(
      keys(
        { ...moon, orbitalInclination: -15, semiMajorAxis: 3 * LS },
        { planetClass: "Sudarsky class I gas giant", radius: 7e7, rings: [ring("P 1 A Ring", 1e8, 2e8)] },
      ),
    ).toContain("inclinedNearRings");
  });
});

describe("gas giants", () => {
  it("helium from 30 %", () => {
    const gg = { planetClass: "Sudarsky class I gas giant", radius: 7e7 };
    const comp = (he: number) => [
      { Name: "Hydrogen", Percent: 100 - he },
      { Name: "Helium", Percent: he },
    ];
    expect(keys({ ...gg, atmosphereComposition: comp(30.1) })).toContain("heliumRich");
    expect(keys({ ...gg, atmosphereComposition: comp(29.59) })).not.toContain("heliumRich");
  });
});

describe("rings", () => {
  const gg = { planetClass: "Sudarsky class I gas giant", radius: 7e7, massEM: 300 };
  it("massive, wide, narrow and Taylor's", () => {
    expect(bodyFeatures({ ...gg, rings: [ring("G 1 A Ring", 1e8, 2e8, 1.2e13)] }).find((f) => f.key === "bigRing")?.label).toBe(
      "Massive ring",
    );
    expect(bodyFeatures({ ...gg, rings: [ring("G 1 A Ring", 1e8, 5.1e9)] }).find((f) => f.key === "bigRing")?.label).toBe("Wide ring");
    // One ring 14,000 km wide on a 140,000 km body: 10 % → Taylor's.
    expect(bodyFeatures({ ...gg, rings: [ring("G 1 A Ring", 1e8, 1.14e8)] }).find((f) => f.key === "narrowRing")?.label).toBe(
      "Taylor's ring",
    );
    expect(bodyFeatures({ ...gg, rings: [ring("G 1 A Ring", 1e8, 1.3e8)] }).find((f) => f.key === "narrowRing")?.label).toBe(
      "Narrow ring",
    );
    expect(keys({ ...gg, rings: [ring("G 1 A Ring", 1e8, 1.4e8)] })).not.toContain("narrowRing");
  });

  it("a narrow gap between rings moving at different speeds", () => {
    // Close in to a heavy planet, 50 km apart: the inner ring's middle and the outer's differ by > 5 km/s.
    const heavy = { ...gg, massEM: 3000 };
    const r = [ring("G 1 A Ring", 8e7, 1.2e8), ring("G 1 B Ring", 1.2e8 + 50_000, 4e8)];
    expect(keys({ ...heavy, rings: r })).toContain("ringGap");
    expect(keys({ ...heavy, rings: [r[0]!, ring("G 1 B Ring", 1.2e8 + 200_000, 4e8)] })).not.toContain("ringGap");
  });

  it("a fast ring round a massive body", () => {
    expect(keys({ ...gg, massEM: 3000, rings: [ring("G 1 A Ring", 8e7, 1.2e8)] })).toContain("fastRing");
    expect(keys({ ...gg, massEM: 10, rings: [ring("G 1 A Ring", 1e9, 2e9)] })).not.toContain("fastRing");
  });

  it("shepherd moons and ring proximity, from the parent's rings", () => {
    const parent = { ...gg, rings: [ring("G 1 A Ring", 1e8, 2e8)] };
    const moon = { planetClass: "Icy body", radius: 1e6, landable: true, parents: [{ Planet: 1 }] };
    expect(keys({ ...moon, semiMajorAxis: 1.9e8 }, parent)).toContain("shepherdMoon");
    expect(keys({ ...moon, semiMajorAxis: 2.015e8 }, parent)).toContain("ringProximity");
    expect(keys({ ...moon, semiMajorAxis: 2.1e8 }, parent)).not.toContain("ringProximity");
    // Inside the inner edge is neither a shepherd nor close, unless it hugs that edge.
    expect(keys({ ...moon, semiMajorAxis: 5e7 }, parent)).toEqual(expect.not.arrayContaining(["shepherdMoon", "ringProximity"]));
    expect(bodyFeatures({ ...moon, semiMajorAxis: 0.99e8 }, parent).find((f) => f.key === "ringProximity")?.why).toMatch(/inner ring edge/);
  });
});

describe("the void cross", () => {
  it("near an axis and the plane, past 900 ly", () => {
    expect(inVoidCross({ x: 100, y: 0, z: 20_000 })).toBe(true);
    expect(inVoidCross({ x: 20_000, y: 0, z: -1_000 })).toBe(true);
    expect(inVoidCross({ x: 5_000, y: 0, z: 5_000 })).toBe(false);
    expect(inVoidCross({ x: 100, y: 2_000, z: 20_000 })).toBe(false);
    expect(inVoidCross({ x: 100, y: 0, z: 500 })).toBe(false);
  });
});

describe("prefs", () => {
  it("all off by default, merged key by key", () => {
    expect(Object.values(DEFAULT_NOTIFY_PREFS.features).every((v) => v === false)).toBe(true);
    expect(Object.keys(defaultFeaturePrefs())).toHaveLength(BODY_FEATURES.length);
    const p = mergeNotifyPrefs(DEFAULT_NOTIFY_PREFS, { features: { smallBody: true, nonsense: true, fastOrbit: "yes" } });
    expect(p.features.smallBody).toBe(true);
    expect(p.features.fastOrbit).toBe(false);
    expect("nonsense" in p.features).toBe(false);
    // A settings file from before features keeps working.
    const old = mergeNotifyPrefs({ ...DEFAULT_NOTIFY_PREFS, features: undefined as never }, {});
    expect(old.features.voidCross).toBe(false);
  });
});

describe("notices", () => {
  const ctx = (parent?: Partial<ExplorationScanRecord>): NoticesContext => ({
    isKnownBody: () => false,
    allScans: function* () {},
    currentSystem: () => ({ name: "Feat", address: 9 }),
    scanOf: () => (parent ?? null) as ExplorationScanRecord | null,
  });
  const scan = {
    timestamp: "2026-09-30T12:00:00Z",
    event: "Scan",
    StarSystem: "Feat",
    SystemAddress: 9,
    BodyID: 4,
    BodyName: "Feat 4 a",
    PlanetClass: "Icy body",
    Radius: 250_000,
    Landable: true,
    Parents: [{ Planet: 3 }],
    SemiMajorAxis: 1.9e8,
  };

  it("only the switched-on ones, with the figures", () => {
    const n = createNoticesService({ filePath: null });
    n.observe(scan, ctx({ planetClass: "Sudarsky class I gas giant", rings: [ring("Feat 3 A Ring", 1e8, 2e8)] }));
    expect(n.list()).toHaveLength(0);
    n.setPrefs({ features: { smallBody: true, shepherdMoon: true } });
    n.observe({ ...scan, BodyID: 5, BodyName: "Feat 5 a" }, ctx({ planetClass: "Sudarsky class I gas giant", rings: [ring("Feat 3 A Ring", 1e8, 2e8)] }));
    const titles = n.list().map((x) => `${x.title}: ${x.text}`);
    expect(titles).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Small body: 5 a in Feat — Radius 250 km/), expect.stringMatching(/^Shepherd moon/)]),
    );
  });

  it("the void cross on a crossing, not on the first jump", () => {
    const n = createNoticesService({ filePath: null });
    n.setPrefs({ features: { voidCross: true } });
    const jump = (x: number, z: number, t: string) => ({
      timestamp: t,
      event: "FSDJump",
      StarSystem: `S${x}`,
      SystemAddress: x,
      StarPos: [x, 0, z],
      JumpDist: 50,
    });
    n.observe(jump(5_000, 5_000, "2026-09-30T12:00:00Z"), ctx());
    expect(n.list()).toHaveLength(0);
    n.observe(jump(1_400, 5_000, "2026-09-30T12:01:00Z"), ctx());
    expect(n.list()[0]?.title).toBe("Entering the void cross");
    n.observe(jump(1_600, 5_000, "2026-09-30T12:02:00Z"), ctx());
    expect(n.list()[0]?.title).toBe("Leaving the void cross");
  });

  it("builds its record from a raw scan", () => {
    const r = featureRecordFromScan({ ...scan, Rings: [{ Name: "Feat 4 a A Ring", InnerRad: 1, OuterRad: 2, MassMT: 3 }] });
    expect(r).toMatchObject({ planetClass: "Icy body", radius: 250_000, landable: true });
    expect(r.rings).toHaveLength(1);
  });
});
