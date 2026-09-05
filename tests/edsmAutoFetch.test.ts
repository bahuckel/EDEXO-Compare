import { describe, expect, it } from "vitest";
import { EDSM_AUTO_MIN_GAP_MS, EdsmAutoFetcher } from "../src/server/edsmAutoFetch.js";

/** A clock the test drives, so a throttle measured in seconds costs no wall time. */
function harness(opts: { enabled?: () => boolean; needs?: (a: number) => boolean } = {}) {
  const calls: { systemAddress: number; systemName: string; at: number }[] = [];
  let clock = 1_000_000;
  const fetcher = new EdsmAutoFetcher({
    isEnabled: opts.enabled ?? (() => true),
    needsHydration: opts.needs ?? (() => true),
    hydrate: async (systemAddress, systemName) => {
      calls.push({ systemAddress, systemName, at: clock });
      return { ok: true };
    },
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  return { fetcher, calls, tick: (ms: number) => (clock += ms) };
}

describe("EdsmAutoFetcher", () => {
  it("looks a system up once, however many times it is entered", async () => {
    const h = harness();
    h.fetcher.onArrivedInSystem(1, "Sol");
    h.fetcher.onArrivedInSystem(1, "Sol");
    await h.fetcher.idle();
    h.fetcher.onArrivedInSystem(1, "Sol");
    await h.fetcher.idle();

    expect(h.calls).toHaveLength(1);
    expect(h.fetcher.stats.skipped).toBe(2);
  });

  /** A commander on a route jumps every 20-40 s; a burst of short hops must queue, not fan out. */
  it("keeps a floor between requests", async () => {
    const h = harness();
    for (const [addr, name] of [
      [1, "Sol"],
      [2, "Deciat"],
      [3, "Shinrarta Dezhra"],
    ] as const) {
      h.fetcher.onArrivedInSystem(addr, name);
    }
    await h.fetcher.idle();

    expect(h.calls).toHaveLength(3);
    expect(h.calls[1]!.at - h.calls[0]!.at).toBeGreaterThanOrEqual(EDSM_AUTO_MIN_GAP_MS);
    expect(h.calls[2]!.at - h.calls[1]!.at).toBeGreaterThanOrEqual(EDSM_AUTO_MIN_GAP_MS);
  });

  it("asks nothing when the feature is off", async () => {
    const h = harness({ enabled: () => false });
    h.fetcher.onArrivedInSystem(1, "Sol");
    await h.fetcher.idle();
    expect(h.calls).toHaveLength(0);
  });

  /** Turning the toggle off mid-route has to stop a queue that is already draining. */
  it("abandons the queue when the feature is switched off", async () => {
    let on = true;
    const h = harness({ enabled: () => on });
    h.fetcher.onArrivedInSystem(1, "Sol");
    h.fetcher.onArrivedInSystem(2, "Deciat");
    h.fetcher.onArrivedInSystem(3, "Beagle Point");
    on = false;
    await h.fetcher.idle();
    expect(h.calls.length).toBeLessThan(3);
  });

  it("asks nothing for a system the journal already has scans for", async () => {
    const h = harness({ needs: () => false });
    h.fetcher.onArrivedInSystem(1, "Sol");
    await h.fetcher.idle();
    expect(h.calls).toHaveLength(0);
    expect(h.fetcher.stats.skipped).toBe(1);
  });

  it("ignores an arrival with no usable system", async () => {
    const h = harness();
    h.fetcher.onArrivedInSystem(Number.NaN, "Sol");
    h.fetcher.onArrivedInSystem(1, "   ");
    await h.fetcher.idle();
    expect(h.calls).toHaveLength(0);
  });

  /**
   * A failure is remembered as an attempt. EDSM has already said it does not have the system; asking
   * again on the next pass through would be the rudest possible use of a volunteer service.
   */
  it("does not retry a system that failed", async () => {
    let clock = 0;
    const calls: number[] = [];
    const fetcher = new EdsmAutoFetcher({
      isEnabled: () => true,
      needsHydration: () => true,
      hydrate: async (systemAddress) => {
        calls.push(systemAddress);
        return { ok: false, error: "No bodies in EDSM for this system." };
      },
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    fetcher.onArrivedInSystem(7, "Nowhere");
    await fetcher.idle();
    fetcher.onArrivedInSystem(7, "Nowhere");
    await fetcher.idle();

    expect(calls).toEqual([7]);
    expect(fetcher.stats.failed).toBe(1);
  });

  it("survives a hydrate that throws", async () => {
    let clock = 0;
    const fetcher = new EdsmAutoFetcher({
      isEnabled: () => true,
      needsHydration: () => true,
      hydrate: async () => {
        throw new Error("socket hang up");
      },
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    fetcher.onArrivedInSystem(1, "Sol");
    await expect(fetcher.idle()).resolves.toBeUndefined();
    expect(fetcher.stats.failed).toBe(1);
  });
});
