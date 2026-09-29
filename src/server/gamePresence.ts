/**
 * Is Elite running? For the HUD overlays, which stayed on screen after the game closed — over the
 * desktop, the browser, everything (guild tester report, 2026-09-30).
 *
 * Two sources, whichever speaks last:
 * - the journal: a `Shutdown` line means the game has gone; any other line means it is there;
 * - the process list, every {@link CHECK_MS} and once at start: catches a crash or a kill, which
 *   write no `Shutdown`, and a start of the app while the game is not running.
 * A process check that fails (no tasklist, no pgrep) answers nothing and changes nothing.
 */
import { eliteIsRunning } from "./backupService.js";

const CHECK_MS = 20_000;
/**
 * After a `Shutdown` line the game process lives on for a few seconds; a process check in that gap
 * would put the overlays straight back. Until then only a new journal line says it is back.
 */
const AFTER_SHUTDOWN_MS = 60_000;

export interface GamePresence {
  /** True / false once known; null until the first answer. */
  running(): boolean | null;
  /** Called on every change (not on repeats). Returns an unsubscribe. */
  onChange(cb: (running: boolean) => void): () => void;
  onJournalLine(event: string | undefined): void;
  /** For tests: run the process check now. */
  check(): Promise<void>;
  dispose(): void;
}

export function createGamePresence(
  o: { isGameRunning?: () => Promise<boolean | null>; autoStart?: boolean; now?: () => number } = {},
): GamePresence {
  const probe = o.isGameRunning ?? eliteIsRunning;
  const now = o.now ?? Date.now;
  let state: boolean | null = null;
  let shutdownAt = -Infinity;
  const listeners = new Set<(running: boolean) => void>();

  const set = (next: boolean) => {
    if (state === next) return;
    state = next;
    for (const cb of listeners) {
      try {
        cb(next);
      } catch {
        /* a listener's failure is its own */
      }
    }
  };

  const check = async () => {
    const alive = await probe().catch(() => null);
    if (alive === null) return;
    if (alive && now() - shutdownAt < AFTER_SHUTDOWN_MS) return;
    set(alive);
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  if (o.autoStart !== false) {
    void check();
    timer = setInterval(() => void check(), CHECK_MS);
    timer.unref?.();
  }

  return {
    running: () => state,
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    onJournalLine(event) {
      if (!event) return;
      if (event === "Shutdown") {
        shutdownAt = now();
        set(false);
      } else {
        shutdownAt = -Infinity;
        set(true);
      }
    },
    check,
    dispose() {
      if (timer) clearInterval(timer);
      listeners.clear();
    },
  };
}
