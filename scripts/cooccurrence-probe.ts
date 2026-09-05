/**
 * Does knowing which genera grow together tell us which of the candidates are on this body?
 *
 * The matcher offers `n` genera where the game reports `k` signals, and until now nothing chose
 * between them. This measures whether the co-occurrence table can, against two nulls it has to beat
 * to earn its place:
 *
 *   - **uniform**    — every candidate genus equally likely. What the app does today.
 *   - **prevalence** — genera weighted by how often the corpus sees them at all, no pair term.
 *   - **full**       — prevalence plus pairwise lift. The model.
 *
 * Ground truth is the same as the accuracy probe's: bodies where `ScanOrganic` resolved species, so
 * the genera present are known. The measurement is restricted to bodies where the truth is
 * *complete* — as many distinct truth genera as the game reports signals — because on a body where
 * the commander sampled 1 of 3 genera, a genus outside the sampled set is not a wrong answer.
 *
 * Reported:
 *   - **top-k accuracy** — of the `k` genera the model ranks highest, how many are really there;
 *   - **mean rank** of a truth genus in the ranked list;
 *   - **Brier score** on the per-genus probability, which is the number that has to be honest
 *     before any of it reaches the UI (acceptance rule 3);
 *   - **a reliability table** — predicted probability against observed frequency, in bins.
 *
 *   npx tsx scripts/cooccurrence-probe.ts
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import v8 from "node:v8";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { decodeJournalMergeCache } from "../src/server/journalMergeCacheEncoding.js";
import { loadGenusCooccurrenceTable } from "../src/server/genusCooccurrenceTable.js";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import { collectResolvedOrganicLockSpeciesIds } from "../src/server/organicLocks.js";
import { loadJournalMergeCacheForTool } from "./probeCache.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { computeExoPayoutRangeFromMatches } from "../src/server/exoPayoutRange.js";
import { loadPriceList, lookupPriceStrict } from "../src/server/priceList.js";
import { openFeederStore } from "../src/feeder/feederDb.js";
import { feederDataDirExists, feederDbPath } from "../src/feeder/paths.js";
import { findSpeciesEntryForLabel } from "../src/feeder/install.js";
import { tableFromGenusSets } from "../src/feeder/cooccurrence.js";
import { genusLikelihoods, type GenusLikelihoodOptions } from "../src/shared/genusCooccurrence.js";
import type { BodyExoState, SpeciesEntry } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = loadSpeciesDatabaseFromTree(root);
const byId = new Map<string, SpeciesEntry>(db.species.map((e) => [e.id, e]));

const table = loadGenusCooccurrenceTable(root);
if (!table) {
  console.error("No co-occurrence table. Run: npm run feeder -- cooccurrence");
  process.exit(1);
}

const payload = loadJournalMergeCacheForTool();
const bodies: BodyExoState[] = payload.bodies.map(([, b]) => b);

interface Case {
  bodyName: string;
  candidates: string[];
  truth: Set<string>;
  k: number;
}

/**
 * Bodies the question is actually asked on.
 *
 * Candidates come from the shown tier with `predictionUnsupported` rows removed — the same list the
 * certainty line counts, so the ranking is measured on what the commander is shown rather than on
 * an internal superset.
 */
function collectCases(): { cases: Case[]; skipped: Record<string, number> } {
  const cases: Case[] = [];
  const skipped: Record<string, number> = {
    "no truth": 0,
    "no signal count": 0,
    "incomplete labels": 0,
    "already decided": 0,
    "truth outside candidates": 0,
  };

  for (const b of bodies) {
    if (!b.scan?.PlanetClass?.trim()) continue;
    const truthIds = collectResolvedOrganicLockSpeciesIds(b.organicGenusLocks, db);
    if (!truthIds.length) {
      skipped["no truth"]!++;
      continue;
    }
    const k = b.biologicalSignals ?? 0;
    if (!k || k <= 0) {
      skipped["no signal count"]!++;
      continue;
    }
    const truth = new Set(
      truthIds.map((id) => byId.get(id)?.genusDataDir).filter((g): g is string => Boolean(g)),
    );
    if (truth.size !== k) {
      skipped["incomplete labels"]!++;
      continue;
    }

    const matches = matchDatabaseToScan(db, b.scan, null, null, { includeBacterium: true }).matches;
    const candidates = [
      ...new Set(
        matches.filter((m) => !m.unlikely && !m.entry.predictionUnsupported).map((m) => m.entry.genusDataDir),
      ),
    ];
    if (candidates.length <= k) {
      // Certain or under-covered: the signal-count rule already answers these without a model.
      skipped["already decided"]!++;
      continue;
    }
    if (![...truth].every((g) => candidates.includes(g))) {
      // The ranking cannot recover a genus the gates excluded; counting these would measure recall.
      skipped["truth outside candidates"]!++;
      continue;
    }
    cases.push({ bodyName: b.bodyName ?? String(b.bodyId), candidates, truth, k });
  }
  return { cases, skipped };
}

