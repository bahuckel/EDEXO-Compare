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
import { loadJournalMergeCacheForTool } from "./probeCache.js";
import { exomasteryHabitatQualityPercent, loadExomasteryProfile } from "../src/server/exomasteryProfile.js";
import { rankSpeciesOnBody, TERM_DAMPING } from "../src/server/speciesLikelihood.js";
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

const payload = loadJournalMergeCacheForTool();
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
/**
 * `--model` ranks by the Bayes posterior instead of the habitat similarity, and `--damping=<x>`
 * sweeps the exponent on the likelihood terms. Both orderings are measured on exactly the same
 * bodies and the same candidate lists, so the only difference is the score they sort by.
 */
const USE_MODEL = process.argv.includes("--model");
const NO_PRIOR = process.argv.includes("--no-prior");
const MIN_SAMPLES = Number(
  (process.argv.find((a) => a.startsWith("--min-samples=")) ?? "--min-samples=1").split("=")[1],
);
const DAMPING = Number(
  (process.argv.find((a) => a.startsWith("--damping=")) ?? `--damping=${TERM_DAMPING}`).split("=")[1],
);

/**
 * Reliability of the posterior, for acceptance rule 3.
 *
 * Ordering is one claim and a percentage is a bigger one: a candidate the model calls 70 % has to be
 * right about seven times in ten or the number is decoration. Measured only on bodies whose truth is
 * complete — as many distinct truth genera as the game reports signals — because on a body where the
 * commander sampled one of three genera, a candidate outside that one is not a wrong answer.
 */
const CALIB_BINS = 10;
const calibration = Array.from({ length: CALIB_BINS }, () => ({ n: 0, hit: 0, predicted: 0 }));

/**
 * B3's number, measured on its own terms.
 *
 * After a DSS the genus is known and only the species is open, so the claim is "of the Bacterium
 * candidates, this one is 62 % likely to be the Bacterium down there". Truth for that is the genus
 * the commander actually sampled: within that genus exactly one candidate is right, because the game
 * places one species per genus per body.
 */
