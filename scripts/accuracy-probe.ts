/**
 * Predictor accuracy harness.
 *
 * Ground truth comes from the journal itself: every body where a `ScanOrganic` resolved to a species
 * is a body where we know what actually grew there. Each one is re-matched **without** the organic
 * locks, so the matcher cannot see the answer.
 *
 * Every run reports **both scenarios**, because they answer different questions and only one of them
 * is the app's purpose:
 *
 *   - **FSS-only** — DSS genus hints withheld. This is the case the app exists for: deciding whether
 *     to fly to a body at all. Measured over 244 journals, `FSSBodySignals` carries `Genuses` zero
 *     times and `SAASignalsFound` carries it every time, so before travelling the commander has the
 *     signal *count* and nothing else. Every truth body has been landed on and therefore carries
 *     hints; withholding them is the only way to measure the real scenario.
 *   - **post-DSS** — hints supplied. The refinement case, after the trip is already paid for.
 *
 * Metrics, per scenario:
 *
 *   - **recall** — was the species the commander actually found offered at all;
 *   - **value-weighted recall** — the same, weighted by payout, because missing a 19 M Stratum is
 *     not the same as missing a 1 M Bacterium;
 *   - **genus recall** — post-FSS the decision is made on genera and credits, not species;
 *   - **ambiguity** — how many candidates the commander was left to choose between;
 *   - **precision** on the complete-label subset — bodies where the distinct truth genera equal the
 *     FSS signal count, so every candidate outside the truth set is provably a false positive.
 *
 * And across the whole FSS corpus, including the bodies never landed on:
 *
 *   - **decidability** — the share of bodies where the candidate genus set exactly matches the
 *     signal count, so the app can say "these genera are present" rather than "one of these twelve".
 *     A long correct list still fails the commander, so this, not recall, is what the queue optimises.
 *
 *   npx tsx scripts/accuracy-probe.ts
 *   USE_FEEDER_TEMP=1 npx tsx scripts/accuracy-probe.ts   # observed ranges instead of codex gates
 *
 * Reads the local journal merge cache, so the numbers are specific to this commander's history.
 * Run the app once first if the cache does not exist yet.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import v8 from "node:v8";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import { decodeJournalMergeCache } from "../src/server/journalMergeCacheEncoding.js";
import { collectResolvedOrganicLockSpeciesIds } from "../src/server/organicLocks.js";
import { resolveJournalMergeCacheRoot } from "../src/server/paths.js";
import { loadPriceList, lookupPrice } from "../src/server/priceList.js";
import type { BodyExoState, SpeciesEntry } from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = loadSpeciesDatabaseFromTree(root);
const prices = loadPriceList(root);
const byId = new Map<string, SpeciesEntry>(db.species.map((e) => [e.id, e]));

/**
 * Swap each species' codex temperature gate for the range actually observed in its exomastery
 * feeder profile. Profiles with fewer than 20 samples are left alone — one or two observations say
 * nothing about a range.
 */
if (process.env.USE_FEEDER_TEMP === "1") {
  let patched = 0;
  for (const e of db.species) {
    const dir = path.join(root, "data", "species", e.genusDataDir, "exomastery");
    if (!existsSync(dir)) continue;
    const slug = e.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const file = readdirSync(dir).find((f) => f.toLowerCase() === `${slug}_exomastery.json`);
    if (!file) continue;
    try {
      const prof = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as {
        numerics?: Record<string, { min: number; max: number; count: number }>;
      };
      const t = prof.numerics?.["body.surfaceTemperature"];
      if (!t || !Number.isFinite(t.min) || !Number.isFinite(t.max) || (t.count ?? 0) < 20) continue;
      (e.criteria as Record<string, unknown>).surfaceTemperatureK = { min: t.min, max: t.max };
      patched++;
    } catch {
      /* keep the codex gate */
    }
  }
  console.log(`temperature gates replaced from feeder profiles: ${patched}`);
}

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

/** Payout for a species, used to weight recall. Unknown prices weigh 1 so they neither dominate nor vanish. */
function payoutOf(id: string): number {
  const e = byId.get(id);
  if (!e) return 1;
  return lookupPrice(prices, e.displayName, e.id) ?? 1;
}

function genusOf(id: string): string | null {
  return byId.get(id)?.genusDataDir ?? null;
}

const pct = (sorted: number[], p: number): number =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]! : 0;

/**
 * One tier of the candidate list.
 *
 * Since the no-walls change a body carries two lists: the **shown** tier, which is what the panel
 * renders by default, and the **unlikely** tier behind "show unlikely (N)" — candidates whose only
 * failing criteria are weighted terms rather than walls. Both have to be reported or the numbers
 * lie in opposite directions: shown-only understates recall, everything-together overstates
 * ambiguity by counting rows the commander never sees unless they ask.
 */
interface TierStats {
  hit: number;
  miss: number;
  valueHit: number;
  valueMiss: number;
  genusHit: number;
  genusMiss: number;
  candCounts: number[];
  candCountsPredictable: number[];
  genusCounts: number[];
  completeBodies: number;
  completeTruth: number;
  completeCand: number;
  genusMissByGenus: Map<string, number>;
  missExamples: string[];
}

