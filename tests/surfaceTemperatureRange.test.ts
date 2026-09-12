/**
 * The temperature range the game shows, reproduced from the journal alone.
 *
 * Every expectation here was read off the game's own body panel and reported exactly as shown, so
 * these are observations rather than fixtures generated from the code they test. The bodies span two
 * systems, two stars, four planet classes, three atmospheres, and compositions from 86 % rock to
 * pure metal to 83 % ice.
 *
 * One kelvin of tolerance, because the panel prints whole degrees and its rounding is unknown.
 */
import { describe, expect, it } from "vitest";
import { estimateSurfaceTemperatureRange } from "../src/server/surfaceTemperatureRange.js";
import type { ExplorationScanRecord } from "../src/shared/types.js";

interface RangeCase {
  system: string;
  body: string;
  note: string;
  minK: number;
  maxK: number;
  records: Partial<ExplorationScanRecord>[];
}

const CASES: RangeCase[] = [
  {
    "system": "Smoje MF-C c14-0",
    "body": "Smoje MF-C c14-0 A 2",
    "note": "thin sulphur dioxide",
    "minK": 271,
    "maxK": 529,
    "records": [
      {
        "bodyId": 5,
        "bodyName": "Smoje MF-C c14-0 A 2",
        "parents": [
          {
            "Null": 3
          },
          {
            "Star": 1
          },
          {
            "Null": 0
          }
        ],
        "semiMajorAxis": 72268056.869507,
        "distanceFromArrivalLs": 167.437006,
        "surfaceTemperature": 406.726715,
        "radius": 3302185.75,
        "planetClass": "High metal content body",
        "atmosphereType": "SulphurDioxide",
        "surfacePressure": 354.592468,
        "landable": true,
        "systemAddress": 1,
        "starSystem": "Smoje MF-C c14-0",
        "updatedAt": "2026-09-12T00:00:00Z"
      },
      {
        "bodyId": 1,
        "bodyName": "Smoje MF-C c14-0 A",
        "parents": [
          {
            "Null": 0
          }
        ],
        "semiMajorAxis": 1511451661586.7615,
        "surfaceTemperature": 5546,
        "radius": 563247168,
        "starType": "G",
        "systemAddress": 1,
        "starSystem": "Smoje MF-C c14-0",
        "updatedAt": "2026-09-12T00:00:00Z"
      },
      {
        "bodyId": 2,
        "bodyName": "Smoje MF-C c14-0 B",
        "parents": [
          {
            "Null": 0
          }
        ],
        "semiMajorAxis": 2083097398281.0974,
        "distanceFromArrivalLs": 13961.986229,
        "surfaceTemperature": 4240,
        "radius": 513283552,
        "starType": "K",
        "systemAddress": 1,
        "starSystem": "Smoje MF-C c14-0",
        "updatedAt": "2026-09-12T00:00:00Z"
      }
    ]
  },
  {
    "system": "Smoje MF-C c14-0",
    "body": "Smoje MF-C c14-0 A 6",
    "note": "thicker carbon dioxide",
    "minK": 154,
    "maxK": 301,
    "records": [
      {
        "bodyId": 10,
        "bodyName": "Smoje MF-C c14-0 A 6",
        "parents": [
          {
            "Null": 8
          },
          {
            "Star": 1
          },
          {
            "Null": 0
          }
        ],
        "semiMajorAxis": 309382802.248001,
        "distanceFromArrivalLs": 798.681464,
        "surfaceTemperature": 251.902252,
        "radius": 3077323.5,
        "planetClass": "High metal content body",
        "atmosphereType": "CarbonDioxide",
        "surfacePressure": 4387.041992,
        "landable": true,
        "systemAddress": 1,
        "starSystem": "Smoje MF-C c14-0",
        "updatedAt": "2026-09-12T00:00:00Z"
      },
      {
        "bodyId": 1,
        "bodyName": "Smoje MF-C c14-0 A",
        "parents": [
          {
            "Null": 0
          }
        ],
        "semiMajorAxis": 1511451661586.7615,
        "surfaceTemperature": 5546,
        "radius": 563247168,
        "starType": "G",
        "systemAddress": 1,
        "starSystem": "Smoje MF-C c14-0",
        "updatedAt": "2026-09-12T00:00:00Z"
      },
      {
        "bodyId": 2,
        "bodyName": "Smoje MF-C c14-0 B",
        "parents": [
          {
            "Null": 0
          }
        ],
        "semiMajorAxis": 2083097398281.0974,
        "distanceFromArrivalLs": 13961.986229,
        "surfaceTemperature": 4240,
        "radius": 513283552,
        "starType": "K",
        "systemAddress": 1,
        "starSystem": "Smoje MF-C c14-0",
        "updatedAt": "2026-09-12T00:00:00Z"
      }
    ]
  },
  {
    "system": "Smoje MF-C c14-0",
    "body": "Smoje MF-C c14-0 B 7",
    "note": "airless, around the second star",
    "minK": 101,
    "maxK": 198,
    "records": [
      {
        "bodyId": 25,
        "bodyName": "Smoje MF-C c14-0 B 7",
        "parents": [
          {
            "Star": 2
          },
          {
            "Null": 0
          }
        ],
        "semiMajorAxis": 189749133586.88354,
        "distanceFromArrivalLs": 13335.671272,
        "surfaceTemperature": 184.03833,
        "radius": 2034370,
        "planetClass": "High metal content body",
        "atmosphereType": "None",
        "surfacePressure": 0,
        "landable": true,
        "systemAddress": 1,
        "starSystem": "Smoje MF-C c14-0",
        "updatedAt": "2026-09-12T00:00:00Z"
      },
      {
        "bodyId": 1,
        "bodyName": "Smoje MF-C c14-0 A",
        "parents": [
          {
            "Null": 0
          }
        ],
        "semiMajorAxis": 1511451661586.7615,
        "surfaceTemperature": 5546,
        "radius": 563247168,
        "starType": "G",
        "systemAddress": 1,
        "starSystem": "Smoje MF-C c14-0",
        "updatedAt": "2026-09-12T00:00:00Z"
      },
      {
        "bodyId": 2,
        "bodyName": "Smoje MF-C c14-0 B",
        "parents": [
          {
            "Null": 0
          }
        ],
        "semiMajorAxis": 2083097398281.0974,
        "distanceFromArrivalLs": 13961.986229,
        "surfaceTemperature": 4240,
        "radius": 513283552,
        "starType": "K",
        "systemAddress": 1,
        "starSystem": "Smoje MF-C c14-0",
        "updatedAt": "2026-09-12T00:00:00Z"
      }
    ]
  },
  {
    "system": "Smoje RL-A c15-0",
    "body": "Smoje RL-A c15-0 A 5",
    "note": "thin sulphur dioxide, a different system",
    "minK": 128,
    "maxK": 250,
    "records": [
      {
        "bodyId": 9,
        "bodyName": "Smoje RL-A c15-0 A 5",
        "parents": [
          {
            "Star": 1
          },
          {
            "Null": 0
          }
        ],
        "semiMajorAxis": 252426195144.65332,
        "distanceFromArrivalLs": 840.202937,
        "surfaceTemperature": 193.500656,
        "radius": 2623023.25,
        "planetClass": "High metal content body",
        "atmosphereType": "SulphurDioxide",
        "surfacePressure": 217.452332,
        "landable": true,
        "systemAddress": 1,
        "starSystem": "Smoje RL-A c15-0",
        "updatedAt": "2026-09-12T00:00:00Z"
      },
      {
        "bodyId": 1,
        "bodyName": "Smoje RL-A c15-0 A",
        "parents": [
          {
            "Null": 0
          }
        ],
        "semiMajorAxis": 3832830846309.662,
        "surfaceTemperature": 5483,
        "radius": 647298048,
        "starType": "G",
        "systemAddress": 1,
        "starSystem": "Smoje RL-A c15-0",
        "updatedAt": "2026-09-12T00:00:00Z"
      },
      {
        "bodyId": 2,
        "bodyName": "Smoje RL-A c15-0 B",
        "parents": [
          {
            "Null": 0
          }
        ],
        "semiMajorAxis": 6484897732734.68,
        "distanceFromArrivalLs": 35062.953854,
        "surfaceTemperature": 3921,
        "radius": 465909376,
        "starType": "K",
        "systemAddress": 1,
        "starSystem": "Smoje RL-A c15-0",
        "updatedAt": "2026-09-12T00:00:00Z"
      }
    ]
  },
  {
    "system": "Smoje RL-A c15-0",
    "body": "Smoje RL-A c15-0 B 1",
    "note": "a hundred per cent metal",
    "minK": 723,
    "maxK": 1412,
    "records": [
      {
        "bodyId": 21,
        "bodyName": "Smoje RL-A c15-0 B 1",
        "parents": [
          {
            "Star": 2
          },
          {
            "Null": 0
          }
        ],
        "semiMajorAxis": 2894414663.314819,
        "distanceFromArrivalLs": 35053.401169,
        "surfaceTemperature": 1044.780396,
        "radius": 3466474,
        "planetClass": "Metal rich body",
        "atmosphereType": "None",
        "surfacePressure": 0,
        "landable": true,
        "systemAddress": 1,
        "starSystem": "Smoje RL-A c15-0",
        "updatedAt": "2026-09-12T00:00:00Z"
      },
      {
        "bodyId": 1,
        "bodyName": "Smoje RL-A c15-0 A",
        "parents": [
          {
            "Null": 0
          }
        ],
        "semiMajorAxis": 3832830846309.662,
        "surfaceTemperature": 5483,
        "radius": 647298048,
        "starType": "G",
        "systemAddress": 1,
        "starSystem": "Smoje RL-A c15-0",
        "updatedAt": "2026-09-12T00:00:00Z"
      },
      {
        "bodyId": 2,
        "bodyName": "Smoje RL-A c15-0 B",
        "parents": [
          {
            "Null": 0
          }
        ],
        "semiMajorAxis": 6484897732734.68,
        "distanceFromArrivalLs": 35062.953854,
        "surfaceTemperature": 3921,
        "radius": 465909376,
        "starType": "K",
        "systemAddress": 1,
        "starSystem": "Smoje RL-A c15-0",
        "updatedAt": "2026-09-12T00:00:00Z"
      }
    ]
  },
  {
    "system": "Smoje RL-A c15-0",
    "body": "Smoje RL-A c15-0 B 2 a",
    "note": "an icy moon of a gas giant",
    "minK": 56,
    "maxK": 110,
    "records": [
      {
        "bodyId": 24,
        "bodyName": "Smoje RL-A c15-0 B 2 a",
        "parents": [
          {
            "Planet": 22
          },
          {
            "Star": 2
          },
          {
            "Null": 0
          }
        ],
        "semiMajorAxis": 660991013.050079,
        "distanceFromArrivalLs": 33817.998591,
        "surfaceTemperature": 110.308365,
        "radius": 1588051.5,
        "planetClass": "Icy body",
        "atmosphereType": "None",
        "surfacePressure": 0,
        "landable": true,
        "systemAddress": 1,
        "starSystem": "Smoje RL-A c15-0",
        "updatedAt": "2026-09-12T00:00:00Z"
      },
      {
        "bodyId": 1,
        "bodyName": "Smoje RL-A c15-0 A",
        "parents": [
          {
            "Null": 0
          }
        ],
        "semiMajorAxis": 3832830846309.662,
        "surfaceTemperature": 5483,
        "radius": 647298048,
        "starType": "G",
        "systemAddress": 1,
        "starSystem": "Smoje RL-A c15-0",
        "updatedAt": "2026-09-12T00:00:00Z"
      },
      {
        "bodyId": 2,
        "bodyName": "Smoje RL-A c15-0 B",
        "parents": [
          {
            "Null": 0
          }
        ],
        "semiMajorAxis": 6484897732734.68,
        "distanceFromArrivalLs": 35062.953854,
        "surfaceTemperature": 3921,
        "radius": 465909376,
        "starType": "K",
        "systemAddress": 1,
        "starSystem": "Smoje RL-A c15-0",
        "updatedAt": "2026-09-12T00:00:00Z"
      },
      {
        "bodyId": 22,
        "bodyName": "Smoje RL-A c15-0 B 2",
        "parents": [
          {
            "Star": 2
          },
          {
            "Null": 0
          }
        ],
        "semiMajorAxis": 374856412410.7361,
        "distanceFromArrivalLs": 33820.092372,
        "surfaceTemperature": 155.989563,
        "radius": 73130960,
        "planetClass": "Gas giant with water based life",
        "surfacePressure": 0,
        "landable": false,
        "systemAddress": 1,
        "starSystem": "Smoje RL-A c15-0",
        "updatedAt": "2026-09-12T00:00:00Z"
      }
    ]
  }
];

