/**
 * Sending discoveries to Canonn, if the commander asks for it.
 *
 * Canonn Research is the community's science archive: every exobiology rule this app predicts from
 * exists because commanders sent them their scans for years. Contributing back is the closest thing
 * this project has to paying for what it uses.
 *
 * ## What the commander gives up, said plainly
 *
 * Canonn's contract takes the **journal line verbatim** and the **commander's name** attached to it.
 * There is no anonymous form of it and no API key to scope it down — the endpoint is unauthenticated
 * and `cmdrName` is a field in the body. So this is off by default, and the option that turns it on
 * says what it sends in those words. Every other outbound feature in this project has been held to
 * the same rule, and this is the one where it matters most: the whole point of the project has been
 * that a commander's journals are theirs.
 *
 * ## What is sent, and who decides
 *
 * Not everything, and not our choice. Canonn publishes a **whitelist** of event shapes and the
 * client forwards only what matches, which is how their own plugin works and how they keep from
 * being sent a commander's whole flight log. On top of that they take three events by name —
 * `ScanOrganic`, `SellOrganicData` and `CodexEntry` — which are the exobiology ones and the reason
 * this exists at all.
 *
 * Read out of `canonn-science/EDMC-Canonn` (`canonn/whitelist.py`, `canonn/codex.py`,
 * `canonn/emitter.py`) rather than guessed. The `api.canonn.tech` CAPIv2 service the owner
 * originally named was retired in that plugin's 7.4.1 release and no longer answers at all; this is
 * where the data goes now.
 *
 * ## Being a good guest
 *
 * The same terms as the EDSM auto-fetch, for the same reason — somebody else's infrastructure:
 *
 * - **Live lines only.** The historical replay never reaches this, so switching it on does not
 *   upload four years of journals in one burst.
 * - **One request in flight**, with a floor between them.
 * - **Never blocks.** Nothing in the journal path waits on the network.
 * - **Silent failure, and no retry.** A rejected event is Canonn's business, not something to badger
 *   the commander about or the endpoint about twice.
 */
import type { JournalLine } from "../shared/types.js";

/**
 * What Canonn sees in `clientVersion`.
 *
 * Keep in step with `package.json`, for the reason `EDSM_USER_AGENT` gives: a volunteer service
 * seeing traffic it did not expect should be able to find out whose it is, and a stale version is
 * worse than none because it tells them a lie.
 */
export const CANONN_CLIENT_VERSION = "ED-Exo-Compare-1.1.0";

const WHITELIST_URL = "https://us-central1-canonn-api-236217.cloudfunctions.net/whitelist";
const POST_URL = "https://us-central1-canonn-api-236217.cloudfunctions.net/postEvent";

/** Between requests. Canonn asked nobody for this traffic, so it queues rather than fans out. */
export const CANONN_MIN_GAP_MS = 1_000;

/** Queue depth before the oldest are dropped. A burst of scans must not become unbounded memory. */
const MAX_QUEUE = 500;

/**
 * Events Canonn takes by name, whatever the whitelist says.
 *
 * Their plugin handles these three outside the whitelist mechanism because they are the archive's
 * core: the organic scan, the sale that dates it, and the codex entry that names it.
 */
export const CANONN_ALWAYS_EVENTS = new Set(["ScanOrganic", "SellOrganicData", "CodexEntry"]);

export interface CanonnGameState {
  systemName?: string;
  systemCoordinates?: [number, number, number];
  bodyName?: string;
  latitude?: number;
  longitude?: number;
  clientVersion: string;
  isBeta: boolean;
  platform: "PC";
  odyssey?: boolean;
}

