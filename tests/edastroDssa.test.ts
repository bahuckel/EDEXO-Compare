/**
 * The Deep Space Support Array, and the join that gives it coordinates.
 *
 * `DSSAdeployments.csv` names systems and nothing else, so every distance in the panel comes from
 * joining on `Callsign` against `fleetcarriers.csv`. Measured against the live files on 2026-09-20:
 *
 * ```
 * DSSA rows                                     101
 * joined to a carrier row by callsign           101   (all with coordinates)
 * rows where the two files name different systems 0
 * of the 101: vistagenomics 67, exploration 97, refuel 88
 * DSSA sighting age   median  6d  p75 14d      carriers at large, deep space: median 35d
 * ```
 *
 * What is defended here is the join's two failure modes, neither of which would announce itself:
 * a DSSA carrier the big file does not carry (it must still be listed, without a distance, rather
 * than silently vanishing from a list of deep-space service carriers), and a DSSA row sorting to the
 * top because a null distance compared as zero.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countCarriers,
  fetchCarrierData,
  queryCarriers,
  resetCarrierMemo,
  resolveCarrierCachePath,
} from "../src/server/edastroCarriers.js";

/** The meta file sits beside the cache and is not exported; tests need to plant a recent fetch. */
const resolveCarrierMetaPathForTest = () =>
  resolveCarrierCachePath().replace(/carriers\.csv$/, "carriers.meta.json");
import {
  parseDssaCsv,
  readDssaByCallsign,
  resetDssaMemo,
  resolveDssaCachePath,
} from "../src/server/edastroDssa.js";

const CARRIER_HEADER =
  "Callsign,Name,Owner,LastUpdated,LastMoved,LastSystem,SystemAddress,Coord_X,Coord_Y,Coord_Z," +
  "SolDistance,EstimatedRegion,LocationHistory,DockingsEDDN,Services";

/** In the network, and in the big file. The normal case: 101 of 101 today. */
const JOINED =
  'TFF-34Z,,,"2026-09-18 00:00:00","2026-03-01 00:00:00",Oorb Broae DF-A e6,10,300,0,0,300,' +
  'Elysian Shore,4,2,"dock;refuel;vistagenomics"';
/** An ordinary carrier, nearer than the DSSA one, so the sort is actually exercised. */
const ORDINARY =
  'ZZZ-999,RANDOM,,"2026-09-19 00:00:00","2026-09-19 00:00:00",Somewhere,11,10,0,0,10,' +
  'Inner Orion Spur,90,9,"dock;vistagenomics"';

const CARRIERS = [CARRIER_HEADER, JOINED, ORDINARY].join("\n");

const DSSA_HEADER =
  "Num,Callsign,Name,Commander,Status,DeploymentLocation,LastSeenLocation,LastSeenDate";
const DSSA = [
  DSSA_HEADER,
  '1,TFF-34Z,DSSA Sleeper Service,Qohen Leth,Carrier Operational,Oorb Broae DF-A e6,' +
    'Oorb Broae DF-A e6,"2026-09-18 16:50:19"',
  // Deliberately absent from the carrier file. Zero of these exist today; the two files come from
  // different pipelines, so it is the shape to be ready for rather than one to assume away.
  '2,ORP-HAN,DSSA Orphan,Nobody,Carrier Operational,Far Away AB-C d1-2,Far Away AB-C d1-2,' +
    '"2026-09-10 00:00:00"',
].join("\n");

const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
const origin = { x: 0, y: 0, z: 0 };

let dir: string;
const saved = process.env.EDEXO_USER_DATA_DIR;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-dssa-"));
  process.env.EDEXO_USER_DATA_DIR = dir;
  resetCarrierMemo();
  resetDssaMemo();
  writeFileSync(resolveCarrierCachePath(), CARRIERS, "utf8");
  writeFileSync(resolveDssaCachePath(), DSSA, "utf8");
});

