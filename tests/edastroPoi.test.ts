/**
 * Parsing and querying the Galactic Exploration Catalog.
 *
 * Rows below are copied from the live `/gec/json/combined` feed rather than invented, because the
 * shapes that break a parser are the ones it actually contains: two catalogues in one array, a GMP
 * row with no rating, no region and no summary, and ids that collide across the two.
 *
 * Three behaviours are defended here, all of which fail silently if broken:
 *
 * - `id` is not unique. 551 ids appear in both catalogues; the key must be `source:id`.
 * - An unrated POI passes a rating floor. Only 643 of 2,766 rows carry a rating, so treating absent
 *   as zero would delete three quarters of the catalogue behind a filter that looks reasonable.
 * - The list and the count apply the same predicate, or "N of M" is a lie nothing notices.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countPoi,
  parsePoiJson,
  queryPoi,
  resetPoiMemo,
  resolvePoiCachePath,
} from "../src/server/edastroPoi.js";

/** GEC: curated, rated, has a region and a summary. Organic on its first category. */
const GEC_ORGANIC = {
  id: 254,
  source: "GEC",
  type: "Organic",
  type2: "Planetary Features",
  name: "Black Sage Fields",
  galMapSearch: "Eoch Flyi AA-A g167",
  region: "Inner Orion Spur",
  coordinates: [100, 0, 0],
  summary: "Considerable variety of bio signs.",
  rating: 8.2,
  poiUrl: "https://edastro.com/gec/view/254",
};
/** GEC: organic only on its SECOND category. 11 rows of the feed are like this. */
const GEC_SECONDARY_ORGANIC = {
  id: 900,
  source: "GEC",
  type: "Sights and Scenery",
  type2: "Organic",
  name: "Quiet Meadow",
  galMapSearch: "Somewhere AB-C d1",
  region: "Norma Expanse",
  coordinates: [200, 0, 0],
  summary: "",
  rating: 4.0,
  poiUrl: "https://edastro.com/gec/view/900",
};
/** GMP: the thin shape. No rating, no region, no summary, camelCase type, and id 254 again. */
const GMP_COLLIDING_ID = {
  id: "254",
  source: "GMP",
  type: "planetaryNebula",
  name: "Athaip Wisteria Nebula",
  galMapSearch: "Athaip DW-N e6-3063",
  coordinates: [50, 0, 0],
  galMapUrl: "https://www.edsm.net/en/system/id/645310",
};
/** GMP organic, so the Organic chip has to reach across both catalogues. */
const GMP_ORGANIC = {
  id: "77",
  source: "GMP",
  type: "organicPOI",
  name: "Brain Tree Forest",
  galMapSearch: "Far Out XY-Z d9",
  coordinates: [400, 0, 0],
  galMapUrl: "https://www.edsm.net/en/system/id/1",
};

const FEED = JSON.stringify([GEC_ORGANIC, GEC_SECONDARY_ORGANIC, GMP_COLLIDING_ID, GMP_ORGANIC]);
const origin = { x: 0, y: 0, z: 0 };

let dir: string;
const saved = process.env.EDEXO_USER_DATA_DIR;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-poi-"));
  process.env.EDEXO_USER_DATA_DIR = dir;
  resetPoiMemo();
  writeFileSync(resolvePoiCachePath(), FEED, "utf8");
});

afterEach(() => {
  if (saved === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = saved;
  resetPoiMemo();
  rmSync(dir, { recursive: true, force: true });
});

describe("parsePoiJson", () => {
  it("reads both catalogues out of one array", () => {
    const rows = parsePoiJson(FEED);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.source)).toEqual(["GEC", "GEC", "GMP", "GMP"]);
  });

  it("keeps two rows that share an id across the catalogues", () => {
    /*
      THE ONE THAT MATTERS. 551 ids appear in both GEC and GMP. Keyed on `id` alone this feed loses
      one of them, and it loses a different one depending on array order -- a POI missing from a
      catalogue nobody can count in their head.
    */
    const rows = parsePoiJson(FEED);
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("GEC:254");
    expect(keys).toContain("GMP:254");
    expect(new Set(keys).size).toBe(4);
  });

  it("reads the thin GMP shape without inventing values", () => {
    const gmp = parsePoiJson(FEED).find((r) => r.key === "GMP:254")!;
    expect(gmp.rating).toBeNull();
    expect(gmp.region).toBe("");
    expect(gmp.summary).toBe("");
    expect(gmp.typeLabel).toBe("Planetary nebula");
    expect(gmp.url).toBe("https://www.edsm.net/en/system/id/645310");
  });

  it("prefers the POI's own page over the galaxy-map link", () => {
    const gec = parsePoiJson(FEED).find((r) => r.key === "GEC:254")!;
    expect(gec.url).toBe("https://edastro.com/gec/view/254");
  });

  it("drops an entry with no usable coordinates", () => {
    const broken = JSON.stringify([{ id: 1, source: "GEC", name: "x", coordinates: "nope" }]);
    expect(parsePoiJson(broken)).toEqual([]);
  });

  it("returns nothing for a body that is not this feed", () => {
    // An error page must leave the previous catalogue in place rather than replacing it with HTML.
    expect(parsePoiJson("<!DOCTYPE html><html></html>")).toEqual([]);
    expect(parsePoiJson("")).toEqual([]);
    expect(parsePoiJson("{}")).toEqual([]);
  });
});

