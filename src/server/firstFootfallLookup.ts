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
 * Every hop the snapshot carries. The strip renders all of them and then removes hops from the end
 * until the row fits, so how many are on screen depends on the HUD's width and scale — the owner
 * counted thirteen where an earlier guess here assumed eight, and at a cap of ten the last arrows had
 * no verdict and stayed grey.
 *
 * `fitRouteStrip` does know the drawn count and writes it to the element, but the server is not the
 * place to consult it: a round trip to shrink a list costs a message and saves nothing, because
 * `api-v1/systems` answers a list in one request either way. Covering every hop makes the drawn
 * count irrelevant to correctness — whatever the strip decides to show already has an answer.
 * Matches `ROUTE_AHEAD_HOPS` in `navRouteFuel.ts`.
 */
export const LOOKUP_HOPS_AHEAD = 40;

/** Names per request. EDSM answers a list in one call; this is politeness, not a documented cap. */
const MAX_NAMES_PER_REQUEST = 40;

/** Least time between two requests, so a route being replotted cannot become a burst. */
const MIN_REQUEST_GAP_MS = 5_000;

/** After EDSM says HTTP 429, wait this long before asking again. */
export const RATE_LIMIT_BACKOFF_MS = 60_000;

/** Why a name has no verdict. The HUD shows the arrow grey for all of them (owner, 2026-09-24). */
export type LookupFailure = "rate-limit" | "http" | "network" | "bad-response";

const FAILURE_NOTE: Record<LookupFailure, string> = {
  "rate-limit": "EDSM rate limit — will retry",
  http: "EDSM answered with an error — will retry",
  network: "Could not reach EDSM — will retry",
  "bad-response": "EDSM sent an unexpected reply — will retry",
};

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
  /** name → why the last request for it failed. Cleared when a later one answers. */
  private readonly failures = new Map<string, LookupFailure>();
  /** No request before this time — set by a 429. */
  private backoffUntil = -Infinity;

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

  /**
   * Why a system has no verdict, for the arrow's tooltip — or null when it has one.
   *
   * The owner's three colours: orange = EDSM knows the system, blue = EDSM has never heard of it,
   * **grey = no answer**, whether because the request is still waiting or because it failed (no
   * connection, rate limit, an error status, a reply that is not the list we asked for). Grey while
   * waiting too, so orange only ever means "EDSM said yes".
   */
  note(systemName: string): string | null {
    if (this.verdict(systemName) !== null) return null;
    const name = systemName?.trim();
    if (!name) return null;
    const failure = this.failures.get(key(name));
    return failure ? FAILURE_NOTE[failure] : "Waiting for EDSM";
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
    if (now < this.backoffUntil) return;
    this.inFlight = true;
    this.lastRequestAt = now;
    const batch = [...this.pending].slice(0, MAX_NAMES_PER_REQUEST);
    const fail = (why: LookupFailure) => {
      for (const n of batch) this.failures.set(key(n), why);
    };
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
      if (!res.ok) {
        // Leave them pending; the next snapshot tries again — after a minute when EDSM said 429.
        fail(res.status === 429 ? "rate-limit" : "http");
        if (res.status === 429) this.backoffUntil = now + RATE_LIMIT_BACKOFF_MS;
        return;
      }
      const rows = (await res.json()) as unknown;
      /*
        A body that is not a list is not an empty answer.

        Absence from the reply is the entire signal here, so anything that reduces to "nothing came
        back" marks every name as unvisited and paints the whole route blue. An empty **array** is a
        real answer — a route through unexplored space returns exactly that — but an error object, a
        string, or a 200 carrying `{}` is EDSM failing to answer, and treating it as "nobody has been
        anywhere" is the one wrong direction this feature can fail in. Leave them pending instead.
      */
      if (!Array.isArray(rows)) {
        fail("bad-response");
        return;
      }
      const returned = new Set(
        rows.map((r) => key(String((r as { name?: unknown })?.name ?? ""))).filter(Boolean),
      );
      /*
        EDSM answers only the systems it knows, so a name that went out and did not come back is one
        nobody has uploaded. Checked against a forty-name request on 2026-09-21: all eight real
        systems came back and none of the thirty-two invented ones did, so the list is not truncated
        at the length a route asks for.
      */
      for (const n of batch) {
        this.known.set(key(n), returned.has(key(n)));
        this.pending.delete(key(n));
        this.failures.delete(key(n));
      }
    } catch {
      // Offline, or EDSM down. The names stay pending and the arrows go grey — the honest rendering
      // of "we do not know" — with the reason in the tooltip.
      fail("network");
    } finally {
      this.inFlight = false;
    }
  }
}
