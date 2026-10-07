/**
 * Long passes over the galaxy index in slices (owner, 2026-10-06/07: opening Boxels and the galaxy map
 * froze the app, the launcher too). The server runs in Electron's main process, so a pass of a few
 * hundred milliseconds there stops every window; written as a generator that pauses every slice, the
 * same pass can run in one go (`runSync`) or hand the event loop back whenever a slice has run long
 * enough (`runSliced`).
 */

/** Systems per pause point; the runner decides whether to actually yield there. */
export const SLICE = 32_768;
const SLICE_MS = 12;

export function runSync<T>(steps: Generator<void, T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

export async function runSliced<T>(steps: Generator<void, T>): Promise<T> {
  let t = performance.now();
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    if (performance.now() - t > SLICE_MS) {
      await new Promise<void>((done) => setImmediate(done));
      t = performance.now();
    }
  }
}
