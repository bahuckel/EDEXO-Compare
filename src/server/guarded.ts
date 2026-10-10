/**
 * A timer callback that logs its failure instead of throwing it (code review 2026-10-10, A1).
 *
 * The server process exits on any uncaught exception (devEntry.ts), and since the server runs in its own
 * process the desktop app then closes with "the server stopped". The live journal path already catches
 * its own errors; the timer paths that rebuild the snapshot (the coalesced push, the Status.json poll) did
 * not, so one bad body record on a timer closed the app. A failed tick is logged and the next one tries again.
 */
export function guarded<A extends unknown[]>(label: string, fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args);
    } catch (e) {
      console.error(`[edexo-compare] ${label} failed (skipped):`, e);
    }
  };
}
