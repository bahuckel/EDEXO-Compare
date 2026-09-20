/**
 * Folding two catalogue vocabularies into one filter row.
 *
 * `/gec/json/combined` merges the Galactic Exploration Catalog's prose type names with the Galactic
 * Mapping Project's camelCase codes. Forty-one distinct values, many of them saying the same thing
 * twice — "Nebulae" beside `nebula` beside `planetaryNebula`.
 *
 * The behaviour worth defending is that **nothing falls out of the catalogue**. A type this map has
 * never seen must still land in a group and still print a readable label, because this is somebody
 * else's data and it gains categories without telling us.
 */
import { describe, expect, it } from "vitest";
import { POI_GROUP_OPTIONS, poiGroup, poiIsOrganic, poiTypeLabel } from "../src/shared/gecCategories.js";

/** Every type in the 2026-09-20 feed, with its count, so a mapping gap is visible as a number. */
const FEED_TYPES: ReadonlyArray<readonly [string, number]> = [
  ["Sights and Scenery", 190],
  ["Planetary Features", 140],
  ["Stellar Features", 73],
  ["Green Gas Giants", 61],
  ["Nebulae", 46],
  ["Notable Stellar Phenomena", 31],
  ["Organic", 26],
  ["Deep Space Outpost", 17],
  ["Mystery and Xenology", 15],
  ["Tourist Beacons", 9],
  ["Community", 9],
  ["Inhabited System", 7],
  ["Glitches", 7],
  ["Historical", 5],
  ["Memorials", 5],
  ["Planetary Circumnavigation", 1],
  ["minorPOI", 472],
  ["planetaryNebula", 368],
  ["planetFeatures", 253],
  ["nebula", 219],
  ["stellarRemnant", 158],
  ["jumponiumRichSystem", 76],
  ["starCluster", 73],
  ["independentOutpost", 66],
  ["region", 64],
  ["historicalLocation", 61],
  ["blackHole", 57],
  ["mysteryPOI", 47],
  ["deepSpaceOutpost", 41],
  ["geyserPOI", 33],
  ["regional", 29],
  ["surfacePOI", 23],
  ["restrictedSectors", 22],
  ["organicPOI", 16],
  ["minorRoute", 15],
  ["pulsar", 14],
  ["neutronRoute", 7],
  ["travelRoute", 4],
  ["historicalRoute", 4],
  ["settlement", 1],
];

describe("every type in the live feed is mapped", () => {
  it("puts none of them in Other", () => {
    /*
      "Other" is the safety net for a category added upstream, not a place for things that exist
      today. A type landing there is a row the commander can only reach by turning every chip off,
      and with `minorPOI` at 472 that would be a sixth of the catalogue hiding behind no label.
    */
    const unmapped = FEED_TYPES.filter(([t]) => poiGroup(t) === "other");
    expect(unmapped).toEqual([]);
  });

  it("gives all of them a readable label", () => {
    for (const [type] of FEED_TYPES) {
      const label = poiTypeLabel(type);
      expect(label.length).toBeGreaterThan(0);
      // camelCase must not reach the screen as camelCase.
      expect(label).not.toMatch(/^[a-z]+[A-Z]/);
    }
  });

  it("offers a chip for every group the feed actually uses", () => {
    const used = new Set(FEED_TYPES.map(([t]) => poiGroup(t)));
    const offered = new Set<string>(POI_GROUP_OPTIONS.map((o) => o.key));
    expect([...used].filter((g) => !offered.has(g))).toEqual([]);
  });
});

describe("organic, which is the point of this panel", () => {
  it("unites the two catalogues' spellings", () => {
    // 26 GEC "Organic" and 16 GMP "organicPOI". Split across two chips they would read as two small
    // categories rather than one worth filtering to.
    expect(poiIsOrganic("Organic")).toBe(true);
    expect(poiIsOrganic("organicPOI")).toBe(true);
    expect(poiGroup("Organic")).toBe("organic");
    expect(poiGroup("organicPOI")).toBe("organic");
  });

  it("counts a row whose second category is organic", () => {
    /*
      GEC rows carry two categories and some are only organic on the second — the count goes from 42
      to 53 once `type2` is read. A body worth landing on to look at a plant is worth listing whether
      or not the catalogue filed it under scenery first.
    */
    expect(poiIsOrganic("Planetary Features", "Organic")).toBe(true);
    expect(poiGroup("Planetary Features", "Organic")).toBe("planetary");
  });

  it("does not call everything organic", () => {
    expect(poiIsOrganic("blackHole")).toBe(false);
    expect(poiIsOrganic("Nebulae", "Stellar Features")).toBe(false);
    expect(poiIsOrganic("")).toBe(false);
  });
});

describe("a category the map has never seen", () => {
  it("lands in Other rather than vanishing", () => {
    expect(poiGroup("somethingNewUpstream")).toBe("other");
  });

  it("still prints as words", () => {
    expect(poiTypeLabel("somethingNewUpstream")).toBe("Something New Upstream");
    expect(poiTypeLabel("Some New Category")).toBe("Some New Category");
  });

  it("never returns an empty label, because one row in the feed has no type at all", () => {
    expect(poiTypeLabel("")).toBe("Unclassified");
    expect(poiTypeLabel(null)).toBe("Unclassified");
    expect(poiTypeLabel(undefined)).toBe("Unclassified");
  });
});