function index(c: RangeCase) {
  const byId = new Map<number, ExplorationScanRecord>();
  for (const r of c.records) byId.set(r.bodyId as number, r as ExplorationScanRecord);
  const arrival =
    (c.records.find((r) => r.starType && !((r.distanceFromArrivalLs ?? 0) > 0)) as
      | ExplorationScanRecord
      | undefined) ?? null;
  const rec = c.records.find((r) => r.bodyName === c.body) as ExplorationScanRecord;
  return { byId, arrival, rec };
}

describe("the surface temperature range a landable body spans", () => {
  it.each(CASES.map((c) => [c.body + " - " + c.note, c] as const))("%s", (_name, c) => {
    const { byId, arrival, rec } = index(c);
    const got = estimateSurfaceTemperatureRange(rec, byId, arrival);
    expect(got, "a range was produced").not.toBeNull();
    expect(Math.abs(got!.minK - c.minK), "min " + got!.minK.toFixed(1)).toBeLessThanOrEqual(1);
    expect(Math.abs(got!.maxK - c.maxK), "max " + got!.maxK.toFixed(1)).toBeLessThanOrEqual(1);
  });

  it("says nothing about a body that cannot be landed on", () => {
    // The game shows no range for one either: it describes conditions you could stand in.
    const { byId, arrival, rec } = index(CASES[0]!);
    expect(estimateSurfaceTemperatureRange({ ...rec, landable: false }, byId, arrival)).toBeNull();
  });

  it("refuses an atmosphere it has never been measured against", () => {
    // A guess from an uncalibrated gas would be indistinguishable from a measurement.
    const { byId, arrival, rec } = index(CASES[0]!);
    expect(estimateSurfaceTemperatureRange({ ...rec, atmosphereType: "Ammonia" }, byId, arrival)).toBeNull();
    expect(estimateSurfaceTemperatureRange({ ...rec, atmosphereType: "Water" }, byId, arrival)).toBeNull();
  });

  it("says nothing when the star is unknown", () => {
    const { rec } = index(CASES[0]!);
    expect(estimateSurfaceTemperatureRange(rec, new Map(), null)).toBeNull();
  });
});
