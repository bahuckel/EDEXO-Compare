/**
 * The query string the Carriers panel sends, parsed in one place.
 *
 * **This file exists because the OASIS filter shipped as a chip that did nothing.** The client sent
 * `?network=oasis`, the route never read it, and the whole suite passed — every carrier test called
 * `queryCarriers` directly, so nothing exercised the layer that was broken. A test asserting
 * something production never does, which is the recurring trap in this project.
 *
 * The parser is the contract between the panel's query string and {@link CarrierQuery}. Every filter
 * the panel can send is checked here, so adding one to the client and forgetting the server is a
 * failing test rather than a dead control.
 */
import { describe, expect, it } from "vitest";
import { parseCarrierQueryParams } from "../src/server/edastroCarriers.js";

const origin = { x: 1, y: 2, z: 3 };

/** Exactly the parameter names `CarriersModal.tsx` puts on the wire. */
const PANEL_SENDS = ["services", "maxLastSeenDays", "dssaOnly", "network", "q", "limit"] as const;

describe("every filter the panel sends reaches the query", () => {
  it("parses all of them at once", () => {
    const q = parseCarrierQueryParams(
      {
        services: "vistagenomics,exploration",
        maxLastSeenDays: "30",
        dssaOnly: "1",
        network: "oasis",
        q: "dssa trojan",
        limit: "200",
      },
      origin,
    );
    expect(q).toEqual({
      origin,
      services: ["vistagenomics", "exploration"],
      maxLastSeenDays: 30,
      dssaOnly: true,
      networkKey: "oasis",
      search: "dssa trojan",
      limit: 200,
    });
  });

  it("reads each one on its own, so a dropped case cannot hide behind the others", () => {
    /*
      The OASIS defect in miniature: the parser handled five of the six parameters, and the sixth was
      invisible because nothing asked about it alone.
    */
    expect(parseCarrierQueryParams({ network: "oasis" }, origin).networkKey).toBe("oasis");
    expect(parseCarrierQueryParams({ dssaOnly: "1" }, origin).dssaOnly).toBe(true);
    expect(parseCarrierQueryParams({ services: "refuel" }, origin).services).toEqual(["refuel"]);
    expect(parseCarrierQueryParams({ maxLastSeenDays: "7" }, origin).maxLastSeenDays).toBe(7);
    expect(parseCarrierQueryParams({ q: "haruspex" }, origin).search).toBe("haruspex");
    expect(parseCarrierQueryParams({ limit: "5" }, origin).limit).toBe(5);
  });

  it("names no parameter the panel does not send, and misses none it does", () => {
    // A cheap structural check: if someone renames a chip's parameter on one side only, the two
    // lists stop agreeing here before the chip stops working in the app.
    const parsedFrom = Object.fromEntries(PANEL_SENDS.map((k) => [k, "1"]));
    const q = parseCarrierQueryParams(parsedFrom, origin);
    expect(q.networkKey).toBe("1");
    expect(q.dssaOnly).toBe(true);
    expect(q.search).toBe("1");
    expect(q.services).toEqual(["1"]);
    expect(q.maxLastSeenDays).toBe(1);
    expect(q.limit).toBe(1);
  });
});

describe("defaults, which must not accidentally filter", () => {
  it("an empty query filters nothing", () => {
    const q = parseCarrierQueryParams({}, origin);
    expect(q).toEqual({
      origin,
      services: [],
      maxLastSeenDays: 0,
      dssaOnly: false,
      networkKey: "",
      search: "",
      limit: 100,
    });
  });

  it("survives a missing query object entirely", () => {
    expect(parseCarrierQueryParams(undefined, origin).networkKey).toBe("");
  });

  it("keeps a null origin rather than inventing one", () => {
    // A cold start has seen no jump. Substituting the galactic origin would rank every row by its
    // distance from Sol and call it "nearest you".
    expect(parseCarrierQueryParams({}, null).origin).toBeNull();
  });

  it("does not read a non-string parameter as a filter", () => {
    // Express gives an array when a parameter repeats: `?network=a&network=b`.
    expect(parseCarrierQueryParams({ network: ["a", "b"] }, origin).networkKey).toBe("");
    expect(parseCarrierQueryParams({ q: ["a"] }, origin).search).toBe("");
  });

  it("treats a half-typed number as absent, not as zero", () => {
    /*
      The coercion trap this project keeps meeting: `Number("")` is 0, and 0 is a legal limit, so an
      empty parameter would return an empty list rather than the default hundred rows.
    */
    expect(parseCarrierQueryParams({ limit: "" }, origin).limit).toBe(100);
    expect(parseCarrierQueryParams({ limit: "abc" }, origin).limit).toBe(100);
    expect(parseCarrierQueryParams({ maxLastSeenDays: "abc" }, origin).maxLastSeenDays).toBe(0);
  });

  it("only '1' turns dssaOnly on", () => {
    expect(parseCarrierQueryParams({ dssaOnly: "0" }, origin).dssaOnly).toBe(false);
    expect(parseCarrierQueryParams({ dssaOnly: "true" }, origin).dssaOnly).toBe(false);
  });
});
