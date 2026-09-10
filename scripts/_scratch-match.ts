import { readFileSync } from "node:fs";
import { GameStateStore } from "../src/server/gameState.js";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import { matchDatabaseToScan, shownSpeciesMatches } from "../src/server/matchSpecies.js";
import { buildSpeciesMatchContext } from "../src/server/speciesMatchContext.js";

const p = "C:/Users/FeraL/Saved Games/Frontier Developments/Elite Dangerous/Journal.2026-09-10T183704.01.log";
const st = new GameStateStore();
for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(line) as Record<string, unknown>;
  } catch {
    continue;
  }
  if (j.event === "SAASignalsFound" || j.event === "ScanOrganic") continue;
  st.apply(j);
}
const exo = st.bodies.get("869605083755:4")!;
const db = loadSpeciesDatabase();
const ctx = buildSpeciesMatchContext(exo, st);
const run = matchDatabaseToScan(db, exo.scan!, exo.genusHints, exo.organicGenusLocks, {
  includeBacterium: true,
  matchContext: ctx,
});
const shown = shownSpeciesMatches(run.matches);
console.log("shown:", shown.length);
for (const m of shown) console.log("  ", m.entry.displayName);
