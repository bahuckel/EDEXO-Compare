/**
 * How far a body is from the star it orbits — the quantity Clypeus speculumi's 2,500 ls rule reads.
 *
 * Two mistakes were made getting here, and both are pinned below.
 *
 * 1. `SemiMajorAxis / c` alone. Right for a planet, **wrong for a moon**, whose semi-major axis is
 *    its orbit around its *planet*: 20 of 298 speculumi bodies read as under 50 ls when their real
 *    distance was 2,858–206,459 ls.
 * 2. Then a climb that hopped records through `Planet` entries and **stopped dead at the first
 *    barycentre** — even when a planet with a perfectly good orbit was listed right behind it.
 *    Moons orbit each other, and the pair's barycentre is what orbits the planet or the star.
 *
 * 3. And a claim that a barycentre's own orbit was unrecoverable, made after checking the two places
 *    it is absent from — `Scan` events and the EDSM system caches — and not the one it is in. The
 *    game emits `ScanBaryCentre`; EDSM and Spansh drop it; the app had been storing all 2,030 of the
 *    owner's for months.
 *
 * The parents array is the whole ancestry, nearest-first, so the answer is read from it directly
 * rather than walked. Over the 9,691 landable bodies in the owner's journals this resolves **99.9 %**
 * and abstains on 11.
 */
import { describe, expect, it } from "vitest";
import { starDistanceLs } from "../src/server/speciesMatchContext.js";
import { barycentreSyntheticBodyId } from "../src/server/orbitUtils.js";
import type { ExplorationScanRecord } from "../src/shared/types.js";

const C = 299792458;
const AU = 149597870700;

function rec(bodyId: number, o: Partial<ExplorationScanRecord> = {}): ExplorationScanRecord {
  return {
    systemAddress: 1,
    bodyId,
    bodyName: `B ${bodyId}`,
    starSystem: "S",
    updatedAt: "2026-09-07T00:00:00Z",
    ...o,
  } as ExplorationScanRecord;
}

const index = (rows: ExplorationScanRecord[]) => new Map(rows.map((r) => [r.bodyId, r]));

/** A star at the arrival point, plus a second star far away — the multi-star trap. */
const arrivalStar = rec(0, { starType: "M", distanceFromArrivalLs: 0 });
const farStar = rec(1, { starType: "K", distanceFromArrivalLs: 100_000 });

describe("bodies orbiting the arrival star", () => {
  it("uses the arrival distance, which is exactly that star's distance", () => {
    const planet = rec(4, { parents: [{ Star: 0 }], distanceFromArrivalLs: 3000, semiMajorAxis: 6 * AU });
    expect(starDistanceLs(planet, null, index([arrivalStar, planet]))).toBe(3000);
  });

  it("does the same for a moon, rather than reporting its orbit around its planet", () => {
    // The original bug: this moon is 3,000 ls from its star and 0.003 AU from its planet.
    const planet = rec(4, { parents: [{ Star: 0 }], semiMajorAxis: 6 * AU });
    const moon = rec(5, {
      parents: [{ Planet: 4 }, { Star: 0 }],
      distanceFromArrivalLs: 3000,
      semiMajorAxis: 0.003 * AU,
    });
    const d = starDistanceLs(moon, null, index([arrivalStar, planet, moon]))!;
    expect(d).toBe(3000);
    expect(d).toBeGreaterThan(2500);
  });

  it("works through a barycentre, because the arrival distance does not care about the chain", () => {
    const moon = rec(9, {
      parents: [{ Null: 7 }, { Star: 0 }],
      distanceFromArrivalLs: 4100,
      semiMajorAxis: 0.001 * AU,
    });
    expect(starDistanceLs(moon, null, index([arrivalStar, moon]))).toBe(4100);
  });

  it("identifies the arrival star by its zero distance, not by the lowest body id", () => {
    // Body 0 is a distant companion; body 2 is where you arrive.
    const companion = rec(0, { starType: "K", distanceFromArrivalLs: 90_000 });
    const arrival = rec(2, { starType: "A", distanceFromArrivalLs: 0 });
    const planet = rec(6, { parents: [{ Star: 2 }], distanceFromArrivalLs: 2600, semiMajorAxis: 5.2 * AU });
    expect(starDistanceLs(planet, null, index([companion, arrival, planet]))).toBe(2600);
  });
});