interface VariantResult {
  name: string;
  topKHit: number;
  topKTotal: number;
  bodiesFullyRight: number;
  rankSum: number;
  rankCount: number;
  brierSum: number;
  brierCount: number;
  bins: { hit: number; n: number; predSum: number }[];
}

const BIN_COUNT = 10;

function runVariant(name: string, cases: Case[], options: GenusLikelihoodOptions): VariantResult {
  const r: VariantResult = {
    name,
    topKHit: 0,
    topKTotal: 0,
    bodiesFullyRight: 0,
    rankSum: 0,
    rankCount: 0,
    brierSum: 0,
    brierCount: 0,
    bins: Array.from({ length: BIN_COUNT }, () => ({ hit: 0, n: 0, predSum: 0 })),
  };

  for (const c of cases) {
    const res = genusLikelihoods(table!, c.candidates, c.k, [], options);
    if (!res) continue;
    const ranked = res.likelihoods;
    const top = ranked.slice(0, c.k);
    const hit = top.filter((l) => c.truth.has(l.genus)).length;
    r.topKHit += hit;
    r.topKTotal += c.k;
    if (hit === c.k) r.bodiesFullyRight++;

    for (const [i, l] of ranked.entries()) {
      const present = c.truth.has(l.genus);
      if (present) {
        r.rankSum += i + 1;
        r.rankCount++;
      }
      const p = Math.max(0, Math.min(1, l.probability));
      r.brierSum += (p - (present ? 1 : 0)) ** 2;
      r.brierCount++;
      const bin = Math.min(BIN_COUNT - 1, Math.floor(p * BIN_COUNT));
      r.bins[bin]!.n++;
      r.bins[bin]!.predSum += p;
      if (present) r.bins[bin]!.hit++;
    }
  }
  return r;
}

function report(r: VariantResult): void {
  const acc = r.topKTotal ? (r.topKHit / r.topKTotal) * 100 : 0;
  const meanRank = r.rankCount ? r.rankSum / r.rankCount : 0;
  const brier = r.brierCount ? r.brierSum / r.brierCount : 0;
  console.log(
    `  ${r.name.padEnd(12)} top-k ${acc.toFixed(1)}%  (${r.topKHit}/${r.topKTotal})   ` +
      `whole body right ${r.bodiesFullyRight}   mean rank ${meanRank.toFixed(2)}   Brier ${brier.toFixed(4)}`,
  );
}

const { cases, skipped } = collectCases();

console.log(
  `\nco-occurrence table: ${table.bodies} bodies, ${Object.keys(table.genera).length} genera, ` +
    `${Object.keys(table.pairs).length} observed pairs`,
);
console.log(
  `cases: ${cases.length} ambiguous bodies with complete truth labels ` +
    `(${Object.entries(skipped)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ")})`,
);

const variants = [
  runVariant("uniform", cases, { usePrevalence: false, usePairs: false }),
  runVariant("prevalence", cases, { usePrevalence: true, usePairs: false }),
  // Ungated on purpose: with nothing known on the body the shipped default switches the pair term
  // off (PAIR_TERM_MIN_KNOWN), so this row measures what that gate is protecting the ranking from.
  runVariant("pairs", cases, { usePrevalence: true, usePairs: true }),
];

console.log("\n── ranking ─────────────────────────────────────────────");
for (const v of variants) report(v);

/**
 * Calibration, which is the gate on showing any of this as a percentage.
 *
 * A number that says 70 % has to be right about 70 % of the time, or it is decoration. Bins with
 * fewer than 20 observations are printed but marked, because a bin of four proves nothing either way.
 */
console.log("\n── reliability of the ranking ───────────────────────");
console.log("  predicted      n     mean predicted   observed");
const full = variants[2]!;
for (const [i, b] of full.bins.entries()) {
  if (b.n === 0) continue;
  const lo = ((i / BIN_COUNT) * 100).toFixed(0);
  const hi = (((i + 1) / BIN_COUNT) * 100).toFixed(0);
  const observed = (b.hit / b.n) * 100;
  const predicted = (b.predSum / b.n) * 100;
  console.log(
    `  ${`${lo}–${hi} %`.padEnd(12)} ${String(b.n).padStart(5)}   ${predicted.toFixed(1).padStart(12)} %   ${observed
      .toFixed(1)
      .padStart(7)} %${b.n < 20 ? "   (thin)" : ""}`,
  );
}
console.log("");