afterEach(() => {
  if (saved === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = saved;
  resetCarrierMemo();
  resetDssaMemo();
  rmSync(dir, { recursive: true, force: true });
});

describe("the cooldown guards the 21 MB file, not the 12 KB one", () => {
  /*
    Found in the running app. The carrier file had been fetched by a build that did not know about
    DSSA, so the deployment list was absent, the filter was disabled, and pressing the button did
    nothing but say "fetched recently" -- the cooldown returned before the DSSA download was even
    attempted. Half an hour of waiting for a 21 MB file the commander already had.

    Same shape for anyone whose DSSA fetch fails once: the carrier data is fine, the list is empty,
    and nothing recovers it until the cooldown lapses.
  */
  it("fetches the deployment list while the carrier file is still on cooldown", async () => {
    writeFileSync(resolveCarrierMetaPathForTest(), JSON.stringify({ fetchedAtMs: Date.now() }), "utf8");
    rmSync(resolveDssaCachePath(), { force: true });
    resetDssaMemo();

    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url));
      return new Response(DSSA, { status: 200, headers: { "content-type": "text/csv" } });
    }) as typeof globalThis.fetch;
    try {
      const result = await fetchCarrierData();
      expect(result.ok).toBe(true);
      // Only the small file was asked for; the big one is still inside its cooldown.
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("DSSAdeployments.csv");
      expect(result.status.dssaCount).toBe(2);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("still refuses when the deployment list is already present", async () => {
    // Nothing left to gain, so the cooldown means what it says and no request goes out at all.
    writeFileSync(resolveCarrierMetaPathForTest(), JSON.stringify({ fetchedAtMs: Date.now() }), "utf8");
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url));
      return new Response("", { status: 200 });
    }) as typeof globalThis.fetch;
    try {
      const result = await fetchCarrierData();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Fetched recently");
      expect(calls).toEqual([]);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("parseDssaCsv", () => {
  it("reads the columns EDAstro publishes", () => {
    const rows = parseDssaCsv(DSSA);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      callsign: "TFF-34Z",
      name: "DSSA Sleeper Service",
      commander: "Qohen Leth",
      status: "Carrier Operational",
      deploymentSystem: "Oorb Broae DF-A e6",
      lastSeenSystem: "Oorb Broae DF-A e6",
    });
    expect(rows[0]!.lastSeenMs).toBe(Date.UTC(2026, 8, 18, 16, 50, 19));
  });

  it("returns nothing for a body that is not this file", () => {
    expect(parseDssaCsv("<!DOCTYPE html><html></html>")).toEqual([]);
    expect(parseDssaCsv("")).toEqual([]);
  });

  it("is empty until a fetch has happened", () => {
    rmSync(resolveDssaCachePath(), { force: true });
    resetDssaMemo();
    expect(readDssaByCallsign().size).toBe(0);
  });
});

describe("the join", () => {
  it("marks a carrier that is in the network, and leaves the rest alone", () => {
    const rows = queryCarriers({ origin }, NOW);
    const joined = rows.find((r) => r.callsign === "TFF-34Z")!;
    expect(joined.dssa).toEqual({
      commander: "Qohen Leth",
      status: "Carrier Operational",
      deploymentSystem: "Oorb Broae DF-A e6",
    });
    expect(rows.find((r) => r.callsign === "ZZZ-999")!.dssa).toBeNull();
  });

  it("prefers the network's name over the carrier file's", () => {
    /*
      The big file's Name is empty on this row, as it is on a great many: EDAstro only learns a
      carrier's name from events that carry one. "DSSA Sleeper Service" says what the thing is for.
    */
    const joined = queryCarriers({ origin }, NOW).find((r) => r.callsign === "TFF-34Z")!;
    expect(joined.name).toBe("DSSA Sleeper Service");
  });

  it("takes distance and services from the carrier file, which is the only place they exist", () => {
    const joined = queryCarriers({ origin }, NOW).find((r) => r.callsign === "TFF-34Z")!;
    expect(joined.distanceLy).toBeCloseTo(300, 6);
    expect(joined.services).toContain("vistagenomics");
  });

  it("keeps the dwell reading, so a DSSA row is still judged like any other", () => {
    // Seen 2026-09-18, last moved 2026-03-01: 201 days parked. Being curated is not a substitute for
    // the measurement — a DSSA carrier that had just jumped would deserve the same amber as any.
    const joined = queryCarriers({ origin }, NOW).find((r) => r.callsign === "TFF-34Z")!;
    expect(joined.dwellDays).toBe(201);
  });
});

