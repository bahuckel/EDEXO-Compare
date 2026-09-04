/**
 * Ranking harness — the companion to `accuracy-probe.ts`.
 *
 * The accuracy probe answers "was the right species offered at all". That is a question about the
 * **gates**. This one answers "and where in the list did it land", which is a question about the
 * **weights** — a correct answer buried at position 12 of 13 is a list the commander still has to
 * fly out and resolve by hand.
 *
 * Ground truth is the same: every body where a `ScanOrganic` resolved to a species. Candidates are
 * re-matched with the genus hints withheld, so the matcher cannot see the answer, then sorted by
 * exomastery habitat percentage — the one score the app computes per candidate today.
 *
 *   npx tsx scripts/rank-probe.ts
 *
 * Reads the local journal merge cache, so the numbers are specific to this commander's history.
 * Run the app once first if the cache does not exist yet.
 *
 * Baseline, 2026-09-04, before the habitat tier weights (`3b(ii)`):
 *   mean rank 6.430, top-1 24.2%, top-3 49.1%   over 409 ranked species
 * After:
 *   mean rank 6.149, top-1 24.0%, top-3 49.4%
 */
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import v8 from "node:v8";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { matchDatabaseToScan, shownSpeciesMatches } from "../src/server/matchSpecies.js";
import { decodeJournalMergeCache } from "../src/server/journalMergeCacheEncoding.js";
import { collectResolvedOrganicLockSpeciesIds } from "../src/server/organicLocks.js";
import { resolveJournalMergeCacheRoot } from "../src/server/paths.js";
import { exomasteryHabitatQualityPercent, loadExomasteryProfile } from "../src/server/exomasteryProfile.js";
import { resolveHostStarBodyId } from "../src/server/orbitUtils.js";
import { journalHostObservationFromSpeciesContext } from "../src/server/journalHostObservation.js";
import type {
  BodyExoState,
  ExplorationScanRecord,
  JournalHostStarObservation,
  SpeciesMatchContext,
} from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = loadSpeciesDatabaseFromTree(root);

const payloadPath = path.join(resolveJournalMergeCacheRoot(), "journal-merge.payload.v8gz");
if (!existsSync(payloadPath)) {
  console.error(`No journal merge cache at ${payloadPath}. Run the app once to build it.`);
  process.exit(1);
}
const raw = readFileSync(payloadPath);
const doc =
  raw[0] === 0x1f && raw[1] === 0x8b ? v8.deserialize(gunzipSync(raw)) : JSON.parse(raw.toString("utf8"));
const payload = decodeJournalMergeCache(doc);
if (!payload) {
  console.error("Cache is not in the current encoding; delete it and let the app rebuild.");
  process.exit(1);
}
const bodies: BodyExoState[] = payload.bodies.map(([, b]) => b);

/**
 * Host-star observation per body, rebuilt from the merged exploration scans.
 *
 * Sold systems included, since the physics survives the sale (`soldExplorationScans`). Without them
 * a host star resolved on 196 of 13,713 bodies and every star term was measured against nothing.
 *
 * The app passes this into the habitat scorer and this probe did not, which made the probe blind to
 * every host-star term — the parameter where measured determinism finds its sharpest signals
 * (Bacterium volu and Fumerola extremus both key entirely on star type). Ranking measured without it
 * cannot see the effect of weighting it.
 */
const scansBySystem = new Map<number, Map<number, ExplorationScanRecord>>();
for (const [, r] of [...(payload.soldExplorationScans ?? []), ...payload.explorationScans]) {
  const byId = scansBySystem.get(r.systemAddress) ?? new Map<number, ExplorationScanRecord>();
  byId.set(r.bodyId, r);
  scansBySystem.set(r.systemAddress, byId);
}

function hostStarFor(b: BodyExoState): JournalHostStarObservation | null {
  const byId = scansBySystem.get(b.systemAddress);
  const rec = byId?.get(b.bodyId);
  if (!byId || !rec) return null;
  const starId = resolveHostStarBodyId(rec, byId);
  if (starId == null) return null;
  const star = byId.get(starId);
  if (!star?.starType?.trim()) return null;
  return journalHostObservationFromSpeciesContext({
    parentStarType: star.starType,
    parentStarSubclass: star.subclass,
    parentStarLuminosity: star.luminosity,
  } as unknown as SpeciesMatchContext);
}

let ranked = 0;
let rankSum = 0;
let top1 = 0;
let top3 = 0;
let scoredRows = 0;
/** Where the truth species landed, so a regression can be traced to a body rather than a mean. */
const worst: { rank: number; of: number; id: string; body: string }[] = [];

for (const b of bodies) {
  const truth = collectResolvedOrganicLockSpeciesIds(b.organicGenusLocks, db);
  if (!truth.length || !b.scan?.PlanetClass?.trim()) continue;
  // The shown tier only. The demoted rows are collapsed behind "show unlikely (N)", so where they
  // land is a question for step 6's ranking, not for this measurement of the default panel.
  const matches = shownSpeciesMatches(
    matchDatabaseToScan(db, b.scan, null, null, { includeBacterium: true }).matches,
  );
  if (matches.length < 2) continue;

  const host = hostStarFor(b);
  const rec = scansBySystem.get(b.systemAddress)?.get(b.bodyId) ?? null;
  // Only candidates with a feeder profile can be scored; a body where nothing scores has no ranking
  // to measure, and counting it would flatter whichever weighting is in place.
  const scored = matches
    .map((m) => {
      const prof = loadExomasteryProfile(root, m.entry);
      // The app scores against the `Scan` merged with the body's exploration record — materials,
      // solid composition, the orbit fields. Passing null here measured a scorer the app does not run.
      const q = prof ? exomasteryHabitatQualityPercent(prof, b.scan!, rec, host) : null;
      return { id: m.entry.id, q: q ?? -1 };
    })
    .filter((x) => x.q >= 0);
  if (scored.length < 2) continue;
  scoredRows += scored.length;
  scored.sort((x, y) => y.q - x.q);

  for (const t of truth) {
    const i = scored.findIndex((x) => x.id === t);
    if (i < 0) continue; // missed entirely: that is the accuracy probe's business, not this one
    ranked++;
    rankSum += i + 1;
    if (i === 0) top1++;
    if (i < 3) top3++;
    worst.push({ rank: i + 1, of: scored.length, id: t, body: b.bodyName });
  }
}

if (ranked === 0) {
  console.error("No truth species could be ranked — are the exomastery profiles present?");
  process.exit(1);
}

console.log(`\nranked species     ${ranked}   over ${scoredRows} scored candidate rows`);
console.log(`mean rank          ${(rankSum / ranked).toFixed(3)}`);
console.log(`top-1              ${top1} (${((top1 / ranked) * 100).toFixed(1)}%)`);
console.log(`top-3              ${top3} (${((top3 / ranked) * 100).toFixed(1)}%)`);

worst.sort((a, b) => b.rank - a.rank);
console.log("\nburied deepest:");
for (const w of worst.slice(0, 8)) {
  console.log(`  ${String(w.rank).padStart(2)}/${w.of}  ${w.id} on ${w.body}`);
}

console.log(
  `host star resolved on ${bodies.filter((b) => hostStarFor(b) != null).length} of ${bodies.length} bodies`,
);