describe("bodies orbiting some other star in the system", () => {
  /**
   * The case the arrival distance gets wrong: this planet is 400 ls from its own star, but 100,400
   * ls from the point you arrive at. Reading the arrival distance here would pass a 2,500 ls gate on
   * a body that fails it.
   */
  it("uses the orbital radius, not the arrival distance", () => {
    const planet = rec(6, {
      parents: [{ Star: 1 }],
      distanceFromArrivalLs: 100_400,
      semiMajorAxis: 400 * C,
    });
    const d = starDistanceLs(planet, null, index([arrivalStar, farStar, planet]))!;
    expect(Math.round(d)).toBe(400);
  });

  it("gives a moon its planet's orbit around that star", () => {
    const planet = rec(6, { parents: [{ Star: 1 }], semiMajorAxis: 3000 * C });
    const moon = rec(7, {
      parents: [{ Planet: 6 }, { Star: 1 }],
      distanceFromArrivalLs: 103_000,
      semiMajorAxis: 0.002 * AU,
    });
    expect(Math.round(starDistanceLs(moon, null, index([arrivalStar, farStar, planet, moon]))!)).toBe(3000);
  });

  /**
   * The owner's case, and the one the record-hopping climb missed: a moon of a moon-pair. It orbits
   * the pair's barycentre, the barycentre orbits the planet, and the planet orbits the star — so the
   * planet's orbit is the answer, and it is sitting right there in the parents array.
   */
  it("reads through a barycentre to the planet behind it", () => {
    const planet = rec(6, { parents: [{ Star: 1 }], semiMajorAxis: 2800 * C });
    const moon = rec(9, {
      parents: [{ Null: 8 }, { Planet: 6 }, { Star: 1 }],
      distanceFromArrivalLs: 102_800,
      semiMajorAxis: 0.0004 * AU,
    });
    expect(Math.round(starDistanceLs(moon, null, index([arrivalStar, farStar, planet, moon]))!)).toBe(2800);
  });
});

describe("barycentres, whose orbit the game reports separately", () => {
  /**
   * The obvious conclusion is that a barycentre's orbit is unrecoverable — it has no `Scan` event,
   * and the EDSM system caches carry no row for one. Both of those are true and both are beside the
   * point: the game emits a **`ScanBaryCentre`** event with the orbital elements, EDSM and Spansh
   * drop it, and `mergeBarycentreJournalLine` has been storing it under a synthetic body id since
   * long before this function existed. There are 2,030 of them in the owner's logs.
   */
  it("uses the barycentre's own orbit around a star that is not the arrival star", () => {
    const bary = rec(barycentreSyntheticBodyId(8), { semiMajorAxis: 2700 * C });
    const moon = rec(9, {
      parents: [{ Null: 8 }, { Star: 1 }],
      distanceFromArrivalLs: 100_500,
      semiMajorAxis: 0.001 * AU, // its orbit around the barycentre — the wrong radius
    });
    expect(Math.round(starDistanceLs(moon, null, index([arrivalStar, farStar, bary, moon]))!)).toBe(2700);
  });

  it("reads a barycentre under a planet the same way", () => {
    // moon -> pair barycentre -> planet -> star: the planet's orbit is still the answer.
    const planet = rec(6, { parents: [{ Star: 1 }], semiMajorAxis: 3100 * C });
    const bary = rec(barycentreSyntheticBodyId(8), { semiMajorAxis: 0.002 * AU });
    const moon = rec(9, { parents: [{ Null: 8 }, { Planet: 6 }, { Star: 1 }], semiMajorAxis: 0.0004 * AU });
    expect(Math.round(starDistanceLs(moon, null, index([arrivalStar, farStar, planet, bary, moon]))!)).toBe(3100);
  });

  it("does not mistake the barycentre id for a real body id", () => {
    // Body 8 exists and orbits close in; barycentre 8 is a different thing entirely.
    const decoy = rec(8, { parents: [{ Star: 1 }], semiMajorAxis: 12 * C });
    const bary = rec(barycentreSyntheticBodyId(8), { semiMajorAxis: 2700 * C });
    const moon = rec(9, { parents: [{ Null: 8 }, { Star: 1 }], semiMajorAxis: 0.001 * AU });
    expect(Math.round(starDistanceLs(moon, null, index([arrivalStar, farStar, decoy, bary, moon]))!)).toBe(2700);
  });
});

describe("when it cannot be measured, it says so", () => {
  /**
   * A barycentre we never saw the `ScanBaryCentre` for, under a non-arrival star. The arrival
   * distance would be measured from the wrong star, and two radial distances subtracted are a lower
   * bound that can read zero when a body and its star share a radius. A gate firing on a fabricated
   * zero is worse than a gate that abstains. After the `ScanBaryCentre` lookup this is 11 of the
   * 9,691 landable bodies in the owner's logs — 0.1 %.
   */
  it("abstains for a barycentre whose orbit was never scanned", () => {
    const moon = rec(9, {
      parents: [{ Null: 8 }, { Star: 1 }],
      distanceFromArrivalLs: 100_500,
      semiMajorAxis: 0.001 * AU,
    });
    expect(starDistanceLs(moon, null, index([arrivalStar, farStar, moon]))).toBeUndefined();
  });

  it("abstains for a ring parent — every one of the 7,314 in the logs is an unlandable belt cluster", () => {
    const body = rec(9, { parents: [{ Ring: 3 }, { Star: 1 }], distanceFromArrivalLs: 100_100 });
    expect(starDistanceLs(body, null, index([arrivalStar, farStar, body]))).toBeUndefined();
  });

  it("has no chain to read without an exploration record", () => {
    expect(starDistanceLs(null, null, index([arrivalStar]))).toBeUndefined();
  });
});

describe("a system whose chain names no star at all", () => {
  it("falls back to the arrival distance, because the stars are where you arrived", () => {
    const moon = rec(9, { parents: [{ Null: 8 }, { Null: 0 }], distanceFromArrivalLs: 2900 });
    expect(starDistanceLs(moon, null, index([arrivalStar, moon]))).toBe(2900);
  });
});