function emptyTier(): TierStats {
  return {
    hit: 0,
    miss: 0,
    valueHit: 0,
    valueMiss: 0,
    genusHit: 0,
    genusMiss: 0,
    candCounts: [],
    candCountsPredictable: [],
    genusCounts: [],
    completeBodies: 0,
    completeTruth: 0,
    completeCand: 0,
    genusMissByGenus: new Map(),
    missExamples: [],
  };
}

interface ScenarioResult {
  name: string;
  truthBodies: number;
  shown: TierStats;
  all: TierStats;
  /** Truth species absent from the shown tier but present in the unlikely one. */
  rescued: number;
}

function accumulate(
  t: TierStats,
  b: BodyExoState,
  matches: { entry: SpeciesEntry; predictionUnsupported?: unknown }[],
  truth: string[],
): void {
  const ids = new Set(matches.map((m) => m.entry.id));
  const genera = new Set(matches.map((m) => m.entry.genusDataDir));
  t.candCounts.push(ids.size);
  // Species whose spawn depends on system contents or nebula proximity are listed but not
  // predicted, so counting them as choices the commander has to weigh overstates the ambiguity.
  t.candCountsPredictable.push(matches.filter((m) => !m.entry.predictionUnsupported).length);
  t.genusCounts.push(genera.size);

  for (const id of truth) {
    const value = payoutOf(id);
    if (ids.has(id)) {
      t.hit++;
      t.valueHit += value;
    } else {
      t.miss++;
      t.valueMiss += value;
      if (t.missExamples.length < 10) {
        t.missExamples.push(
          `${id} on ${b.bodyName} (${b.scan!.PlanetClass}, ${Math.round(b.scan!.SurfaceTemperature ?? 0)} K, ` +
            `${b.scan!.AtmosphereType ?? "-"}) — ${ids.size} candidates`,
        );
      }
    }
  }

  const truthGenera = new Set(truth.map(genusOf).filter((g): g is string => Boolean(g)));
  for (const g of truthGenera) {
    if (genera.has(g)) t.genusHit++;
    else {
      t.genusMiss++;
      t.genusMissByGenus.set(g, (t.genusMissByGenus.get(g) ?? 0) + 1);
    }
  }

  // Complete-label subset: distinct truth genera == the FSS signal count, so nothing is unobserved
  // on this body and every candidate outside the truth set is provably a false positive.
  const sig = b.biologicalSignals ?? null;
  if (sig != null && sig > 0 && truthGenera.size === sig) {
    t.completeBodies++;
    t.completeTruth += truth.length;
    t.completeCand += matches.length;
  }
}

function runScenario(name: string, useHints: boolean): ScenarioResult {
  const r: ScenarioResult = { name, truthBodies: 0, shown: emptyTier(), all: emptyTier(), rescued: 0 };

  for (const b of bodies) {
    const truth = collectResolvedOrganicLockSpeciesIds(b.organicGenusLocks, db);
    if (!truth.length || !b.scan?.PlanetClass?.trim()) continue;
    r.truthBodies++;

    const hints = useHints ? (b.genusHints ?? null) : null;
    const all = matchDatabaseToScan(db, b.scan, hints, null, { includeBacterium: true }).matches;
    const shown = all.filter((m) => !m.unlikely);

    accumulate(r.shown, b, shown, truth);
    accumulate(r.all, b, all, truth);

    const shownIds = new Set(shown.map((m) => m.entry.id));
    const allIds = new Set(all.map((m) => m.entry.id));
    for (const id of truth) {
      if (!shownIds.has(id) && allIds.has(id)) r.rescued++;
    }
  }
  return r;
}

function reportTier(label: string, t: TierStats, extra: string): void {
  const cand = [...t.candCounts].sort((a, b) => a - b);
  const gen = [...t.genusCounts].sort((a, b) => a - b);
  const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const recall = (t.hit / (t.hit + t.miss)) * 100;
  const vRecall = (t.valueHit / (t.valueHit + t.valueMiss)) * 100;
  const gRecall = (t.genusHit / (t.genusHit + t.genusMiss)) * 100;
  const precision = t.completeCand ? (t.completeTruth / t.completeCand) * 100 : 0;
  const predictable = [...t.candCountsPredictable].sort((a, b) => a - b);

  console.log(`  ${label}${extra}`);
  console.log(`    species recall   ${recall.toFixed(1)}%   (${t.hit} found, ${t.miss} missed)`);
  console.log(
    `    value-weighted   ${vRecall.toFixed(1)}%   (${(t.valueMiss / 1e6).toFixed(1)} M credits missed)`,
  );
  console.log(`    genus recall     ${gRecall.toFixed(1)}%   (${t.genusHit} found, ${t.genusMiss} missed)`);
  console.log(
    `    ambiguity        mean ${mean(cand).toFixed(2)}  p50 ${pct(cand, 50)}  p90 ${pct(cand, 90)}  max ${cand[cand.length - 1] ?? 0}   (genera: mean ${mean(gen).toFixed(2)})`,
  );
  console.log(
    `      ...predicted   mean ${mean(predictable).toFixed(2)}  p50 ${pct(predictable, 50)}  p90 ${pct(predictable, 90)}  max ${predictable[predictable.length - 1] ?? 0}`,
  );
  console.log(
    `    precision        ${precision.toFixed(1)}%   on ${t.completeBodies} complete-label bodies (${t.completeTruth} species / ${t.completeCand} candidates)`,
  );
  if (t.genusMissByGenus.size) {
    console.log(
      `    genus misses     ${[...t.genusMissByGenus.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([g, n]) => `${g} ${n}`)
        .join(", ")}`,
    );
  }
}

