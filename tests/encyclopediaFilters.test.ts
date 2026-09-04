import { beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  activeEncyclopediaFilterChips,
  buildEncyclopediaFacetOptions,
  clearEncyclopediaFilter,
  defaultEncyclopediaFilters,
  ENC_FILTERS_ALL,
  rankEncyclopediaRows,
  type EncyclopediaFiltersState,
} from "../src/client/encyclopediaFilters.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import type { EncyclopediaSpeciesRowDTO } from "../src/shared/types.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The encyclopedia's own rows, minus the photo/exomastery decoration the filters never read. */
let rows: EncyclopediaSpeciesRowDTO[];

beforeAll(() => {
  const db = loadSpeciesDatabaseFromTree(projectRoot);
  rows = db.species.map((entry) => ({ entry }) as EncyclopediaSpeciesRowDTO);
});

describe("rankEncyclopediaRows", () => {
  it("returns every row and reports it is not searching when nothing is set", () => {
    const r = rankEncyclopediaRows(rows, defaultEncyclopediaFilters());
    expect(r.searching).toBe(false);
    expect(r.rows).toHaveLength(rows.length);
  });

  it("narrows on a facet without turning on search mode", () => {
    const f = { ...defaultEncyclopediaFilters(), planetClass: "Rocky body" };
    const r = rankEncyclopediaRows(rows, f);
    expect(r.searching).toBe(false);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.length).toBeLessThan(rows.length);
  });

  it("finds a species by a scattered query and puts it first", () => {
    const r = rankEncyclopediaRows(rows, { ...defaultEncyclopediaFilters(), search: "bacacies" });
    expect(r.searching).toBe(true);
    expect(r.rows[0]!.entry.displayName).toBe("Bacterium acies");
  });

  it("orders an exact name ahead of the rest of its genus", () => {
    const r = rankEncyclopediaRows(rows, {
      ...defaultEncyclopediaFilters(),
      search: "stratum tectonicas",
    });
    expect(r.rows[0]!.entry.displayName).toBe("Stratum tectonicas");
  });

  it("still applies the facets while searching", () => {
    const searchOnly = rankEncyclopediaRows(rows, { ...defaultEncyclopediaFilters(), search: "bacterium" });
    const withFacet = rankEncyclopediaRows(rows, {
      ...defaultEncyclopediaFilters(),
      search: "bacterium",
      volcanism: "REQUIRED",
    });
    expect(withFacet.rows.length).toBeLessThan(searchOnly.rows.length);
  });

  it("returns nothing for a query no species can satisfy", () => {
    const r = rankEncyclopediaRows(rows, { ...defaultEncyclopediaFilters(), search: "qqqzzz" });
    expect(r.rows).toHaveLength(0);
    expect(r.searching).toBe(true);
  });
});

describe("activeEncyclopediaFilterChips", () => {
  it("is empty when nothing is filtered", () => {
    expect(activeEncyclopediaFilterChips(defaultEncyclopediaFilters())).toEqual([]);
  });

  it("names each active filter and what it is set to", () => {
    const chips = activeEncyclopediaFilterChips({
      ...defaultEncyclopediaFilters(),
      planetClass: "Rocky body",
      volcanism: "REQUIRED",
      search: "  strat  ",
    });
    expect(chips.map((c) => c.key).sort()).toEqual(["planetClass", "search", "volcanism"]);
    expect(chips.find((c) => c.key === "planetClass")!.value).toBe("Rocky body");
    expect(chips.find((c) => c.key === "volcanism")!.value).toBe("Required");
    expect(chips.find((c) => c.key === "search")!.value).toBe("strat");
  });
});

describe("clearEncyclopediaFilter", () => {
  it("resets one filter and leaves the others alone", () => {
    const f = {
      ...defaultEncyclopediaFilters(),
      planetClass: "Rocky body",
      volcanism: "REQUIRED" as const,
    };
    const cleared = clearEncyclopediaFilter(f, "planetClass");
    expect(cleared.planetClass).toBe(ENC_FILTERS_ALL);
    expect(cleared.volcanism).toBe("REQUIRED");
  });

  it("round-trips the chips back to an unfiltered state", () => {
    let f: EncyclopediaFiltersState = {
      ...defaultEncyclopediaFilters(),
      planetClass: "Rocky body",
      volcanism: "REQUIRED",
      search: "strat",
    };
    for (const chip of activeEncyclopediaFilterChips(f)) f = clearEncyclopediaFilter(f, chip.key);
    expect(activeEncyclopediaFilterChips(f)).toEqual([]);
    expect(rankEncyclopediaRows(rows, f).rows).toHaveLength(rows.length);
  });
});

describe("buildEncyclopediaFacetOptions", () => {
  it("offers only values that some row actually has", () => {
    const facets = buildEncyclopediaFacetOptions(rows);
    expect(facets.planetClasses.length).toBeGreaterThan(0);
    for (const pc of facets.planetClasses) {
      const f = { ...defaultEncyclopediaFilters(), planetClass: pc };
      expect(rankEncyclopediaRows(rows, f).rows.length).toBeGreaterThan(0);
    }
  });
});
