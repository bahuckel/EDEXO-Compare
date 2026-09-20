/**
 * What the app panel would render, for the bodies he most recently flew past.
 *
 * He reports seeing Bacterium tela on ~95 % of planets *in the app panel*. Measured from the same
 * cache the app reads, the panel should show it on 47.6 % overall and 36.3 % of probed bodies. One
 * of those two numbers is wrong, and the way to find out which is to replay the panel's own path on
 * the bodies he actually saw rather than on the whole history.
 *
 * The panel's path, in order, is: match → rank → write `presenceProbabilityPercent` and
 * `genusSharePercent` → `demoteBelowPresenceFloor` → the client keeps `!unlikely` rows. Any step
 * skipped here makes the answer a different question, which is how the first tela probe reported
 * 99.4 %.
 *
 *   npx tsx scripts/panel-replay.ts [--n 25] [--species "Bacterium tela"]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import { loadJournalMergeCacheForTool } from "./probeCache.js";
import { regionIndexForSystem, regionForSystem } from "../src/server/regionMapData.js";
import { resolveHostStarBodyId } from "../src/server/orbitUtils.js";
import { journalHostObservationFromSpeciesContext } from "../src/server/journalHostObservation.js";
import { rankSpeciesOnBody, REGION_PRIOR_WEIGHT } from "../src/server/speciesLikelihood.js";
import { demoteBelowPresenceFloor } from "../src/server/snapshot.js";
import { genusShares } from "../src/shared/systemTriage.js";
import type { BodyExoState, ExplorationScanRecord, SpeciesMatchContext } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const argOf = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : d;
};
const howMany = Number(argOf("n", "25"));
const speciesName = argOf("species", "Bacterium tela").toLowerCase();

const db = loadSpeciesDatabaseFromTree(root);
const payload = loadJournalMergeCacheForTool();
const bodies: BodyExoState[] = payload.bodies.map(([, b]) => b);

const scansBySystem = new Map<number, Map<number, ExplorationScanRecord>>();
for (const [, r] of [...(payload.soldExplorationScans ?? []), ...payload.explorationScans]) {
  const m = scansBySystem.get(r.systemAddress) ?? new Map<number, ExplorationScanRecord>();
  m.set(r.bodyId, r);
  scansBySystem.set(r.systemAddress, m);
}
const systemPositions = new Map<number, { x: number; y: number; z: number }>(payload.systemPositions ?? []);

function contextFor(b: BodyExoState): SpeciesMatchContext | undefined {
  const byId = scansBySystem.get(b.systemAddress);
  const rec = byId?.get(b.bodyId);
  const ctx: SpeciesMatchContext = {};
  const pos = systemPositions.get(b.systemAddress);
  if (pos) {
    const idx = regionIndexForSystem(root, pos.x, pos.z);
    if (idx != null && idx > 0) {
      const name = regionForSystem(root, pos.x, pos.y, pos.z);
      if (name) {
        ctx.regionName = name;
        ctx.regionIndex = idx;
      }
    }
  }
  if (byId && rec) {
    const starId = resolveHostStarBodyId(rec, byId);
    const star = starId == null ? null : byId.get(starId);
    if (star?.starType?.trim()) ctx.parentStarType = star.starType;
  }
  const classes: string[] = [];
  for (const [bodyId, r] of byId ?? []) {
    if (bodyId === b.bodyId) continue;
    const pc = r.planetClass?.trim();
    if (pc) classes.push(pc);
  }
  if (classes.length) ctx.systemBodyClasses = [...new Set(classes)];
  return Object.keys(ctx).length ? ctx : undefined;
}

const recent = bodies
  .filter((b) => (b.biologicalSignals ?? 0) > 0 && b.scan?.PlanetClass?.trim())
  .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
  .slice(0, howMany);

console.log(`the ${recent.length} most recently updated bodies with a bio signal\n`);
console.log(
  `${"body".padEnd(34)} ${"atmosphere".padEnd(16)} ${"DSS".padEnd(4)} ${"panel rows".padStart(10)} ${"target shown".padStart(13)}  top rows`,
);

let shownCount = 0;
for (const b of recent) {
  const ctx = contextFor(b);
  const rec = scansBySystem.get(b.systemAddress)?.get(b.bodyId) ?? null;
  const host = ctx ? journalHostObservationFromSpeciesContext(ctx) : null;

  const matches = matchDatabaseToScan(db, b.scan!, b.genusHints ?? null, null, {
    includeBacterium: true,
    matchContext: ctx,
    biologicalSignals: b.biologicalSignals,
  }).matches.filter((m) => !m.unlikely);

  const { ranked } = rankSpeciesOnBody(matches, b.scan!, rec, host, {
    root,
    regionPrior: true,
    regionIndex: ctx?.regionIndex ?? null,
    regionPriorWeight: REGION_PRIOR_WEIGHT,
  });
  const scale = (b.biologicalSignals ?? 1) > 0 ? b.biologicalSignals! : 1;
  for (const r of ranked) {
    r.match.presenceProbabilityPercent = Math.round(Math.max(0, Math.min(1, r.probability * scale)) * 1000) / 10;
  }
  const rows = ranked.map((r) => ({ genus: r.match.entry.genusDataDir, probability: r.probability, r }));
  const shares = genusShares(rows);
  for (const row of rows) {
    const sh = shares.get(row);
    row.r.match.genusSharePercent = sh == null ? null : Math.round(sh * 1000) / 10;
  }

  demoteBelowPresenceFloor(matches as unknown as Parameters<typeof demoteBelowPresenceFloor>[0], b, db);
  const panel = matches.filter((m) => !m.unlikely);
  const hasTarget = panel.some((m) => m.entry.displayName.toLowerCase() === speciesName);
  if (hasTarget) shownCount += 1;

  const top = [...panel]
    .sort((x, y) => (y.presenceProbabilityPercent ?? 0) - (x.presenceProbabilityPercent ?? 0))
    .slice(0, 3)
    .map((m) => `${m.entry.displayName} ${(m.presenceProbabilityPercent ?? 0).toFixed(0)}%`)
    .join(", ");

  console.log(
    `${(b.bodyName ?? "").slice(0, 33).padEnd(34)} ${(b.scan?.AtmosphereType ?? "-").padEnd(16)} ` +
      `${(b.genusHints?.length ? "yes" : "no").padEnd(4)} ${String(panel.length).padStart(10)} ${(hasTarget ? "YES" : "-").padStart(13)}  ${top}`,
  );
}

console.log(`\ntarget shown on ${shownCount} of ${recent.length} (${((shownCount / Math.max(1, recent.length)) * 100).toFixed(0)} %)`);
