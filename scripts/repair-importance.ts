/**
 * Re-apply the parameter-importance pass to every installed profile.
 *
 * `runPipeline` rewrites a profile wholesale, and `displayHistograms`, `histograms` and
 * `parameterImportance` are added afterwards by {@link applyParameterImportance} — importance is
 * relative to every other species, so it can only be measured once all the installs have landed.
 * `feeder -- run` called that pass; `feeder -- import` did not, so importing stripped all three
 * fields from every profile it touched.
 *
 * This is the repair for a corpus already in that state. The bug itself is fixed in `cmdImport`;
 * this exists so a tree damaged by an earlier import does not need a full pipeline re-run (which
 * would re-fetch from EDSM) to get its histograms back.
 *
 *     npm run feeder:repair-importance
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyParameterImportance, formatImportanceReport } from "../src/feeder/applyImportance.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const db = loadSpeciesDatabaseFromTree(root);
  console.log(`re-measuring importance over ${db.species.length} species rows…\n`);
  const report = await applyParameterImportance(db);
  console.log(formatImportanceReport(report));
}

await main();