/**
 * The same question against the corpus, held out.
 *
 * 36 journal bodies cannot settle whether the pair term is worth its place — the commander has
 * landed on too few ambiguous bodies. The corpus has 8,490 bodies carrying more than one genus, and
 * the model's claim can be tested on them directly: hide one genus of a body, tell the model the
 * others, and see where the hidden one lands in the ranking. Five folds, and the table for each fold
 * is rebuilt from the other four so no body is ever ranked by a table that has seen it.
 *
 * This is the case A5 described — "map a 3-signal body, scan two genera, the third collapses to a
 * short list" — measured rather than asserted.
 */
async function crossValidate(): Promise<void> {
  if (!feederDataDirExists()) {
    console.log("no feeder corpus — skipping cross-validation");
    return;
  }
  const store = await openFeederStore(feederDbPath());
  const st = store.db.prepare("SELECT planet_id, species_label FROM sightings");
  const genusOfLabel = new Map<string, string | null>();
  const byPlanet = new Map<number, Set<string>>();
  while (st.step()) {
    const [planetId, label] = st.get() as [number, string];
    if (!genusOfLabel.has(label)) {
      genusOfLabel.set(label, findSpeciesEntryForLabel(db, label)?.genusDataDir ?? null);
    }
    const genus = genusOfLabel.get(label);
    if (!genus) continue;
    const set = byPlanet.get(planetId) ?? new Set<string>();
    set.add(genus);
    byPlanet.set(planetId, set);
  }
  store.close();

  const FOLDS = 5;
  const folds: Set<string>[][] = Array.from({ length: FOLDS }, () => []);
  for (const [planetId, set] of byPlanet) {
    // Every body trains — including the 1,809 carrying a single genus, which is where a genus'
    // prevalence comes from. Only multi-genus bodies can be *tested*, because hiding the only genus
    // on a body leaves nothing to condition on.
    folds[planetId % FOLDS]!.push(set);
  }

  interface CvStats {
    n: number;
    rankSum: number;
    top1: number;
    top3: number;
  }
  const stats: Record<string, CvStats> = {
    prevalence: { n: 0, rankSum: 0, top1: 0, top3: 0 },
    full: { n: 0, rankSum: 0, top1: 0, top3: 0 },
  };
  let pool = 0;

  for (let f = 0; f < FOLDS; f++) {
    const train = folds.filter((_, i) => i !== f).flat();
    const trained = tableFromGenusSets(train);
    const candidates = Object.keys(trained.genera);
    pool = candidates.length;

    for (const set of folds[f]!) {
      const members = [...set].filter((g) => candidates.includes(g));
      if (members.length < 2) continue;
      for (const hidden of members) {
        const known = members.filter((g) => g !== hidden);
        for (const [name, opts] of [
          ["prevalence", { usePrevalence: true, usePairs: false }],
          ["full", { usePrevalence: true, usePairs: true }],
        ] as [string, GenusLikelihoodOptions][]) {
          const res = genusLikelihoods(trained, candidates, members.length, known, opts);
          if (!res) continue;
          const ranked = res.likelihoods.filter((l) => !known.includes(l.genus));
          const idx = ranked.findIndex((l) => l.genus === hidden);
          if (idx < 0) continue;
          const s = stats[name]!;
          s.n++;
          s.rankSum += idx + 1;
          if (idx === 0) s.top1++;
          if (idx < 3) s.top3++;
        }
      }
    }
  }

  console.log("── held-out corpus: name the genus we hid ──────────────");
  console.log(
    `  ${stats.full!.n} cases over ${FOLDS} folds, ranking ${pool} genera with the rest of the body known`,
  );
  for (const [name, s] of Object.entries(stats)) {
    if (!s.n) continue;
    console.log(
      `  ${name.padEnd(12)} mean rank ${(s.rankSum / s.n).toFixed(3)}   ` +
        `top-1 ${((s.top1 / s.n) * 100).toFixed(1)}%   top-3 ${((s.top3 / s.n) * 100).toFixed(1)}%`,
    );
  }
  console.log("");
}

/**
 * What the body is worth, against what it turned out to be worth.
 *
 * The panel already shows a floor and a ceiling — the `k` cheapest and `k` priciest candidates — and
 * on an eleven-candidate body those are far apart. A point estimate is the number the commander
 * actually wants, and it only earns its place if it beats the obvious one: the middle of that range.
 *
 * Truth is what the commander sold: the list price of every species they sampled on the body, on
 * complete-label bodies so nothing is unaccounted for. Multiplier left at 1 throughout — first
 * footfall scales every estimate and the truth alike, so including it would only inflate the errors.
 */
