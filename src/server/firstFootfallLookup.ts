/**
 * Would the commander be the first to arrive in the systems ahead of them?
 *
 * The HUD colours the arrow leading to a system blue when nobody appears to have been there, so the
 * decision to detour is visible without opening anything. This module answers the question behind
 * that colour.
 *
 * ### What can actually be known before arriving
 *
 * The game says whether a system was already discovered only **on arrival**, in the `Scan` of the
 * arrival star. Before the jump there is no in-game signal at all, so the only source is a
 * third-party database — EDSM, which this app already talks to.
 *
 * That makes the answer asymmetric, and the UI has to respect it:
 *
 * - **EDSM knows the system** — someone has been there and uploaded it. Not a first footfall.
 *   This half is certain.
 * - **EDSM has never heard of it** — nobody who uploads to EDSM has been there. That is a good bet
 *   and not a promise: plenty of commanders fly without uploading anything.
 *
 * So blue means *likely*, orange means *no*, and the naming here says so rather than claiming a
 * first footfall the data cannot support.
 *
 * ### Asking as little as possible
 *
 * The owner's rule for third-party services, and the reason this is not a lookup per hop:
 *
 * 1. **The app's own knowledge first.** A system he has visited cannot be a first footfall for him,
 *    and the journal already says which those are — no request needed.
 * 2. **Then the cache.** An answer is kept for the life of the process; a system does not stop being
 *    discovered.
 * 3. **Then one request for everything left**, because `api-v1/systems` takes many `systemName[]`
 *    parameters and answers them together. A forty-hop route is one call, not forty.
 *
 * Nothing here blocks the snapshot. A name with no answer yet reads `null`, the HUD leaves the arrow
 * in its default colour, and the next snapshot after the reply carries the verdict.
 */
import { EDSM_USER_AGENT, type EdsmRequestIdentity } from "./edsmSystemHydration.js";

const EDSM_SYSTEMS_URL = "https://www.edsm.net/api-v1/systems";

/**
 * How many hops ahead are looked up.
 *
 * Every hop the snapshot carries, because **how many are visible cannot be known here**. The strip
 * renders all of them and then removes hops from the end until the row fits, so the count depends on
 * the HUD's width and scale — at ten the last few arrows on a wide HUD had no verdict and stayed
 * grey, which is what the owner saw.
 *
 * It costs nothing to cover them all: `api-v1/systems` answers a list in one request, so forty names
 * and ten names are the same single call. Matches `ROUTE_AHEAD_HOPS` in `navRouteFuel.ts`.
 */
export const LOOKUP_HOPS_AHEAD = 40;

/** Names per request. EDSM answers a list in one call; this is politeness, not a documented cap. */
const MAX_NAMES_PER_REQUEST = 40;

/** Least time between two requests, so a route being replotted cannot become a burst. */
const MIN_REQUEST_GAP_MS = 5_000;

export interface FirstFootfallDeps {
  /** True when the commander's own journals already place him in this system. */
  hasVisited: (systemName: string) => boolean;
  identity: () => EdsmRequestIdentity | null;
  /** Seam for tests. Defaults to `fetch`. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const key = (name: string) => name.trim().toLowerCase();

export class FirstFootfallLookup {
  /** name → EDSM has a record. Absent means "not asked yet or still in flight". */
  private readonly known = new Map<string, boolean>();
  private readonly pending = new Set<string>();
  /**
   * `-Infinity` so the first request is never held back.
   *
   * Zero looks equivalent and is not: with a clock that starts near zero — a test, or any injected
   * `now` — the gap check suppresses the very first lookup for five seconds, and the arrows stay
   * grey through the jump the commander is actually about to make.
   */
  private lastRequestAt = -Infinity;
  private inFlight = false;

  constructor(private readonly deps: FirstFootfallDeps) {}

  /**
   * `true` when the commander would probably be first, `false` when someone has certainly been, and
   * `null` when nothing is known yet — which the HUD must render as "no opinion", not as "no".
   */
  verdict(systemName: string): boolean | null {
    const name = systemName?.trim();
    if (!name) return null;
    // His own visit settles it without asking anyone.
    if (this.deps.hasVisited(name)) return false;
    const hit = this.known.get(key(name));
    return hit === undefined ? null : !hit;
  }

  /** Queue whatever is still unanswered, and send one request for the lot. Never throws. */
  request(systemNames: readonly string[]): void {
    const wanted = systemNames
      .slice(0, LOOKUP_HOPS_AHEAD)
      .map((n) => n?.trim())
      .filter((n): n is string => !!n && !this.deps.hasVisited(n))
      .filter((n) => !this.known.has(key(n)) && !this.pending.has(key(n)));
    for (const n of wanted) this.pending.add(key(n));
    void this.drain();
  }

  /** For tests and for the status panel: how much is cached and how much is outstanding. */
  stats(): { cached: number; pending: number } {
    return { cached: this.known.size, pending: this.pending.size };
  }

  private async drain(): Promise<void> {
    if (this.inFlight || this.pending.size === 0) return;
    const now = (this.deps.now ?? Date.now)();
    if (now - this.lastRequestAt < MIN_REQUEST_GAP_MS) return;
    this.inFlight = true;
    this.lastRequestAt = now;
    const batch = [...this.pending].slice(0, MAX_NAMES_PER_REQUEST);
    try {
      const params = new URLSearchParams();
      for (const n of batch) params.append("systemName[]", n);
      params.set("showId", "1");
      const identity = this.deps.identity();
      if (identity?.apiKey && identity.commanderName) {
        params.set("commanderName", identity.commanderName);
        params.set("apiKey", identity.apiKey);
      }
      const doFetch = this.deps.fetchImpl ?? fetch;
      const res = await doFetch(`${EDSM_SYSTEMS_URL}?${params.toString()}`, {
        headers: { Accept: "application/json", "User-Agent": EDSM_USER_AGENT },
      });
      if (!res.ok) return; // leave them pending; the next route change tries again
      const rows = (await res.json()) as { name?: unknown }[];
      const returned = new Set(
        (Array.isArray(rows) ? rows : []).map((r) => key(String(r?.name ?? ""))).filter(Boolean),
      );
      /*
        Absence from the reply is the whole signal. EDSM answers only the systems it knows, so a name
        that went out and did not come back is one nobody has uploaded.
      */
      for (const n of batch) {
        this.known.set(key(n), returned.has(key(n)));
        this.pending.delete(key(n));
      }
    } catch {
      // Offline, rate-limited, or EDSM down. The names stay pending and the arrows stay neutral,
      // which is the honest rendering of "we do not know".
    } finally {
      this.inFlight = false;
    }
  }
}
