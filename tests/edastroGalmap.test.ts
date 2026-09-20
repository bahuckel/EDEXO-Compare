/**
 * Reading EDAstro's galaxy-map marker feed.
 *
 * This is the undocumented data behind their map, and it is the only source that knew
 * `OASIS Vera Rubin [N8Q-72B]` had jumped — the daily CSV and Spansh both still had the previous
 * system, from the same EDDN event. Every marker below is copied verbatim from the live feed on
 * 2026-09-20, because the risk here is entirely in the parsing: the label is prose written for a
 * map popup, not for a reader.
 *
 * What must hold:
 *
 * - An unparseable marker yields **nothing**, never a guess. A wrong system name on this panel is a
 *   commander flying thousands of light years to the wrong place.
 * - A cluster pin is **nobody's position**. 213 markers hold 767 carriers between them at a shared
 *   point, and reporting that point as a carrier's location would be confidently wrong.
 * - The **network layer wins** over the recent-carriers layer. N8Q-72B appears on both — OASIS with
 *   the new system, plain `carrier` with the stale one — so whichever is read second must not
 *   overwrite the better answer.
 */
import { describe, expect, it } from "vitest";
import { addMarkerToIndex, parseGalmapMarker } from "../src/server/edastroGalmap.js";
import type { GalmapCarrier } from "../src/server/edastroGalmap.js";

/** POI1.json, the OASIS layer. The row that started all of this. */
const OASIS_VERA_RUBIN = [
  "21685.13",
  "17338.5",
  "-99.25",
  "-13023.5",
  "OASIS Vera Rubin [N8Q-72B]\nEORGH HYPA RR-U C19-0\nOasis Carrier\nServices: Vista Genomics, Universal Cartography, Refuel, Repair, Rearm, Redemption Office, Pioneer Supplies",
  "OASIScarrier",
];
/** POI2.json, the recent-carriers layer: the same carrier, the old system. */
const PLAIN_VERA_RUBIN = [
  "20085.44",
  "10938.9",
  "35.375",
  "-16845.3",
  "OASIS VERA RUBIN [N8Q-72B]\nLyed XJ-I d9-0\nDockingPermit: ALL\n(bartender, UC, pioneersupplies, rearm, refuel, repair, socialspace, vistagenomics, redemption)",
  "carrier",
];
/** A cluster pin: several carriers, one position that belongs to none of them. */
const CLUSTER = [
  "502.49",
  "500",
  "0",
  "-50",
  "Multiple Fleet Carriers\n\nEidolons Whisper II [WBV-42J] -- IC 2391 Sector BA-A d34\nDockingPermit: UNKNOWN\n(bartender, pioneersupplies, rearm, refuel, repair, socialspace, redemption)\n\nBATTLESTAR GALACTICA [XHY-8KM] -- Synuefe BN-H d11-11\nDockingPermit: UNKNOWN\n(bartender, UC, rearm, refuel, repair, shipyard, socialspace, vistagenomics, redemption)\n",
  "carrier",
];
/** A DSSA marker: the name line carries a deployment number and a region in brackets. */
const DSSA = [
  "6234.94",
  "6233.66",
  "-54.5625",
  "-113.688",
  "DSSA Artemis Rest [K1B-75W] #35.02.001 (Outer Orion Spur)\nSynuefuae CM-J d10-42\n(Refuel, Repair, Armoury, Shipyard, UC)\n(DSSA Fleet Carrier)",
  "DSSAcarrier",
];
/** Not a carrier at all. The feed is mostly scenery — 5,838 planetary nebulae alone. */
const NEBULA = ["9.88", "2.1875", "6.625", "-7", "Orunmilla\nDuamta\n(Megaship)", "megaship"];

describe("parsing one marker", () => {
  it("reads a network carrier, with its position and network", () => {
    const [c] = parseGalmapMarker(OASIS_VERA_RUBIN);
    expect(c).toMatchObject({
      callsign: "N8Q-72B",
      name: "OASIS Vera Rubin",
      system: "EORGH HYPA RR-U C19-0",
      network: "OASIS",
    });
    // [solDistance, x, y, z] — the first field is not a coordinate.
    expect(c!.x).toBeCloseTo(17338.5, 3);
    expect(c!.z).toBeCloseTo(-13023.5, 3);
  });

  it("strips a DSSA deployment number off the name", () => {
    const [c] = parseGalmapMarker(DSSA);
    expect(c).toMatchObject({
      callsign: "K1B-75W",
      name: "DSSA Artemis Rest",
      system: "Synuefuae CM-J d10-42",
      network: "DSSA",
    });
  });

  it("ignores everything that is not a carrier", () => {
    expect(parseGalmapMarker(NEBULA)).toEqual([]);
  });
});