function reportExpectedValue(): void {
  const prices = loadPriceList(root);
  const genusMeanPrice = (matches: { entry: SpeciesEntry }[], genus: string): number => {
    const vals = matches
      .filter((m) => m.entry.genusDataDir === genus)
      .map((m) => lookupPriceStrict(prices, m.entry.displayName, m.entry.id))
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };

  const errs: Record<string, number[]> = { midpoint: [], uniform: [], model: [] };
  const narrowed: { inside: boolean; width: number; fullInside: boolean; fullWidth: number }[] = [];
  let n = 0;

  for (const b of bodies) {
    if (!b.scan?.PlanetClass?.trim()) continue;
    const k = b.biologicalSignals ?? 0;
    if (k <= 0) continue;
    const truthIds = collectResolvedOrganicLockSpeciesIds(b.organicGenusLocks, db);
    if (!truthIds.length) continue;
    const truthGenera = new Set(
      truthIds.map((id) => byId.get(id)?.genusDataDir).filter((g): g is string => Boolean(g)),
    );
    if (truthGenera.size !== k) continue;

    const actual = truthIds
      .map((id) => byId.get(id))
      .map((e) => (e ? (lookupPriceStrict(prices, e.displayName, e.id) ?? 0) : 0))
      .reduce((a, x) => a + x, 0);
    if (actual <= 0) continue;

    const matches = matchDatabaseToScan(db, b.scan, null, null, { includeBacterium: true }).matches.filter(
      (m) => !m.unlikely && !m.entry.predictionUnsupported,
    );
    const candidates = [...new Set(matches.map((m) => m.entry.genusDataDir))];
    if (candidates.length < k) continue;

    const range = computeExoPayoutRangeFromMatches(matches, prices, k, "bio_signals", 1, null, false);
    if (!range) continue;
    const midpoint = (range.minCr + range.maxCr) / 2;
    const uniform = candidates.reduce((s, g) => s + (k / candidates.length) * genusMeanPrice(matches, g), 0);

    const res = genusLikelihoods(table!, candidates, k);
    const model = res
      ? res.likelihoods.reduce((s, l) => s + l.probability * genusMeanPrice(matches, l.genus), 0)
      : uniform;

    errs.midpoint!.push(midpoint - actual);
    errs.uniform!.push(uniform - actual);
    errs.model!.push(model - actual);
    n++;

    // The other way to use a ranking: keep a range, but build it from the k genera the model ranks
    // highest instead of from every candidate. One species per genus, cheapest for the floor and
    // priciest for the ceiling — the same rule the panel already uses, over a shorter list.
    if (res) {
      const top = res.likelihoods.slice(0, k).map((l) => l.genus);
      const perGenus = top.map((g) => {
        const vals = matches
          .filter((m) => m.entry.genusDataDir === g)
          .map((m) => lookupPriceStrict(prices, m.entry.displayName, m.entry.id))
          .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
      });
      if (perGenus.every((x) => x !== null)) {
        const nMin = perGenus.reduce((sum, x) => sum + x!.min, 0);
        const nMax = perGenus.reduce((sum, x) => sum + x!.max, 0);
        narrowed.push({
          inside: actual >= nMin && actual <= nMax,
          width: nMax - nMin,
          fullInside: actual >= range.minCr && actual <= range.maxCr,
          fullWidth: range.maxCr - range.minCr,
        });
      }
    }
  }

  console.log("── expected value against what the body paid ───────────");
  console.log(`  ${n} complete-label bodies with a priced truth set`);
  for (const [name, list] of Object.entries(errs)) {
    if (!list.length) continue;
    const mae = list.reduce((s, x) => s + Math.abs(x), 0) / list.length;
    const bias = list.reduce((s, x) => s + x, 0) / list.length;
    const sorted = [...list].map(Math.abs).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    console.log(
      `  ${name.padEnd(12)} mean error ${(mae / 1e6).toFixed(2)} M   median ${(median / 1e6).toFixed(2)} M   bias ${(bias / 1e6).toFixed(2)} M`,
    );
  }
  if (narrowed.length) {
    const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
    console.log(
      `  full range   holds the answer on ${narrowed.filter((x) => x.fullInside).length}/${narrowed.length}` +
        `   mean width ${(mean(narrowed.map((x) => x.fullWidth)) / 1e6).toFixed(2)} M`,
    );
    console.log(
      `  top-k range  holds the answer on ${narrowed.filter((x) => x.inside).length}/${narrowed.length}` +
        `   mean width ${(mean(narrowed.map((x) => x.width)) / 1e6).toFixed(2)} M`,
    );
  }
  console.log("");
}

reportExpectedValue();

await crossValidate();