const genusCalibration = Array.from({ length: CALIB_BINS }, () => ({ n: 0, hit: 0, predicted: 0 }));

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
  /**
   * Both orderings, over the candidates both can score.
   *
   * The model declines on a profile under 20 bodies and the similarity does not, so scoring each on
   * whatever it can reach would compare them on different corpora — the model would look better for
   * having been asked fewer questions. Same rows, same species, one difference.
   */
  const posterior = new Map(
    rankSpeciesOnBody(matches, b.scan, rec, host, {
      root,
      damping: DAMPING,
      noPrior: NO_PRIOR,
      minSamples: MIN_SAMPLES,
    }).ranked.map((r) => [r.match.entry.id, r.probability]),
  );
  const scored = matches
    .map((m) => {
      const prof = loadExomasteryProfile(root, m.entry);
      // The app scores against the `Scan` merged with the body's exploration record — materials,
      // solid composition, the orbit fields. Passing null measured a scorer the app does not run.
      const q = prof ? exomasteryHabitatQualityPercent(prof, b.scan!, rec, host) : null;
      return { id: m.entry.id, q: q ?? -1, p: posterior.get(m.entry.id) ?? -1 };
    })
    .filter((x) => x.q >= 0 && x.p >= 0)
    .sort((x, y) => (USE_MODEL ? y.p - x.p : y.q - x.q));
  if (scored.length < 2) continue;
  scoredRows += scored.length;

  const truthComplete =
    b.biologicalSignals != null &&
    b.biologicalSignals > 0 &&
    new Set(truth.map((id) => db.species.find((e) => e.id === id)?.genusDataDir).filter(Boolean)).size ===
      b.biologicalSignals;
  if (truthComplete) {
    for (const row of scored) {
      /**
       * The posterior answers "which species is this", and the body has `k` of them. A candidate's
       * chance of being *one of* the truth set is that share times the number of signals — the same
       * constraint step 7's solver applies at genus level, and without it the number reads about
       * three times too low because the mean body carries three genera.
       */
      const scale = USE_MODEL ? (b.biologicalSignals ?? 1) : 1;
      const p = Math.max(0, Math.min(1, USE_MODEL ? row.p * scale : row.q / 100));
      const bin = calibration[Math.min(CALIB_BINS - 1, Math.floor(p * CALIB_BINS))]!;
      bin.n++;
      bin.predicted += p;
      if (truth.includes(row.id)) bin.hit++;
    }
  }

  for (const t of truth) {
    const truthGenus = db.species.find((e) => e.id === t)?.genusDataDir;
    if (truthGenus) {
      const sameGenus = scored.filter(
        (x) => db.species.find((e) => e.id === x.id)?.genusDataDir === truthGenus,
      );
      const total = sameGenus.reduce((sum, x) => sum + x.p, 0);
      if (sameGenus.length > 1 && total > 0) {
        for (const row of sameGenus) {
          const share = row.p / total;
          const bin = genusCalibration[Math.min(CALIB_BINS - 1, Math.floor(share * CALIB_BINS))]!;
          bin.n++;
          bin.predicted += share;
          if (row.id === t) bin.hit++;
        }
      }
    }

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

console.log(
  `\nordering           ${USE_MODEL ? `Bayes posterior (damping ${DAMPING}${NO_PRIOR ? ", no prior" : ""}, min ${MIN_SAMPLES})` : "habitat similarity"}`,
);
console.log(`ranked species     ${ranked}   over ${scoredRows} scored candidate rows`);
console.log(`mean rank          ${(rankSum / ranked).toFixed(3)}`);
console.log(`top-1              ${top1} (${((top1 / ranked) * 100).toFixed(1)}%)`);
console.log(`top-3              ${top3} (${((top3 / ranked) * 100).toFixed(1)}%)`);

if (USE_MODEL) {
  const rows = genusCalibration.reduce((n, c) => n + c.n, 0);
  if (rows > 0) {
    console.log(`\nwithin a known genus: which species is it (B3)`);
    for (const [i, c] of genusCalibration.entries()) {
      if (c.n === 0) continue;
      const lo = ((i / CALIB_BINS) * 100).toFixed(0);
      const hi = (((i + 1) / CALIB_BINS) * 100).toFixed(0);
      console.log(
        `  ${`${lo}-${hi} %`.padEnd(10)} ${String(c.n).padStart(5)} rows   mean predicted ${((c.predicted / c.n) * 100).toFixed(1).padStart(5)} %   observed ${((c.hit / c.n) * 100).toFixed(1).padStart(5)} %${c.n < 20 ? "   (thin)" : ""}`,
      );
    }
    const gap = genusCalibration.reduce(
      (sum, c) => sum + c.n * (c.predicted / Math.max(1, c.n) - c.hit / Math.max(1, c.n)) ** 2,
      0,
    );
    console.log(`  mean squared gap between the two columns: ${(gap / rows).toFixed(4)}`);
  }
}

const calibrated = calibration.filter((c) => c.n > 0);
if (calibrated.length) {
  console.log(`\nreliability on complete-label bodies (predicted vs observed)`);
  for (const [i, c] of calibration.entries()) {
    if (c.n === 0) continue;
    const lo = ((i / CALIB_BINS) * 100).toFixed(0);
    const hi = (((i + 1) / CALIB_BINS) * 100).toFixed(0);
    console.log(
      `  ${`${lo}-${hi} %`.padEnd(10)} ${String(c.n).padStart(5)} rows   mean predicted ${((c.predicted / c.n) * 100).toFixed(1).padStart(5)} %   observed ${((c.hit / c.n) * 100).toFixed(1).padStart(5)} %${c.n < 20 ? "   (thin)" : ""}`,
    );
  }
  const brier = calibration.reduce(
    (sum, c) => sum + c.n * (c.predicted / Math.max(1, c.n) - c.hit / Math.max(1, c.n)) ** 2,
    0,
  );
  const rows = calibration.reduce((n, c) => n + c.n, 0);
  console.log(`  mean squared gap between the two columns: ${(brier / Math.max(1, rows)).toFixed(4)}`);
}

worst.sort((a, b) => b.rank - a.rank);
console.log("\nburied deepest:");
for (const w of worst.slice(0, 8)) {
  console.log(`  ${String(w.rank).padStart(2)}/${w.of}  ${w.id} on ${w.body}`);
}

console.log(
  `host star resolved on ${bodies.filter((b) => hostStarFor(b) != null).length} of ${bodies.length} bodies`,
);
