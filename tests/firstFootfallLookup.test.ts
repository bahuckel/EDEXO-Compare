/**
 * "Would I be the first here?", asked of EDSM as sparingly as possible.
 *
 * Two things are being protected. The first is the **asymmetry**: EDSM knowing a system proves
 * someone has been, while EDSM not knowing it only means nobody who uploads has been, so `true` is a
 * good bet and `false` is a fact. The second is the **traffic**: this runs on every snapshot, and a
 * naive version would ask about forty systems, one request each, every time a route is replotted.
 */
import { describe, expect, it, vi } from "vitest";
import { FirstFootfallLookup, LOOKUP_HOPS_AHEAD, RATE_LIMIT_BACKOFF_MS } from "../src/server/firstFootfallLookup.js";

/** A fetch that answers as EDSM does: only the systems it knows come back. */
function edsmKnowing(known: string[]) {
  const calls: string[][] = [];
  const impl = vi.fn(async (url: string | URL) => {
    const asked = [...new URL(String(url)).searchParams.getAll("systemName[]")];
    calls.push(asked);
    const rows = asked
      .filter((n) => known.some((k) => k.toLowerCase() === n.toLowerCase()))
      .map((n) => ({ name: n, id: 1 }));
    return { ok: true, json: async () => rows } as unknown as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const make = (opts: { known?: string[]; visited?: string[]; now?: () => number }) => {
  const f = edsmKnowing(opts.known ?? []);
  const lookup = new FirstFootfallLookup({
    hasVisited: (n) => (opts.visited ?? []).some((v) => v.toLowerCase() === n.toLowerCase()),
    identity: () => null,
    fetchImpl: f.impl,
    now: opts.now,
  });
  return { lookup, calls: f.calls, impl: f.impl };
};

describe("the verdict", () => {
  it("says nothing before the lookup has answered", () => {
    const { lookup } = make({});
    expect(lookup.verdict("Kyloopua AB-C d1-2")).toBeNull();
  });

  it("says no for a system EDSM knows — someone has been and uploaded it", async () => {
    const { lookup } = make({ known: ["Sol"] });
    lookup.request(["Sol"]);
    await vi.waitFor(() => expect(lookup.verdict("Sol")).toBe(false));
  });

  it("says probably-first for a system EDSM has never heard of", async () => {
    const { lookup } = make({ known: ["Sol"] });
    lookup.request(["Sol", "Nowhere AA-A z0-0"]);
    await vi.waitFor(() => expect(lookup.verdict("Nowhere AA-A z0-0")).toBe(true));
  });

  it("settles a visited system from the journals without asking anyone", () => {
    /*
      THE ONE THAT SAVES THE TRAFFIC. He cannot be first somewhere he has already been, and the
      journal already says where those are. Asking EDSM would be a request spent on a question the
      app can answer itself.
    */
    const { lookup, impl } = make({ visited: ["Kyloopua OG-G b11-12"] });
    expect(lookup.verdict("Kyloopua OG-G b11-12")).toBe(false);
    lookup.request(["Kyloopua OG-G b11-12"]);
    expect(impl).not.toHaveBeenCalled();
  });
});

describe("how much it asks for", () => {
  it("puts a whole route in one request, not one request per hop", async () => {
    const names = Array.from({ length: LOOKUP_HOPS_AHEAD }, (_, i) => `Sys ${i}`);
    const { lookup, calls, impl } = make({ known: ["Sys 3"] });
    lookup.request(names);
    await vi.waitFor(() => expect(lookup.verdict("Sys 0")).not.toBeNull());
    expect(impl).toHaveBeenCalledTimes(1);
    expect(calls[0]).toHaveLength(LOOKUP_HOPS_AHEAD);
  });

  it("covers every hop the snapshot carries, because how many are visible is not knowable here", () => {
    /*
      The strip renders all the hops and then removes them from the end until the row fits, so the
      visible count depends on the HUD's width and scale. Looking up ten left the last few arrows on
      a wide HUD with no verdict, which is what the owner reported. Covering them all costs nothing:
      EDSM answers a list in one request either way.
    */
    const names = Array.from({ length: 40 }, (_, i) => `Sys ${i}`);
    const { lookup, calls, impl } = make({});
    lookup.request(names);
    expect(impl).toHaveBeenCalledTimes(1);
    expect(calls[0]).toHaveLength(40);
  });

  it("does not ask twice for the same system", async () => {
    const { lookup, impl } = make({ known: ["Sol"], now: () => 0 });
    lookup.request(["Sol"]);
    await vi.waitFor(() => expect(lookup.verdict("Sol")).toBe(false));
    lookup.request(["Sol"]);
    lookup.request(["Sol"]);
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("will not fire twice inside the rate-limit window", () => {
    /*
      A route being replotted pushes a snapshot per keystroke of the galaxy map. Without the gap this
      becomes a burst at a volunteer service, which is the thing the owner has been careful about all
      along.
    */
    let t = 1000;
    const { lookup, impl } = make({ now: () => t });
    lookup.request(["A"]);
    t += 100;
    lookup.request(["B"]);
    expect(impl).toHaveBeenCalledTimes(1);
  });
});

describe("when it cannot reach EDSM", () => {
  it("leaves the verdict unknown rather than claiming a first footfall", async () => {
    /*
      Offline, rate-limited or EDSM down. Answering "true" because nothing came back would paint the
      whole route blue on a dropped connection — the one failure that would actually send him flying.
    */
    const lookup = new FirstFootfallLookup({
      hasVisited: () => false,
      identity: () => null,
      fetchImpl: (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
    });
    lookup.request(["Somewhere"]);
    await new Promise((r) => setTimeout(r, 5));
    expect(lookup.verdict("Somewhere")).toBeNull();
  });

  it("treats a reply that is not a list as no answer, not as an empty one", async () => {
    /*
      THE ONE THAT MATTERS IN THIS BLOCK. Absence from the reply is the whole signal, so a 200
      carrying an error object rather than a list would mark every system as unvisited and paint the
      entire route blue — the one direction this feature must never fail in.

      An empty *array* stays a real answer: a route through unexplored space returns exactly that.
    */
    const lookup = new FirstFootfallLookup({
      hasVisited: () => false,
      identity: () => null,
      fetchImpl: (async () => ({
        ok: true,
        json: async () => ({ error: "nope" }),
      })) as unknown as typeof fetch,
    });
    lookup.request(["A", "B", "C"]);
    await new Promise((r) => setTimeout(r, 5));
    expect(lookup.verdict("A")).toBeNull();
    expect(lookup.verdict("B")).toBeNull();
  });

  it("an empty list is a real answer — everything on the route is unexplored", async () => {
    const lookup = new FirstFootfallLookup({
      hasVisited: () => false,
      identity: () => null,
      fetchImpl: (async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch,
    });
    lookup.request(["A", "B"]);
    await new Promise((r) => setTimeout(r, 5));
    expect(lookup.verdict("A")).toBe(true);
    expect(lookup.verdict("B")).toBe(true);
  });

  it("leaves it unknown on a non-200 as well", async () => {
    const lookup = new FirstFootfallLookup({
      hasVisited: () => false,
      identity: () => null,
      fetchImpl: (async () => ({ ok: false, status: 429 })) as unknown as typeof fetch,
    });
    lookup.request(["Somewhere"]);
    await new Promise((r) => setTimeout(r, 5));
    expect(lookup.verdict("Somewhere")).toBeNull();
  });
});

/**
 * Why there is no answer, for the grey arrow's tooltip (owner, 2026-09-24): grey while waiting and
 * grey when EDSM could not be asked, so orange only ever means EDSM said someone has been.
 */
describe("the note behind a grey arrow", () => {
  const settle = () => new Promise((r) => setTimeout(r, 5));
  const lookupWith = (impl: () => Promise<unknown>, now?: () => number) =>
    new FirstFootfallLookup({
      hasVisited: () => false,
      identity: () => null,
      fetchImpl: impl as unknown as typeof fetch,
      now,
    });

  it("says it is waiting before anything came back, and nothing once it has", async () => {
    const { lookup } = make({ known: ["Sol"] });
    expect(lookup.note("Sol")).toBe("Waiting for EDSM");
    lookup.request(["Sol"]);
    await settle();
    expect(lookup.note("Sol")).toBeNull();
  });

  it("names the failure: no connection, an error status, a reply that is not a list", async () => {
    const offline = lookupWith(async () => {
      throw new Error("offline");
    });
    offline.request(["A"]);
    await settle();
    expect(offline.note("A")).toBe("Could not reach EDSM — will retry");

    const error = lookupWith(async () => ({ ok: false, status: 500, json: async () => [] }));
    error.request(["A"]);
    await settle();
    expect(error.note("A")).toBe("EDSM answered with an error — will retry");

    const odd = lookupWith(async () => ({ ok: true, json: async () => ({ error: "nope" }) }));
    odd.request(["A"]);
    await settle();
    expect(odd.note("A")).toBe("EDSM sent an unexpected reply — will retry");
  });

  it("backs off a full minute after a rate limit, then asks again and clears the note", async () => {
    let t = 0;
    let limited = true;
    const impl = vi.fn(async () =>
      limited ? { ok: false, status: 429, json: async () => [] } : { ok: true, json: async () => [] },
    );
    const lookup = lookupWith(impl, () => t);
    lookup.request(["A"]);
    await settle();
    expect(lookup.note("A")).toBe("EDSM rate limit — will retry");
    expect(impl).toHaveBeenCalledTimes(1);

    t = 10_000; // past the ordinary gap, inside the back-off
    lookup.request(["A"]);
    await settle();
    expect(impl).toHaveBeenCalledTimes(1);

    t = RATE_LIMIT_BACKOFF_MS + 1;
    limited = false;
    lookup.request(["A"]);
    await settle();
    expect(impl).toHaveBeenCalledTimes(2);
    expect(lookup.verdict("A")).toBe(true);
    expect(lookup.note("A")).toBeNull();
  });
});
