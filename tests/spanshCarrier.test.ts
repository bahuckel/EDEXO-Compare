/**
 * Looking one carrier up on Spansh.
 *
 * Why it exists at all, measured on 16 Vista Genomics carriers on 2026-09-20:
 *
 * ```
 * Spansh newer 9   EDAstro newer 3   same 3   not on Spansh 1   different system 1
 * ```
 *
 * So neither source dominates and this is a second opinion, never a correction. `T4W-0XN` reads
 * 2025-08-25 on EDAstro and 2026-07-06 on Spansh; `H2Z-L5V` is in *Cephei Sector BV-Y b4* on one and
 * **Asterope** on the other, two months later.
 *
 * **The behaviour that must not break is the exact name match.** Spansh's name filter is fuzzy:
 * `K2Y-GKT` returns 39 rows, every `-GKT` suffix in the galaxy. Taking the first result would route
 * a commander hundreds of light years to a different carrier that merely sounds similar, and the row
 * would look entirely plausible.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isPlausibleCallsign, lookupCarrierOnSpansh } from "../src/server/spanshCarrier.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** The shape Spansh actually returns, trimmed to the fields read. */
function stationsReply(results: unknown[]) {
  return new Response(JSON.stringify({ count: results.length, results }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function station(name: string, system: string, extra?: Record<string, unknown>) {
  return {
    name,
    system_name: system,
    system_x: 10,
    system_y: 20,
    system_z: 30,
    updated_at: "2026-08-13T10:00:00",
    market_id: 3709702912,
    type: "Drake-Class Carrier",
    ...extra,
  };
}

describe("isPlausibleCallsign", () => {
  it("accepts the shapes the file actually contains", () => {
    // 2,406 of 90,077 callsigns are not XXX-XXX -- "0040", "01AI" -- so the format cannot be required.
    expect(isPlausibleCallsign("K2Y-GKT")).toBe(true);
    expect(isPlausibleCallsign("0040")).toBe(true);
    expect(isPlausibleCallsign("VOTB")).toBe(true);
  });

  it("rejects what would turn into a galaxy-wide query", () => {
    expect(isPlausibleCallsign("")).toBe(false);
    expect(isPlausibleCallsign("  ")).toBe(false);
    expect(isPlausibleCallsign("a")).toBe(false);
    expect(isPlausibleCallsign("a very long station name")).toBe(false);
    expect(isPlausibleCallsign("K2Y GKT")).toBe(false);
  });

  it("does not send a request for an implausible callsign", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof globalThis.fetch;
    const result = await lookupCarrierOnSpansh("");
    expect(result.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("the exact name match", () => {
  it("picks its own callsign out of the fuzzy results", async () => {
    /*
      THE ONE THAT MATTERS. This is the real shape of a `K2Y-GKT` search: the suffix matches come
      back too, and on the live service the wanted row was not always first. Taking results[0] sends
      the commander to T8Q-GKT in Aymifa instead, and nothing on screen would look wrong.
    */
    globalThis.fetch = (async () =>
      stationsReply([
        station("T8Q-GKT", "Aymifa"),
        station("K5N-GKT", "LTT 4428"),
        station("K2Y-GKT", "Beagle Point"),
        station("W5V-GKT", "Col 285 Sector LB-O c6-3"),
      ])) as unknown as typeof globalThis.fetch;

    const result = await lookupCarrierOnSpansh("K2Y-GKT");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fix.system).toBe("Beagle Point");
    expect(result.fix.marketId).toBe(3709702912);
  });

  it("matches regardless of case and surrounding space", async () => {
    globalThis.fetch = (async () =>
      stationsReply([station(" k2y-gkt ", "Beagle Point")])) as unknown as typeof globalThis.fetch;
    const result = await lookupCarrierOnSpansh("K2Y-GKT");
    expect(result.ok).toBe(true);
  });

  it("reports not-found rather than guessing", async () => {
    // 1 of 16 sampled carriers is simply not in Spansh's station data. Returning a near-match would
    // be an invention, and this is a list people fly hundreds of light years on.
    globalThis.fetch = (async () =>
      stationsReply([station("T8Q-GKT", "Aymifa")])) as unknown as typeof globalThis.fetch;
    const result = await lookupCarrierOnSpansh("K2Y-GKT");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.notFound).toBe(true);
  });
});

describe("what it sends", () => {
  it("asks only for carriers, by name", async () => {
    let sent: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      return stationsReply([station("K2Y-GKT", "Beagle Point")]);
    }) as unknown as typeof globalThis.fetch;

    await lookupCarrierOnSpansh("K2Y-GKT");
    const filters = sent.filters as Record<string, { value: unknown }>;
    expect(filters.name?.value).toBe("K2Y-GKT");
    // Without the type filter an ordinary station with a similar name can win the exact match.
    expect(filters.type?.value).toEqual(["Drake-Class Carrier"]);
  });
});

describe("when Spansh misbehaves", () => {
  it("reports a non-200 rather than throwing", async () => {
    globalThis.fetch = (async () => new Response("", { status: 503 })) as unknown as typeof globalThis.fetch;
    const result = await lookupCarrierOnSpansh("K2Y-GKT");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("503");
  });

  it("survives a body that is not JSON", async () => {
    globalThis.fetch = (async () =>
      new Response("<html>nope</html>", { status: 200 })) as unknown as typeof globalThis.fetch;
    const result = await lookupCarrierOnSpansh("K2Y-GKT");
    expect(result.ok).toBe(false);
  });

  it("survives a reply with no result list", async () => {
    globalThis.fetch = (async () =>
      new Response("{}", { status: 200 })) as unknown as typeof globalThis.fetch;
    const result = await lookupCarrierOnSpansh("K2Y-GKT");
    expect(result.ok).toBe(false);
  });

  it("survives the network being gone", async () => {
    globalThis.fetch = (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof globalThis.fetch;
    const result = await lookupCarrierOnSpansh("K2Y-GKT");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("ENOTFOUND");
  });

  it("keeps a row whose coordinates are missing", async () => {
    // Distance is then unknown, which is a real answer; the system name is still worth having.
    globalThis.fetch = (async () =>
      stationsReply([
        station("K2Y-GKT", "Beagle Point", { system_x: null, system_y: null, system_z: null }),
      ])) as unknown as typeof globalThis.fetch;
    const result = await lookupCarrierOnSpansh("K2Y-GKT");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fix.system).toBe("Beagle Point");
    expect(result.fix.x).toBeNull();
  });
});