export interface CanonnUploadDeps {
  /** Is the toggle on? Checked here *and* before each request, so turning it off stops a draining queue. */
  isEnabled: () => boolean;
  /** The commander's name, or null when the journal has not said yet — in which case nothing is sent. */
  cmdrName: () => string | null;
  gameState: () => CanonnGameState | null;
  /** Injected so tests neither sleep nor talk to Canonn. */
  post?: (url: string, body: unknown) => Promise<{ ok: boolean }>;
  fetchWhitelist?: () => Promise<unknown>;
  /** Called after every attempt, so the app can show a tally without reaching into this object. */
  onResult?: (ok: boolean) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface CanonnUploadStats {
  sent: number;
  failed: number;
  skipped: number;
  dropped: number;
  whitelistRules: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function defaultPost(url: string, body: unknown): Promise<{ ok: boolean }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

async function defaultFetchWhitelist(): Promise<unknown> {
  try {
    const res = await fetch(WHITELIST_URL);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/**
 * One whitelist rule: every key in it has to match the journal line.
 *
 * Canonn ships these as JSON *strings* inside a JSON array, e.g.
 * `{"definition": "{\"event\": \"Docked\", \"StationName\": \"Hutton Orbital\"}"}`. A rule is a
 * shallow equality test across its own keys — `{"event": "FSSBodySignals"}` takes every one of
 * those, and `{"event": "Interdicted", "IsThargoid": true}` takes only the Thargoid ones.
 */
export function parseWhitelist(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, unknown>[] = [];
  for (const row of raw) {
    const def = (row as { definition?: unknown } | null)?.definition;
    if (typeof def !== "string") continue;
    try {
      const parsed = JSON.parse(def) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        out.push(parsed as Record<string, unknown>);
      }
    } catch {
      /* a rule we cannot read is a rule we do not apply */
    }
  }
  return out;
}

/** Does this journal line match any rule? Shallow, and every key in the rule must agree. */
export function matchesWhitelist(rules: Record<string, unknown>[], line: JournalLine): boolean {
  const entry = line as unknown as Record<string, unknown>;
  return rules.some((rule) => Object.entries(rule).every(([k, v]) => entry[k] === v));
}

export class CanonnUploader {
  private rules: Record<string, unknown>[] = [];
  private queue: { line: JournalLine; gameState: CanonnGameState; cmdr: string }[] = [];
  private running = false;
  private lastRequestAt = 0;
  private whitelistLoaded = false;
  readonly stats: CanonnUploadStats = { sent: 0, failed: 0, skipped: 0, dropped: 0, whitelistRules: 0 };

  constructor(private readonly deps: CanonnUploadDeps) {}

  /**
   * Fetch Canonn's whitelist. Safe to call more than once; it only ever asks once.
   *
   * Failure leaves the rules empty, which means only the three named events are forwarded. That is
   * the right way round: a whitelist we could not read must never be treated as "send everything".
   */
  async loadWhitelist(): Promise<void> {
    if (this.whitelistLoaded) return;
    this.whitelistLoaded = true;
    const raw = await (this.deps.fetchWhitelist ?? defaultFetchWhitelist)();
    this.rules = parseWhitelist(raw);
    this.stats.whitelistRules = this.rules.length;
  }

  /** Would this line be sent? Exposed so the UI can say what the toggle actually does. */
  wants(line: JournalLine): boolean {
    const event = typeof line.event === "string" ? line.event : "";
    return CANONN_ALWAYS_EVENTS.has(event) || matchesWhitelist(this.rules, line);
  }

  /**
   * Offer one **live** journal line. Returns immediately; the work happens on its own.
   *
   * The historical replay must never reach this — see the header. The caller enforces that by only
   * calling it from the live tail, the same arrangement the EDSM auto-fetch uses.
   */
  offer(line: JournalLine): void {
    if (!this.deps.isEnabled()) return;
    if (!this.wants(line)) return;
    const cmdr = this.deps.cmdrName();
    const gameState = this.deps.gameState();
    // No commander name means the journal has not identified this session yet. Canonn's record is
    // keyed on it, so an event without one is not a contribution — it is noise in their archive.
    if (!cmdr || !gameState) {
      this.stats.skipped++;
      return;
    }
    if (this.queue.length >= MAX_QUEUE) {
      this.queue.shift();
      this.stats.dropped++;
    }
    this.queue.push({ line, gameState, cmdr });
    void this.drain();
  }

  /** Resolves when the queue is empty — tests await this; nothing in the app does. */
  async idle(): Promise<void> {
    while (this.running || this.queue.length > 0) {
      await (this.deps.sleep ?? defaultSleep)(1);
    }
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const now = this.deps.now ?? Date.now;
    const sleep = this.deps.sleep ?? defaultSleep;
    const post = this.deps.post ?? defaultPost;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift()!;
        // Checked again here: the commander can turn the toggle off while a queue is draining, and
        // that has to stop it rather than finish what is already lined up.
        if (!this.deps.isEnabled()) {
          this.stats.skipped++;
          continue;
        }
        const wait = this.lastRequestAt + CANONN_MIN_GAP_MS - now();
        if (wait > 0) await sleep(wait);
        this.lastRequestAt = now();
        const res = await post(POST_URL, {
          gameState: next.gameState,
          rawEvent: next.line,
          eventType: next.line.event,
          cmdrName: next.cmdr,
        });
        if (res.ok) this.stats.sent++;
        else this.stats.failed++;
        this.deps.onResult?.(res.ok);
      }
    } finally {
      this.running = false;
    }
  }
}
