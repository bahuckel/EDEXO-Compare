import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * After copying `data/` into a pack/staging folder, merge optional directories on top.
 * Use this for large `*_exomastery.json` packs that you keep out of `data/` (or out of git).
 *
 * Merge order; later merges overwrite the same relative paths:
 * 1. `EDEXO_DATA_OVERLAY` — path to a folder whose layout mirrors `data/` (e.g. contains `species/...`).
 * 2. `./exomastery-overlay` at the repo root, if it exists.
 *
 * @param {string} stagingDataDir — absolute or cwd-relative `.../data` directory to merge into
 * @param {string} [cwd=process.cwd()]
 */
export function mergeDataOverlays(stagingDataDir, cwd = process.cwd()) {
  const extra = [];
  const env = process.env.EDEXO_DATA_OVERLAY?.trim();
  if (env) extra.push(env);
  const local = join(cwd, "exomastery-overlay");
  if (existsSync(local)) extra.push(local);

  for (const dir of extra) {
    if (!existsSync(dir)) {
      console.warn(`[mergeDataOverlay] skip (not found): ${dir}`);
      continue;
    }
    cpSync(dir, stagingDataDir, { recursive: true });
    console.info(`[mergeDataOverlay] merged into pack data: ${dir}`);
  }
}
