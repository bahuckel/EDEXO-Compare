/**
 * Every species the app can predict has a price the sell range can use (combined plan 1.8,
 * 2026-10-01). The sell range prices strictly (no substring match), and the list had genus rows only
 * for Brain Tree and Sinuous Tubers: a body whose candidates were brain trees got no sell range at
 * all, and a mixed body's range was too low, while the cards (which match loosely) showed 1.59 M.
 */
import { describe, expect, it } from "vitest";
import { getProjectRoot } from "../src/server/paths.js";
import { loadPriceList, lookupPriceStrict } from "../src/server/priceList.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";

describe("price list", () => {
  it("prices every species in the database strictly", () => {
    const idx = loadPriceList(getProjectRoot());
    const db = loadSpeciesDatabase();
    const missing = db.species.filter((e) => lookupPriceStrict(idx, e.displayName, e.id) === null).map((e) => e.displayName);
    expect(missing).toEqual([]);
  });
});
