import { describe, expect, it } from "vitest";
import {
  decodeJournalMergeCache,
  encodeJournalMergeCache,
  JOURNAL_MERGE_CACHE_ENCODING,
} from "../src/server/journalMergeCacheEncoding.js";
import type { JournalMergeCachePayload } from "../src/server/gameState.js";
import type { BodyExoState, PlanetScan } from "../src/shared/types.js";

function scan(over: Partial<PlanetScan> = {}): PlanetScan {
  return {
    BodyName: "Test AB-C d1-2 3 a",
    BodyID: 4,
    StarSystem: "Test AB-C d1-2",
    SystemAddress: 1234567,
    PlanetClass: "Rocky body",
    Atmosphere: "thin carbon dioxide atmosphere",
    AtmosphereType: "CarbonDioxide",
    SurfaceTemperature: 163.069,
    SurfaceGravity: 3.460993,
    SurfacePressure: 505.189514,
    Landable: true,
    ...over,
  } as unknown as PlanetScan;
}

function body(over: Partial<BodyExoState> = {}): BodyExoState {
  return {
    key: "1234567:4",
    bodyName: "Test AB-C d1-2 3 a",
    bodyId: 4,
    systemAddress: 1234567,
    starSystem: "Test AB-C d1-2",
    biologicalSignals: null,
    genusHints: null,
    signalHints: null,
    dssComplete: false,
    scan: null,
    organicGenusLocks: [],
    confirmedVariants: [],
    updatedAt: "2026-08-26T04:03:21Z",
    ...over,
  };
}

function payload(bodies: [string, BodyExoState][]): JournalMergeCachePayload {
  return {
    format: 2,
    commanderName: "TESTER",
    currentSystem: "Test AB-C d1-2",
    currentSystemAddress: 1234567,
    viewingSystemAddress: null,
    visitedSystems: [[1234567, "Test AB-C d1-2"]],
    bodies,
    explorationScans: [],
    fssBodySignalsBodyKeys: [],
    dssMappedBodyKeys: [],
    dssFirstMapperEligibleByBodyKey: [],
    dssMappingEfficientByBodyKey: [],
    orbitParentPlanetByBody: [],
    lastEventIso: "2026-08-26T04:03:21Z",
    footJournalContextBuffer: [],
    organicAnalyseByKey: [],
    bodyDetailedFootfallState: [],
    firstFootfallBodies: [],
    pendingOrganicSales: [],
    fssAllBodiesCompleteSystems: [],
    fssDiscoveryScanBySystem: [],
  };
}

/** encode → JSON → parse → decode, the exact path the cache file takes through v8+gzip. */
function roundTrip(p: JournalMergeCachePayload): JournalMergeCachePayload | null {
  return decodeJournalMergeCache(JSON.parse(JSON.stringify(encodeJournalMergeCache(p))));
}

describe("journal merge cache encoding", () => {
  it("round-trips a body at its defaults", () => {
    const p = payload([["1234567:4", body()]]);
    expect(roundTrip(p)).toEqual(p);
  });

  it("round-trips a fully populated body", () => {
    const p = payload([
      [
        "1234567:4",
        body({
          biologicalSignals: 3,
          genusHints: [{ Genus: "$Codex_Ent_Stratum_Genus_Name;", Genus_Localised: "Stratum" }],
          signalHints: ["biological", "geological"],
          dssComplete: true,
          organicGenusLocks: [
            { genus: "Stratum", genusLocalised: "Stratum", variantLocalised: null } as never,
          ],
          confirmedVariants: ["Stratum Tectonicas - Green"],
          scan: scan({
            materials: [{ Name: "iron", Percent: 19.330063 }],
            atmosphereComposition: [
              { Name: "CarbonDioxide", Percent: 66.017136 },
              { Name: "SulphurDioxide", Percent: 33.98288 },
            ],
          } as never),
        }),
      ],
    ]);
    expect(roundTrip(p)).toEqual(p);
  });

  it("restores a scan whose identity fields differ from the parent body", () => {
    // 172 of 14,518 scans in the reference history carry a BodyName of their own; a blanket drop
    // would have corrupted every one of them.
    const p = payload([
      [
        "1234567:4",
        body({ scan: scan({ BodyName: "Something Else", BodyID: 99, StarSystem: "Elsewhere" }) }),
      ],
    ]);
    const back = roundTrip(p)!;
    expect(back.bodies[0]![1].scan!.BodyName).toBe("Something Else");
    expect(back.bodies[0]![1].scan!.BodyID).toBe(99);
    expect(back).toEqual(p);
  });

  it("actually drops the redundant fields rather than just restoring them", () => {
    const encoded = encodeJournalMergeCache(payload([["1234567:4", body({ scan: scan() })]]));
    const raw = encoded.payload.bodies[0]![1] as unknown as Record<string, unknown>;
    expect(raw).not.toHaveProperty("key");
    expect(raw).not.toHaveProperty("dssComplete");
    expect(raw).not.toHaveProperty("genusHints");
    expect(raw).not.toHaveProperty("confirmedVariants");
    expect(typeof raw.updatedAt).toBe("number");
    const rawScan = raw.scan as Record<string, unknown>;
    expect(rawScan).not.toHaveProperty("BodyName");
    expect(rawScan).not.toHaveProperty("SystemAddress");
  });

  it("leaves a composition array alone when it carries anything unusual", () => {
    const p = payload([
      [
        "1234567:4",
        body({
          scan: scan({
            atmosphereComposition: [{ Name: "CarbonDioxide", Percent: 66.017136, Note: "odd" }],
          } as never),
        }),
      ],
    ]);
    expect(roundTrip(p)).toEqual(p);
  });

  it("keeps a timestamp it cannot compact as the original string", () => {
    const p = payload([["1234567:4", body({ updatedAt: "2026-08-26T04:03:21.482Z" })]]);
    const encoded = encodeJournalMergeCache(p);
    expect((encoded.payload.bodies[0]![1] as unknown as Record<string, unknown>).updatedAt).toBe(
      "2026-08-26T04:03:21.482Z",
    );
    expect(roundTrip(p)).toEqual(p);
  });

  it("normalises an absent optional field to its default on the way back", () => {
    const withoutSignalHints = body();
    delete (withoutSignalHints as Partial<BodyExoState>).signalHints;
    const back = roundTrip(payload([["1234567:4", withoutSignalHints]]))!;
    expect(back.bodies[0]![1].signalHints).toBeNull();
  });

  it("refuses a document from a different encoding so the caller replays the journals", () => {
    const encoded = encodeJournalMergeCache(payload([]));
    expect(decodeJournalMergeCache({ ...encoded, enc: JOURNAL_MERGE_CACHE_ENCODING + 1 })).toBeNull();
    expect(decodeJournalMergeCache(null)).toBeNull();
    expect(decodeJournalMergeCache({ enc: JOURNAL_MERGE_CACHE_ENCODING })).toBeNull();
    expect(decodeJournalMergeCache("nonsense")).toBeNull();
  });
});
