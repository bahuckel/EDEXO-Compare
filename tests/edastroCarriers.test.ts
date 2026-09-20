/**
 * The carrier file: parsing it, and the two ages that come out of it.
 *
 * Rows below are copied from the real `fleetcarriers.csv` rather than invented, because the shapes
 * that break a parser are the ones the file actually contains: quoted timestamps with a space in
 * them, an empty `Name`, an empty `Owner`, an empty `Services`, and rows with no coordinates at all
 * (49 of 90,293 on the 2026-09-19 file).
 *
 * The behaviour worth defending is in `queryCarriers`: **dwell is measured at the sighting, not
 * against now.** "It had sat still for 180 days when someone last looked" is a fact from the file;
 * "it has sat still for 215 days" would silently claim knowledge of the 35 days nobody watched.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseCarrierCsv,
  parseEdastroDate,
  queryCarriers,
  countCarriers,
  resetCarrierMemo,
  resolveCarrierCachePath,
  splitCsvLine,
} from "../src/server/edastroCarriers.js";

const HEADER =
  "Callsign,Name,Owner,LastUpdated,LastMoved,LastSystem,SystemAddress,Coord_X,Coord_Y,Coord_Z," +
  "SolDistance,EstimatedRegion,LocationHistory,DockingsEDDN,Services";

/** Sol-adjacent mover: seen today, moved today. */
const MOVER =
  'AAA-111,BUSY BEE,,"2026-09-20 00:00:00","2026-09-19 12:00:00",Alpha Centauri,1,4,0,0,4.4,' +
  'Inner Orion Spur,90,12,"dock;refuel;vistagenomics"';
/** Parked a long time, and the sighting is old — the row that should win on trust. */
const PARKED =
  'BBB-222,,,"2026-09-08 00:00:00","2026-03-01 00:00:00",Beagle Point,2,100,0,0,65269.8,' +
  'Elysian Shore,3,1,"dock;exploration;vistagenomics"';
/** No coordinates: unplaceable, and must not reach the panel at all. */
const NO_COORDS = 'CCC-333,GHOST,,"2026-01-01 00:00:00","2026-01-01 00:00:00",,,,,,0.00,,0,0,';
/** Empty services cell — a real value, and a row that must survive parsing. */
const BARE = 'DDD-444,,,"2026-09-19 00:00:00","2026-09-01 00:00:00",Sol,3,0,0,0,0,Inner Orion Spur,1,0,';

const FILE = [HEADER, MOVER, PARKED, NO_COORDS, BARE].join("\n");
/** Fixed "now" so ages are arithmetic rather than a clock reading. */
const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);

let dir: string;
const saved = process.env.EDEXO_USER_DATA_DIR;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-carriers-"));
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

describe("splitCsvLine", () => {
  it("keeps commas inside quoted fields", () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });

  it("reads a doubled quote as one quote", () => {
    expect(splitCsvLine('a,"say ""hi""",b')).toEqual(["a", 'say "hi"', "b"]);
  });

  it("keeps empty trailing fields, which the real file ends with", () => {
    // The Services cell is last and is often empty; dropping it would shift nothing but would make
    // the column count disagree with the header.
    expect(splitCsvLine("a,b,")).toEqual(["a", "b", ""]);
  });
});

describe("parseEdastroDate", () => {
  it("reads the space-separated form EDAstro writes, as UTC", () => {
    /*
      Not the machine's local zone. Reading these locally would shift every age in the panel by up
      to a day depending on where the commander lives, and a day matters when the median sighting
      out in the black is already 35 days old.
    */
    expect(parseEdastroDate("2026-09-11 23:17:58")).toBe(Date.UTC(2026, 8, 11, 23, 17, 58));
    expect(parseEdastroDate("2026-09-11T23:17:58")).toBe(Date.UTC(2026, 8, 11, 23, 17, 58));
  });

  it("returns null rather than a wrong date", () => {
    expect(parseEdastroDate("")).toBeNull();
    expect(parseEdastroDate(undefined)).toBeNull();
    expect(parseEdastroDate("not a date")).toBeNull();
  });
});

describe("parseCarrierCsv", () => {
  it("reads the placeable rows and drops the unplaceable one", () => {
    const rows = parseCarrierCsv(FILE);
    expect(rows.map((r) => r.callsign)).toEqual(["AAA-111", "BBB-222", "DDD-444"]);
  });

  it("keeps an empty name and an empty services cell", () => {
    const parked = parseCarrierCsv(FILE).find((r) => r.callsign === "BBB-222")!;
    expect(parked.name).toBe("");
    const bare = parseCarrierCsv(FILE).find((r) => r.callsign === "DDD-444")!;
    expect(bare.services).toEqual([]);
  });

  it("finds columns by header name, not by position", () => {
    /*
      The file belongs to somebody else. A column inserted upstream would, with fixed indices, shift
      every field by one and produce plausible garbage — coordinates read from SolDistance, services
      read from a docking count — rather than an error anybody would notice.
    */
    const swapped = FILE.replace(HEADER, HEADER.replace("Callsign,Name", "Name,Callsign")).replace(
      "AAA-111,BUSY BEE",
      "BUSY BEE,AAA-111",
    );
    const rows = parseCarrierCsv(swapped);
    expect(rows[0]!.callsign).toBe("AAA-111");
    expect(rows[0]!.name).toBe("BUSY BEE");
  });

  it("returns nothing for a body that is not this file", () => {
    // An error page or a redirect parses to zero rows, which is what lets the fetch keep the
    // previous good file instead of replacing it with HTML.
    expect(parseCarrierCsv("<!DOCTYPE html><html><body>nope</body></html>")).toEqual([]);
    expect(parseCarrierCsv("")).toEqual([]);
  });
});