describe("DSSA only", () => {
  it("narrows to the network", () => {
    const all = queryCarriers({ origin }, NOW).map((r) => r.callsign);
    expect(all).toContain("ZZZ-999");
    const network = queryCarriers({ origin, dssaOnly: true }, NOW).map((r) => r.callsign);
    expect(network).not.toContain("ZZZ-999");
    expect(network).toContain("TFF-34Z");
  });

  it("still lists a network carrier the big file does not carry", () => {
    /*
      THE ONE THAT MATTERS. ORP-HAN is in the deployment list and not in the carrier file, so it has
      no coordinates and cannot be ranked. Dropping it would leave a curated list of deep-space
      service carriers quietly missing one, which is a worse answer than a row that cannot say how
      far away it is — and nothing on screen would hint that it had happened.
    */
    const rows = queryCarriers({ origin, dssaOnly: true }, NOW);
    const orphan = rows.find((r) => r.callsign === "ORP-HAN");
    expect(orphan).toBeDefined();
    expect(orphan!.distanceLy).toBeNull();
    expect(orphan!.system).toBe("Far Away AB-C d1-2");
    expect(orphan!.dssa?.commander).toBe("Nobody");
  });

  it("sorts an unplaceable row last rather than first", () => {
    // A null distance compared as zero would put the one carrier we know least about at the top of a
    // list whose entire purpose is "what is nearest".
    const rows = queryCarriers({ origin, dssaOnly: true }, NOW);
    expect(rows[rows.length - 1]!.callsign).toBe("ORP-HAN");
  });

  it("drops the unplaceable row from a service filter rather than guessing", () => {
    // Nothing is known about its fit. Claiming it sells Vista Genomics would be an invention, and
    // this is a list people fly hundreds of light years on.
    const rows = queryCarriers({ origin, dssaOnly: true, services: ["vistagenomics"] }, NOW);
    expect(rows.map((r) => r.callsign)).toEqual(["TFF-34Z"]);
  });

  it("counts the network the same way the list filters it", () => {
    expect(countCarriers({ origin, dssaOnly: true }, NOW)).toBe(1);
    expect(countCarriers({ origin }, NOW)).toBe(2);
  });

  it("searches the joined name and commander, not the raw carrier row", () => {
    /*
      The big file has no name for TFF-34Z and knows nothing about Qohen Leth; both come from the
      deployment list, and both are on screen. Searching the raw row would show a commander's name in
      the table that typing it could not find.
    */
    expect(queryCarriers({ origin, search: "sleeper" }, NOW).map((r) => r.callsign)).toEqual([
      "TFF-34Z",
    ]);
    expect(queryCarriers({ origin, search: "qohen" }, NOW).map((r) => r.callsign)).toEqual([
      "TFF-34Z",
    ]);
    expect(countCarriers({ origin, search: "qohen" }, NOW)).toBe(1);
  });

  it("searches an un-joined network carrier too", () => {
    const rows = queryCarriers({ origin, dssaOnly: true, search: "orphan" }, NOW);
    expect(rows.map((r) => r.callsign)).toEqual(["ORP-HAN"]);
  });

  it("keeps the count and the list agreeing under a search", () => {
    // "N of M" is a lie the moment these two apply different predicates, and nothing else would
    // notice: the number is small and plausible either way.
    const q = { origin, search: "dssa" };
    expect(countCarriers(q, NOW)).toBe(queryCarriers({ ...q, limit: 500 }, NOW).length);
  });

  it("offers nothing when the deployment list was never fetched", () => {
    // The carrier list must keep working on its own: the DSSA fetch is allowed to fail.
    rmSync(resolveDssaCachePath(), { force: true });
    resetDssaMemo();
    expect(queryCarriers({ origin, dssaOnly: true }, NOW)).toEqual([]);
    expect(queryCarriers({ origin }, NOW)).toHaveLength(2);
    expect(queryCarriers({ origin }, NOW).every((r) => r.dssa === null)).toBe(true);
  });
});