describe("queryPoi", () => {
  it("sorts by distance from the commander", () => {
    expect(queryPoi({ origin }).map((r) => r.name)).toEqual([
      "Athaip Wisteria Nebula",
      "Black Sage Fields",
      "Quiet Meadow",
      "Brain Tree Forest",
    ]);
  });

  it("finds organic across both catalogues, including a secondary category", () => {
    const names = queryPoi({ origin, organicOnly: true }).map((r) => r.name);
    expect(names).toEqual(["Black Sage Fields", "Quiet Meadow", "Brain Tree Forest"]);
  });

  it("filters by group", () => {
    expect(queryPoi({ origin, groups: ["nebulae"] }).map((r) => r.name)).toEqual(["Athaip Wisteria Nebula"]);
    // The secondary-organic row is filed under scenery by its first category, which is where a
    // commander browsing scenery would expect to meet it.
    expect(queryPoi({ origin, groups: ["scenery"] }).map((r) => r.name)).toEqual(["Quiet Meadow"]);
  });

  it("keeps unrated entries when a rating floor is set", () => {
    /*
      The trap. Only the GEC rows are rated; the 2,123 GMP ones have none. If absent counted as zero,
      pressing "7+ rated" would delete three quarters of the catalogue, and the panel would say
      "nothing out here" when it means "this filter cannot see them".
    */
    const names = queryPoi({ origin, minRating: 7 }).map((r) => r.name);
    expect(names).toContain("Athaip Wisteria Nebula"); // unrated, kept
    expect(names).toContain("Brain Tree Forest"); // unrated, kept
    expect(names).toContain("Black Sage Fields"); // 8.2, kept
    expect(names).not.toContain("Quiet Meadow"); // 4.0, below the floor
  });

  it("searches name, system, region, type and summary", () => {
    expect(queryPoi({ origin, search: "wisteria" }).map((r) => r.name)).toEqual(["Athaip Wisteria Nebula"]);
    expect(queryPoi({ origin, search: "norma" }).map((r) => r.name)).toEqual(["Quiet Meadow"]);
    expect(queryPoi({ origin, search: "bio signs" }).map((r) => r.name)).toEqual(["Black Sage Fields"]);
    // ANDed across fields, as everywhere else in the app.
    expect(queryPoi({ origin, search: "nebula athaip" })).toHaveLength(1);
    expect(queryPoi({ origin, search: "nebula colonia" })).toHaveLength(0);
  });

  it("lists without distances when no jump has been seen", () => {
    const rows = queryPoi({ origin: null });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.distanceLy === null)).toBe(true);
  });

  it("answers nothing when the catalogue was never fetched", () => {
    rmSync(resolvePoiCachePath(), { force: true });
    resetPoiMemo();
    expect(queryPoi({ origin })).toEqual([]);
    expect(countPoi({ origin })).toBe(0);
  });
});

describe("countPoi", () => {
  it("agrees with the list under every filter", () => {
    // "N of M" is a lie the moment these two disagree, and both numbers stay plausible either way.
    for (const q of [
      { origin },
      { origin, organicOnly: true },
      { origin, groups: ["nebulae"] },
      { origin, minRating: 7 },
      { origin, search: "nebula" },
    ]) {
      expect(countPoi(q)).toBe(queryPoi({ ...q, limit: 500 }).length);
    }
  });
});