function report(r: ScenarioResult): void {
  console.log(`\n── ${r.name} ${"─".repeat(Math.max(0, 54 - r.name.length))}`);
  reportTier("SHOWN — the default panel", r.shown, "");
  console.log("");
  reportTier(
    "+ unlikely tier — one click away",
    r.all,
    `   (${r.rescued} truth species rescued from the walls)`,
  );
}

/**
 * Decidability over the whole FSS corpus, landed or not.
 *
 * The app's job is to produce an answer the commander can act on without flying there. A candidate
 * genus set the same size as the signal count *is* that answer — every listed genus is present. A
 * longer list is not, however correct it may be, because the commander still has to go and look.
 */
function reportDecidability(shownOnly: boolean): void {
  let withSignals = 0;
  let scored = 0;
  let noCandidates = 0;
  let landed = 0;
  let decidable = 0;
  let missingGate = 0;
  let ambiguous = 0;
  let decidableTruth = 0;
  let decidableCorrect = 0;
  const overCounts: number[] = [];

  for (const b of bodies) {
    if (!b.scan?.PlanetClass?.trim()) continue;
    const sig = b.biologicalSignals ?? null;
    if (sig == null || sig <= 0) continue;
    withSignals++;

    const everything = matchDatabaseToScan(db, b.scan, null, null, { includeBacterium: true }).matches;
    // The default panel is the shown tier. Running this over everything as well is what proves the
    // |G| < k defects were the walls: the count goes to zero once the demoted rows are counted.
    const matches = shownOnly ? everything.filter((m) => !m.unlikely) : everything;
    // Same rule the app ships (`genusCertaintyForBody`): species we never claimed to predict cannot
    // satisfy the signal count, or the verdict would rest on a certainty nobody earned.
    const genera = new Set(
      matches.filter((m) => !m.entry.predictionUnsupported).map((m) => m.entry.genusDataDir),
    );
    if (genera.size === 0) {
      noCandidates++;
      continue;
    }
    scored++;

    if (genera.size < sig) missingGate++;
    else if (genera.size === sig) decidable++;
    else {
      ambiguous++;
      overCounts.push(genera.size);
    }

    const truth = collectResolvedOrganicLockSpeciesIds(b.organicGenusLocks, db);
    if (!truth.length) continue;
    landed++;
    if (genera.size !== sig) continue;
    decidableTruth++;
    const truthGenera = new Set(truth.map(genusOf).filter((g): g is string => Boolean(g)));
    if ([...truthGenera].every((g) => genera.has(g))) decidableCorrect++;
  }

  const sorted = overCounts.sort((a, b) => a - b);
  console.log(
    `\n── decidability (FSS-only, ${shownOnly ? "SHOWN tier — the default panel" : "including the unlikely tier"}) ─`,
  );
  console.log(`  corpus           ${withSignals} bodies with signals, of which ${landed} landed on`);
  console.log(`  scored           ${scored}   (${noCandidates} offered no predictable candidate at all)`);
  console.log(
    `  DECIDABLE        ${decidable} (${((decidable / scored) * 100).toFixed(1)}%)   candidate genera == signal count`,
  );
  console.log(
    `  ambiguous        ${ambiguous} (${((ambiguous / scored) * 100).toFixed(1)}%)   mean ${sorted.length ? (sorted.reduce((s, x) => s + x, 0) / sorted.length).toFixed(2) : "0"} genera for k signals`,
  );
  console.log(
    `  missing gate     ${missingGate} (${((missingGate / scored) * 100).toFixed(1)}%)   fewer candidates than the game reports — provable data defect`,
  );
  if (decidableTruth) {
    console.log(
      `  decided & right  ${decidableCorrect}/${decidableTruth} (${((decidableCorrect / decidableTruth) * 100).toFixed(1)}%)   of decidable bodies we landed on, the answer held`,
    );
  }
}

const postDss = runScenario("post-DSS  (genus hints supplied — after the trip)", true);
const fssOnly = runScenario("FSS-only  (hints withheld — the app's actual job)", false);

console.log(
  `\nground truth: ${fssOnly.truthBodies} bodies, ${fssOnly.all.hit + fssOnly.all.miss} confirmed species`,
);
report(fssOnly);
report(postDss);
reportDecidability(true);
reportDecidability(false);

console.log(`\nFSS-only misses (still missing with the unlikely tier included):`);
for (const e of fssOnly.all.missExamples) console.log(`  ${e}`);
console.log();
