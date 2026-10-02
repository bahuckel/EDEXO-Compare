/**
 * A foot-scan catalog that cannot be written (a full disk, a locked file) is kept in memory and
 * retried — no longer every 5 s for ever, re-serialising the whole catalog each time (plan 2.4,
 * Fable 8.4), but after 5 s, 10 s, 20 s … up to 5 min.
 */
import { describe, expect, it } from "vitest";
import { footCatalogRetryMs } from "../src/server/footScannedCatalog.js";

describe("retrying a catalog that could not be saved", () => {
  it("waits longer each time, up to five minutes", () => {
    expect([1, 2, 3, 4].map(footCatalogRetryMs)).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(footCatalogRetryMs(20)).toBe(300_000);
  });
});
