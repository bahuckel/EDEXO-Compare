/**
 * Point every test file at a throwaway user-data directory before it runs.
 *
 * The app keeps real things next to the user settings — the LAN key, the EDSM credentials and
 * upload ledger, the outlier log, and now the learned on-foot catalog. Anything that resolves one of
 * those paths without an override resolves the **commander's own**, and a test that writes there is
 * editing live data on the machine that ran it. That happened: a full suite run copied the
 * developer's real catalog into `%LOCALAPPDATA%\ED Exo Compare\` and then wrote a fixture row into
 * it.
 *
 * Individual files already set `EDEXO_USER_DATA_DIR` in their own hooks, and that is not enough on
 * its own. Vitest runs files in parallel, each saves whatever it found and restores it afterwards,
 * and when the value it found was unset, `delete process.env.EDEXO_USER_DATA_DIR` in one file's
 * teardown lands in the middle of another file's test. The leak only appears in a full run, which is
 * the worst way for it to appear.
 *
 * With a directory set here the saved value is never `undefined`, so those restores put the
 * throwaway directory back instead of removing the override, and a file that forgets to isolate
 * itself is still harmless. One directory per worker keeps parallel files from sharing state.
 */
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

if (!process.env.EDEXO_USER_DATA_DIR?.trim()) {
  process.env.EDEXO_USER_DATA_DIR = mkdtempSync(join(tmpdir(), "edexo-test-userdata-"));
}