describe("cluster pins, which are nobody's position", () => {
  it("returns every carrier in the pin", () => {
    const cs = parseGalmapMarker(CLUSTER);
    expect(cs.map((c) => c.callsign)).toEqual(["WBV-42J", "XHY-8KM"]);
    expect(cs[1]!.system).toBe("Synuefe BN-H d11-11");
  });

  it("gives none of them coordinates", () => {
    /*
      THE ONE THAT MATTERS HERE. The pin sits at (500, 0, -50); the two carriers are in IC 2391 and
      Synuefe, thousands of light years apart. Handing that pin back as either carrier's position is
      a confidently wrong distance on a panel people fly on. 767 of the feed's carriers are in one
      of these.
    */
    for (const c of parseGalmapMarker(CLUSTER)) {
      expect(c.x).toBeNull();
      expect(c.y).toBeNull();
      expect(c.z).toBeNull();
    }
  });
});

describe("failing to nothing", () => {
  it("skips a marker with no callsign in its label", () => {
    expect(parseGalmapMarker(["1", "2", "3", "4", "Some Carrier\nSomewhere", "carrier"])).toEqual([]);
  });

  it("skips a carrier marker with no system line", () => {
    // Without a system there is nothing this panel can say, and the name alone is not an answer.
    expect(parseGalmapMarker(["1", "2", "3", "4", "Thing [ABC-123]", "carrier"])).toEqual([]);
  });

  it("survives every shape that is not a marker", () => {
    // The feed also contains 216 five-element entries; a format change upstream must cost nothing.
    expect(parseGalmapMarker(null)).toEqual([]);
    expect(parseGalmapMarker({})).toEqual([]);
    expect(parseGalmapMarker([])).toEqual([]);
    expect(parseGalmapMarker(["1", "2", "3", "4", "short"])).toEqual([]);
    expect(parseGalmapMarker(["1", "2", "3", "4", 42, "carrier"])).toEqual([]);
  });

  it("does not mistake a nearby bracket for a callsign", () => {
    const [c] = parseGalmapMarker([
      "1",
      "2",
      "3",
      "4",
      "/Cifc/ Sostratos Depot [H1Z-65B]\nGludgae RM-W d1-29\nStatus: High Reserves",
      "STARgreen",
    ]);
    expect(c).toMatchObject({ callsign: "H1Z-65B", name: "/Cifc/ Sostratos Depot", network: "STAR" });
  });
});

describe("the same carrier on two layers", () => {
  it("both parse, and they disagree — which is the whole point", () => {
    const [network] = parseGalmapMarker(OASIS_VERA_RUBIN);
    const [plain] = parseGalmapMarker(PLAIN_VERA_RUBIN);
    expect(network!.callsign).toBe(plain!.callsign);
    expect(network!.system).not.toBe(plain!.system);
    expect(network!.network).toBe("OASIS");
    expect(plain!.network).toBeNull();
  });

  it("keeps the network answer whichever file is read first", () => {
    /*
      THE ONE THAT MATTERS. The OASIS layer is in POI1 and the recent-carriers layer in POI2, so the
      plain entry is read second and would win on last-write. That would discard the only correct
      answer in the whole feed, silently, on the exact case this feature was built for — and the row
      would look entirely plausible while pointing at a system the carrier left two days earlier.
    */
    for (const order of [
      [OASIS_VERA_RUBIN, PLAIN_VERA_RUBIN],
      [PLAIN_VERA_RUBIN, OASIS_VERA_RUBIN],
    ]) {
      const index = new Map<string, GalmapCarrier>();
      for (const m of order) addMarkerToIndex(index, m);
      expect(index.get("N8Q-72B")).toMatchObject({
        system: "EORGH HYPA RR-U C19-0",
        network: "OASIS",
      });
      expect(index.size).toBe(1);
    }
  });

  it("keeps the first of two plain entries, so file order still means something", () => {
    const other = [...PLAIN_VERA_RUBIN];
    other[4] = "OASIS VERA RUBIN [N8Q-72B]\nSomewhere Else AB-C d1\nDockingPermit: ALL";
    const index = new Map<string, GalmapCarrier>();
    addMarkerToIndex(index, PLAIN_VERA_RUBIN);
    addMarkerToIndex(index, other);
    expect(index.get("N8Q-72B")!.system).toBe("Lyed XJ-I d9-0");
  });
});
