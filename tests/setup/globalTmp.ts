/**
 * One temporary folder per test run, removed when the run ends (review F-F13).
 *
 * Every test file made its own user-data folder in %TEMP% (tests/setup/userDataDir.ts) and several
 * made more with `mkdtempSync(tmpdir())`; none were removed. The owner's %TEMP% held 94,589
 * `edexo-test-userdata-*` folders and thousands of others on 2026-10-02. TEMP, TMP and TMPDIR point
 * into this run's folder before the workers start, so `os.tmpdir()` in every test lands inside it,
 * and the teardown takes the lot.
 *
 * The periodic sweep (plan leftovers, 2026-10-04): a run that was killed never reaches its teardown,
 * and older runs left `mkdtemp` folders of their own. Each run first removes what earlier ones left:
 * its own `edexo-test-run-*` and `edexo-test-userdata-*` folders older than a day, and `mkdtemp`-named
 * `edexo-<name>-XXXXXX` folders older than a week. The app itself leaves nothing in %TEMP% (the
 * portable build unpacks into one fixed `EDExoPortable` folder; updates stage under the user data).
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;
const RUN_LEFTOVER = /^edexo-test-(run|userdata)-[A-Za-z0-9]{6}$/;
const MKDTEMP_LEFTOVER = /^edexo-[a-z0-9-]+-[A-Za-z0-9]{6}$/;

/** Remove earlier runs' leftovers from `dir`; returns how many went. Exported for its test. */
export function sweepTestLeftovers(dir: string, now = Date.now()): number {
  let removed = 0;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const maxAge = RUN_LEFTOVER.test(name) ? DAY_MS : MKDTEMP_LEFTOVER.test(name) ? 7 * DAY_MS : null;
    if (maxAge === null) continue;
    const p = join(dir, name);
    try {
      const st = statSync(p);
      if (!st.isDirectory() || now - st.mtimeMs < maxAge) continue;
      rmSync(p, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      removed += 1;
    } catch {
      /* held open or already gone: the next run tries again */
    }
  }
  return removed;
}

export default function setup(): () => void {
  sweepTestLeftovers(tmpdir());
  const root = mkdtempSync(join(tmpdir(), "edexo-test-run-"));
  for (const k of ["TEMP", "TMP", "TMPDIR"]) process.env[k] = root;
  return () => {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* a file still held open on Windows: the next run's folder is separate anyway */
    }
  };
}
