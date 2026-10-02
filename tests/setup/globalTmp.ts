/**
 * One temporary folder per test run, removed when the run ends (review F-F13).
 *
 * Every test file made its own user-data folder in %TEMP% (tests/setup/userDataDir.ts) and several
 * made more with `mkdtempSync(tmpdir())`; none were removed. The owner's %TEMP% held 94,589
 * `edexo-test-userdata-*` folders and thousands of others on 2026-10-02. TEMP, TMP and TMPDIR point
 * into this run's folder before the workers start, so `os.tmpdir()` in every test lands inside it,
 * and the teardown takes the lot.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default function setup(): () => void {
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