describe("the file repeats carriers, and a callsign is unique", () => {
  /*
    152 callsigns appear more than once in the real 2026-09-19 file, up to three times. The rows are
    identical apart from Name -- the two below are T9J-L2N's actual pair, "CRV Haruspex" against
    "haruspex" -- so it is one carrier recorded twice. Left alone the panel lists it twice and React
    warns about a duplicate key, which is how this was found.
  */
  const DUPE_A =
    'T9J-L2N,CRV Haruspex,,"2026-08-21 04:31:09","2026-08-21 04:31:09",Kuelua RY-R d4-0,11902979755,' +
    '6746.78,-2251.44,13417.5,15186.09,Norma Expanse,304,358,"dock;vistagenomics"';
  const DUPE_B =
    'T9J-L2N,haruspex,,"2026-08-21 04:31:09","2026-08-21 04:31:09",Kuelua RY-R d4-0,11902979755,' +
    '6746.78,-2251.44,13417.5,15186.09,Norma Expanse,304,358,"dock;vistagenomics"';

  it("keeps one row per callsign", () => {
    const rows = parseCarrierCsv([HEADER, DUPE_A, DUPE_B].join("\n"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.callsign).toBe("T9J-L2N");
  });

  it("keeps the newest sighting when the copies disagree", () => {
    /*
      The older copy comes SECOND on purpose. Written the other way round this test passes against a
      parser with no rule at all -- plain last-wins picks the newer row by luck of file order -- and
      it did, until the sabotage check caught it. Ordered like this, only a parser that compares the
      timestamps keeps the right one.
    */
    const older = DUPE_B.replace("2026-08-21 04:31:09", "2026-01-01 00:00:00");
    const rows = parseCarrierCsv([HEADER, DUPE_A, older].join("\n"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("CRV Haruspex");
  });

  it("prefers a named copy over an unnamed one at the same timestamp", () => {
    const unnamed = DUPE_A.replace("CRV Haruspex", "");
    const rows = parseCarrierCsv([HEADER, unnamed, DUPE_B].join("\n"));
    expect(rows[0]!.name).toBe("haruspex");
  });
});

describe("queryCarriers", () => {
  const origin = { x: 0, y: 0, z: 0 };

  it("sorts by distance from the commander", () => {
    const rows = queryCarriers({ origin }, NOW);
    expect(rows.map((r) => r.callsign)).toEqual(["DDD-444", "AAA-111", "BBB-222"]);
    expect(rows[1]!.distanceLy).toBeCloseTo(4, 6);
  });

  it("measures dwell at the sighting, not against now", () => {
    /*
      THE ONE THAT MATTERS. BBB-222 was last seen on 2026-09-08 having last moved on 2026-03-01 —
      191 days of dwell — and "now" is twelve days later. Dwell must stay 191, not become 203: the
      extra twelve days are time nobody watched it, and claiming them would turn a fact from the
      file into a guess about an unobserved carrier.
    */
    const parked = queryCarriers({ origin }, NOW).find((r) => r.callsign === "BBB-222")!;
    expect(parked.dwellDays).toBe(191);
    expect(parked.lastSeenDays).toBe(12);
  });

  it("gives a mover a fresh sighting and a short dwell", () => {
    const mover = queryCarriers({ origin }, NOW).find((r) => r.callsign === "AAA-111")!;
    expect(mover.lastSeenDays).toBe(0);
    expect(mover.dwellDays).toBe(0);
  });

  it("filters on services, requiring all of them", () => {
    expect(queryCarriers({ origin, services: ["vistagenomics"] }, NOW).map((r) => r.callsign)).toEqual([
      "AAA-111",
      "BBB-222",
    ]);
    expect(
      queryCarriers({ origin, services: ["vistagenomics", "exploration"] }, NOW).map((r) => r.callsign),
    ).toEqual(["BBB-222"]);
  });

  it("hides sightings older than the age filter", () => {
    expect(queryCarriers({ origin, maxLastSeenDays: 7 }, NOW).map((r) => r.callsign)).toEqual([
      "DDD-444",
      "AAA-111",
    ]);
    // Zero means "any", which is the honest default: out in the black every sighting is old.
    expect(queryCarriers({ origin, maxLastSeenDays: 0 }, NOW)).toHaveLength(3);
  });

  it("lists without distances when no jump has been seen", () => {
    // A cold start has no commander position. The panel still works; it just cannot rank.
    const rows = queryCarriers({ origin: null }, NOW);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.distanceLy === null)).toBe(true);
  });

  it("counts every match, so the panel can say 'N of M'", () => {
    expect(countCarriers({ origin, services: ["vistagenomics"] }, NOW)).toBe(2);
    expect(queryCarriers({ origin, services: ["vistagenomics"], limit: 1 }, NOW)).toHaveLength(1);
  });

  it("answers nothing at all when no file has been fetched", () => {
    // The panel's opening state, and it must not throw: there is no cache until the button is pressed.
    rmSync(resolveCarrierCachePath(), { force: true });
    resetCarrierMemo();
    expect(queryCarriers({ origin }, NOW)).toEqual([]);
    expect(countCarriers({ origin }, NOW)).toBe(0);
  });
});
