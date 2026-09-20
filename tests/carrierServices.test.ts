/**
 * Carrier service keys, and the one that does not say what it means.
 *
 * EDAstro publishes the game's own service keys. Almost all of them read like their in-game names,
 * and **one does not**: the service a commander knows as *Universal Cartographics* is spelled
 * `exploration`. Counted across all 90,244 placed carriers in the 2026-09-19 file there are
 * **zero** `universalcartographics` and **23,498** `exploration` (26.0 %).
 *
 * That is the failure this file exists to stop, and it is a quiet one: a filter matching the obvious
 * spelling returns an empty list, which reads as "no carriers near you" rather than as a bug.
 */
import { describe, expect, it } from "vitest";
import {
  CARRIER_SERVICE_OPTIONS,
  carrierHasServices,
  carrierServiceLabel,
  parseCarrierServices,
} from "../src/shared/carrierServices.js";

const REAL_ROW =
  "commodities;contacts;crewlounge;dock;engineer;exploration;livery;outfitting;pioneersupplies;" +
  "rearm;refuel;repair;shipyard;socialspace;squadronBank;vistagenomics";

describe("the Universal Cartographics trap", () => {
  it("offers Universal Cartographics under the key EDAstro actually publishes", () => {
    const uc = CARRIER_SERVICE_OPTIONS.find((o) => o.label === "Universal Cartographics");
    expect(uc?.key).toBe("exploration");
  });

  it("never offers the spelling that matches nothing in the galaxy", () => {
    // 0 of 90,244 carriers carry this key. A filter on it is an empty panel, not a narrow one.
    expect(CARRIER_SERVICE_OPTIONS.map((o) => o.key)).not.toContain("universalcartographics");
  });

  it("matches a real carrier row on it", () => {
    const services = parseCarrierServices(REAL_ROW);
    expect(carrierHasServices(services, ["exploration"])).toBe(true);
    expect(carrierHasServices(services, ["universalcartographics"])).toBe(false);
  });
});

describe("parseCarrierServices", () => {
  it("splits on semicolons and trims", () => {
    expect(parseCarrierServices("dock; refuel ;repair")).toEqual(["dock", "refuel", "repair"]);
  });

  it("treats an empty cell as no services, which is a real value", () => {
    // 29,000-odd rows carry an empty Services cell — a carrier nobody has reported the fit of.
    expect(parseCarrierServices("")).toEqual([]);
    expect(parseCarrierServices(null)).toEqual([]);
    expect(parseCarrierServices(undefined)).toEqual([]);
  });
});

describe("carrierHasServices", () => {
  it("requires every wanted service, not any of them", () => {
    /*
      AND, deliberately. A commander asking for Vista Genomics and Refuel wants one stop that does
      both; OR would answer with a carrier that does neither of the pair they care about and looks
      like a match.
    */
    const services = parseCarrierServices(REAL_ROW);
    expect(carrierHasServices(services, ["vistagenomics", "refuel"])).toBe(true);
    expect(carrierHasServices(services, ["vistagenomics", "bartender"])).toBe(false);
  });

  it("passes everything when nothing is selected", () => {
    expect(carrierHasServices([], [])).toBe(true);
    expect(carrierHasServices(["dock"], [])).toBe(true);
  });

  it("does not match a service by prefix", () => {
    // "refuel" must not be satisfied by "refuelling", nor "dock" by "dockingAccess".
    expect(carrierHasServices(["refuelling"], ["refuel"])).toBe(false);
  });
});

describe("carrierServiceLabel", () => {
  it("names the offered keys and passes anything else through", () => {
    expect(carrierServiceLabel("vistagenomics")).toBe("Vista Genomics");
    expect(carrierServiceLabel("exploration")).toBe("Universal Cartographics");
    expect(carrierServiceLabel("blackmarket")).toBe("blackmarket");
  });
});
