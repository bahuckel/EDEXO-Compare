/**
 * Auto-hydration on jump: one request per system, at a pace a volunteer service can live with.
 *
 * §20.2 set the terms, and every one of them is about being a good guest on someone else's
 * infrastructure. The manual path is one request when a commander clicks a button. This is a
 * request every time they jump, and a commander on a long route jumps **every 20-40 seconds for
 * hours**. So:
 *
 * - **Once per system, ever** (per session). A route that loops back does not ask twice.
 * - **A floor between calls**, so a burst of jumps queues rather than fans out.
 * - **One in flight at a time.** No parallelism against a service that did not ask for it.
 * - **Silent failure.** A system not in EDSM is the normal case out in the black, not an error the
 *   commander needs told about.
 * - **Never blocks.** Nothing in the journal path waits on the network.
 *
 * What it deliberately does *not* do is retry. A system that failed once stays marked as attempted:
 * the commander gets the manual button, and EDSM does not get a second request for a system it has
 * already said it does not have.
 */

/** Between requests. A jump takes 20-40 s, so this only bites on a burst of short hops. */
export const EDSM_AUTO_MIN_GAP_MS = 5_000;

/** Systems remembered per session before the oldest are forgotten. */
const MAX_REMEMBERED_SYSTEMS = 5_000;

export interface EdsmAutoFetchDeps {
  /** Is the toggle on, and are credentials present? */
  isEnabled: () => boolean;
  /** False when the journal already holds mappable scans, so there is nothing to supplement. */
  needsHydration: (systemAddress: number) => boolean;
  hydrate: (systemAddress: number, systemName: string) => Promise<{ ok: boolean; error?: string }>;
  /** Injected so tests do not sleep. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface EdsmAutoFetchStats {
  requested: number;
  hydrated: number;
  failed: number;
  skipped: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class EdsmAutoFetcher {
  private readonly attempted = new Set<number>();
  private queue: { systemAddress: number; systemName: string }[] = [];
  private running = false;
  private lastRequestAt = 0;
  readonly stats: EdsmAutoFetchStats = { requested: 0, hydrated: 0, failed: 0, skipped: 0 };

  constructor(private readonly deps: EdsmAutoFetchDeps) {}

  /**
   * Called on `FSDJump` / `Location`. Returns immediately; the work happens on its own.
   *
   * The enabled check happens here *and* again before each request, because a commander can turn the
   * toggle off while a queue is draining and that has to stop it.
   */
  onArrivedInSystem(systemAddress: number, systemName: string): void {
    if (!Number.isFinite(systemAddress) || !systemName.trim()) return;
    if (!this.deps.isEnabled()) return;
    if (this.attempted.has(systemAddress)) {
      this.stats.skipped++;
      return;
    }
    if (!this.deps.needsHydration(systemAddress)) {
      this.stats.skipped++;
      return;
    }

    this.attempted.add(systemAddress);
    if (this.attempted.size > MAX_REMEMBERED_SYSTEMS) {
      const oldest = this.attempted.values().next().value;
      if (oldest !== undefined) this.attempted.delete(oldest);
    }
    this.queue.push({ systemAddress, systemName: systemName.trim() });
    void this.drain();
  }

  /** For the tests, and for a status line that can say what the feature actually did. */
  hasAttempted(systemAddress: number): boolean {
    return this.attempted.has(systemAddress);
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
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift()!;
        if (!this.deps.isEnabled()) {
          this.queue.length = 0;
          return;
        }
        const wait = EDSM_AUTO_MIN_GAP_MS - (now() - this.lastRequestAt);
        if (wait > 0) await sleep(wait);

        this.lastRequestAt = now();
        this.stats.requested++;
        try {
          const r = await this.deps.hydrate(next.systemAddress, next.systemName);
          if (r.ok) this.stats.hydrated++;
          else this.stats.failed++;
        } catch {
          // Silent by design: no system in EDSM is the normal case, and a network blip while
          // flying is not something to interrupt anyone over.
          this.stats.failed++;
        }
      }
    } finally {
      this.running = false;
    }
  }
}
