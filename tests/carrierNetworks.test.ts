/**
 * Carrier networks carried as a roster rather than downloaded.
 *
 * EDAstro curates exactly one network file, DSSA's. OASIS has none, and a name prefix will not do:
 * across the 90,077 carriers, "OASIS" matches 106 names and "STAR" matches 902, almost all of them
 * ordinary carriers with the word in their name.
 *
 * **`W5X-43H` is the proof.** EDAstro files it as "U.S.S KORRIBAN III" — no OASIS anywhere in the
 * name — and it is an OASIS carrier selling Vista Genomics like the rest. A heuristic loses it
 * silently; a stated list does not.
 *
 * Checked against the 2026-09-19 carrier file: 11 of 11 present, all 11 carrying Vista Genomics,
 * Universal Cartographics, refuel and repair.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CARRIER_NETWORKS,
  OASIS_NETWORK,
  networkForCallsign,
} from "../src/shared/carrierNetworks.js";
import {
  countCarriers,
  queryCarriers,
  resetCarrierMemo,
  resolveCarrierCachePath,
} from "../src/server/edastroCarriers.js";

/** Exactly as the owner gave them, 2026-09-20. */
const GIVEN: ReadonlyArray<readonly [string, string]> = [
  ["J9H-0KM", "OASIS Surface Detail"],
  ["BZW-LVW", "OASIS Star of Earendil"],
  ["G8Q-9QN", "OASIS Wirral"],
  ["B0V-N3Z", "OASIS Mary Voytek"],
  ["THG-65K", "OASIS Tycho Brahe II"],
  ["N5Z-T4G", "OASIS Dersin's Rest"],
  ["N3F-WQF", "OASIS Joshua Lederberg"],
  ["W5X-43H", "OASIS USS Korriban III"],
  ["WNW-GHV", "OASIS Johannes Kepler"],
  ["WHK-91L", "OASIS USS Dromund Kaas"],
  ["N8Q-72B", "OASIS Vera Rubin"],
];

describe("the OASIS roster", () => {
  it("carries exactly the eleven the owner listed, and their names", () => {
    /*
      Pinned against a transcription slip. These are callsigns: one wrong character points a
      commander at a different carrier entirely, and nothing on the row would look wrong.
    */
    expect(Object.keys(OASIS_NETWORK.members).sort()).toEqual(GIVEN.map(([c]) => c).sort());
    for (const [callsign, name] of GIVEN) {
      expect(OASIS_NETWORK.members[callsign]).toBe(name);
    }
  });

  it("finds a member by callsign, whatever the case", () => {
    expect(networkForCallsign("J9H-0KM")?.name).toBe("OASIS Surface Detail");
    expect(networkForCallsign("j9h-0km")?.name).toBe("OASIS Surface Detail");
    expect(networkForCallsign("  J9H-0KM  ")?.network.key).toBe("oasis");
  });

  it("includes the one whose name does not say OASIS", () => {
    // EDAstro has this as "U.S.S KORRIBAN III". This is the whole argument for a list over a prefix.
    expect(networkForCallsign("W5X-43H")?.name).toBe("OASIS USS Korriban III");
  });

  it("claims nothing about a carrier that is not a member", () => {
    expect(networkForCallsign("T9J-L2N")).toBeNull();
    expect(networkForCallsign("")).toBeNull();
  });

  it("is offered to the panel", () => {
    expect(CARRIER_NETWORKS.map((n) => n.key)).toContain("oasis");
  });
});

describe("filtering a carrier list to a network", () => {
  /*
    Its own user-data directory, because the first version of this test had none and quietly read the
    developer's real carrier cache -- it passed or failed depending on whose machine it ran on, and
    on whether that machine had pressed a button in the app.
  */
  let dir: string;
  const saved = process.env.EDEXO_USER_DATA_DIR;

  const HEADER =
    "Callsign,Name,Owner,LastUpdated,LastMoved,LastSystem,SystemAddress,Coord_X,Coord_Y,Coord_Z," +
    "SolDistance,EstimatedRegion,LocationHistory,DockingsEDDN,Services";
  const row = (callsign: string, name: string, x: number) =>
    `${callsign},${name},,"2026-09-19 00:00:00","2026-09-01 00:00:00",Somewhere,1,${x},0,0,${x},` +
    `Inner Orion Spur,3,1,"dock;vistagenomics"`;
  // Two members and a stranger. G8Q-9QN carries the file's shouting spelling; W5X-43H carries the
  // name that does not mention OASIS at all.
  const FILE = [
    HEADER,
    row("G8Q-9QN", "OASIS WIRRAL", 10),
    row("W5X-43H", "U.S.S KORRIBAN III", 20),
    row("T9J-L2N", "CRV Haruspex", 30),
  ].join("\n");

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "edexo-net-"));
    process.env.EDEXO_USER_DATA_DIR = dir;
    resetCarrierMemo();
    writeFileSync(resolveCarrierCachePath(), FILE, "utf8");
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.EDEXO_USER_DATA_DIR;
    else process.env.EDEXO_USER_DATA_DIR = saved;
    resetCarrierMemo();
    rmSync(dir, { recursive: true, force: true });
  });

  const origin = { x: 0, y: 0, z: 0 };

  it("narrows to the roster and leaves the stranger out", () => {
    const rows = queryCarriers({ origin, networkKey: "oasis" });
    expect(rows.map((r) => r.callsign)).toEqual(["G8Q-9QN", "W5X-43H"]);
    expect(queryCarriers({ origin }).map((r) => r.callsign)).toContain("T9J-L2N");
  });

  it("shows the roster's name, not the file's", () => {
    /*
      EDAstro holds these under four capitalisations -- "OASIS Surface Detail", "OASIS WIRRAL",
      "oasis uss DROMUND KAAS" -- and one with no prefix. The file's spelling is not a label worth
      putting on screen.
    */
    const rows = queryCarriers({ origin, networkKey: "oasis" });
    expect(rows.map((r) => r.name)).toEqual(["OASIS Wirral", "OASIS USS Korriban III"]);
  });

  it("tags a member even when the list is not filtered", () => {
    const wirral = queryCarriers({ origin }).find((r) => r.callsign === "G8Q-9QN")!;
    expect(wirral.network).toEqual({ key: "oasis", label: "OASIS", name: "OASIS Wirral" });
    const stranger = queryCarriers({ origin }).find((r) => r.callsign === "T9J-L2N")!;
    expect(stranger.network).toBeNull();
  });

  it("finds a member by its roster name in search, not only by callsign", () => {
    // "korriban" appears nowhere in EDAstro's row for W5X-43H other than through the roster name.
    expect(queryCarriers({ origin, search: "korriban" }).map((r) => r.callsign)).toEqual(["W5X-43H"]);
    expect(queryCarriers({ origin, search: "oasis" }).map((r) => r.callsign)).toEqual([
      "G8Q-9QN",
      "W5X-43H",
    ]);
  });

  it("the count agrees with the list", () => {
    // "N of M" is a lie the moment these apply different predicates, and both stay plausible.
    for (const q of [
      { origin, networkKey: "oasis" },
      { origin, networkKey: "oasis", services: ["vistagenomics"] },
      { origin, search: "oasis" },
    ]) {
      expect(countCarriers(q)).toBe(queryCarriers({ ...q, limit: 500 }).length);
    }
  });
});
