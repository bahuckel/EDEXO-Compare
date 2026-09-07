/**
 * Spansh exobiology route exports, both formats, against the owner's real files.
 *
 * Asked for 2026-09-07: a way to feed a Spansh export from inside the app. Spansh offers the same
 * route as CSV and as JSON, and the question of which to work with has a measured answer.
 *
 * The two formats agree exactly on the landmark rows — 342 each for home-to-Colonia, with **zero**
 * rows in one and not the other — so nothing is lost by preferring either. But the JSON also carries
 * system coordinates and `id64`, and a body `id64` for every body, and those are the two things the
 * corpus has repeatedly had to fetch from EDSM afterwards. On the same file that is 258 systems
 * placed and 326 bodies identified for free.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bodyIdFromId64Pair,
  parseSpanshRouteFile,
  summariseSpanshRouteFile,
} from "../src/feeder/spanshRouteFile.js";

const dumps = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "spansh-dump-tests",
);
const read = (name: string) => readFileSync(path.join(dumps, name), "utf8");

const COLONIA_CSV = "exobiology-home-to-colonia.csv";
const COLONIA_JSON = "exobiology-home-to-colonia.json";

describe("the body id falls out of the id64 pair", () => {
  /** `bodyId64 == systemId64 + (bodyId << 55)`, verified across 17,830 Spansh bodies at 100 %. */
  it("recovers the in-system BodyID", () => {
    expect(bodyIdFromId64Pair("16065459136041", "432361629686703657")).toBe(12);
    expect(bodyIdFromId64Pair("16065459136041", "16065459136041")).toBe(0);
  });

  it("refuses a pair that cannot be from the same system", () => {
    // Body id below the system id: not a shift of anything.
    expect(bodyIdFromId64Pair("432361629686703657", "16065459136041")).toBeNull();
    // A shift far past any real body count is two unrelated systems, not a body 300 million.
    expect(bodyIdFromId64Pair("1", "999999999999999999999999")).toBeNull();
    expect(bodyIdFromId64Pair("not-a-number", "12")).toBeNull();
  });
});

describe("both formats, same route", () => {
  it("agree on every landmark row", () => {
    const csv = parseSpanshRouteFile(read(COLONIA_CSV));
    const json = parseSpanshRouteFile(read(COLONIA_JSON));
    const key = (r: { systemName: string; bodyName: string; landmarkSubtype: string }) =>
      `${r.systemName}|${r.bodyName}|${r.landmarkSubtype}`;
    const a = new Set(csv.rows.map(key));
    const b = new Set(json.rows.map(key));
    expect(a.size).toBeGreaterThan(300);
    expect([...a].filter((k) => !b.has(k))).toEqual([]);
    expect([...b].filter((k) => !a.has(k))).toEqual([]);
  });

  /** The whole reason to prefer the JSON. */
  it("only the JSON can place a system or identify a body", () => {
    const csv = summariseSpanshRouteFile(parseSpanshRouteFile(read(COLONIA_CSV)));
    const json = summariseSpanshRouteFile(parseSpanshRouteFile(read(COLONIA_JSON)));

    expect(csv.format).toBe("csv");
    expect(csv.systemsWithCoords).toBe(0);
    expect(csv.bodiesWithId).toBe(0);

    expect(json.format).toBe("json");
    expect(json.systemsWithCoords).toBeGreaterThan(250);
    // Every body in the file, not merely most of them.
    expect(json.bodiesWithId).toBe(json.bodies);
    expect(json.source).toBe("Swoilz KI-E b4-9");
    expect(json.destination).toBe("Colonia");
  });

  it("tells the reader the CSV is the poorer input rather than accepting it silently", () => {
    const csv = parseSpanshRouteFile(read(COLONIA_CSV));
    expect(csv.warnings.join(" ")).toMatch(/coordinates/i);
  });
});

describe("summarising a file", () => {
  it("counts species, genera and the busiest rows", () => {
    const s = summariseSpanshRouteFile(parseSpanshRouteFile(read(COLONIA_JSON)));
    expect(s.rows).toBe(342);
    expect(s.species).toBe(15);
    expect(s.genera).toBeGreaterThan(3);
    expect(s.topSpecies.length).toBeGreaterThan(0);
    expect(s.topSpecies[0]!.rows).toBeGreaterThanOrEqual(s.topSpecies.at(-1)!.rows);
  });

  it("reads the second route too, so the first is not a fluke", () => {
    const s = summariseSpanshRouteFile(parseSpanshRouteFile(read("exobiology-home-to-sagA.json")));
    expect(s.destination).toBe("Sagittarius A*");
    expect(s.bodiesWithId).toBe(s.bodies);
  });
});

describe("refusing what it cannot read", () => {
  it("names the formats it wants rather than parsing nonsense", () => {
    expect(() => parseSpanshRouteFile("hello,world\n1,2\n")).toThrow(/Spansh exobiology route/i);
  });

  it("rejects JSON that is not a route export", () => {
    expect(() => parseSpanshRouteFile('{"something":1}')).toThrow(/result/i);
  });

  /** A body with no landmarks is a waypoint, not a find: counted and skipped, never invented. */
  it("skips bodies with no landmarks and says how many", () => {
    const doc = {
      result: [
        {
          name: "Test",
          id64: "1",
          x: 0,
          y: 0,
          z: 0,
          bodies: [{ name: "Test 1", id64: "1", landmarks: [] }],
        },
      ],
    };
    const f = parseSpanshRouteFile(JSON.stringify(doc));
    expect(f.rows).toEqual([]);
    expect(f.bodies).toHaveLength(1);
    expect(f.warnings.join(" ")).toMatch(/no landmarks/i);
  });

  it("keeps a system that has coordinates but no bodies", () => {
    const doc = { result: [{ name: "Start", id64: "1", x: 1, y: 2, z: 3, bodies: [] }] };
    const f = parseSpanshRouteFile(JSON.stringify(doc));
    expect(f.systems).toHaveLength(1);
    expect(f.rows).toEqual([]);
  });
});
