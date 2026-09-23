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
 *   NO_TEMP_ENVELOPE=1 npx tsx scripts/accuracy-probe.ts  # without the observed-range demotion
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
import { loadJournalMergeCacheForTool } from "./probeCache.js";
import { regionIndexForSystem, regionForSystem } from "../src/server/regionMapData.js";
import { loadPriceList, lookupPrice } from "../src/server/priceList.js";
import { resolveHostStarBodyId } from "../src/server/orbitUtils.js";
import { journalHostObservationFromSpeciesContext } from "../src/server/journalHostObservation.js";
import type {
  BodyExoState,
  ExplorationScanRecord,
  SpeciesEntry,
  SpeciesMatchContext,
} from "../src/shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = loadSpeciesDatabaseFromTree(root);
const prices = loadPriceList(root);
const byId = new Map<string, SpeciesEntry>(db.species.map((e) => [e.id, e]));

/**
 * `NO_TEMP_ENVELOPE=1` — measure as if the observed-temperature demotion did not exist.
 *
 * The demotion ships: `speciesTreeLoader` hangs each species' observed range on its entry and
 * `matchSpecies` pushes a row one tier down when the body sits outside it. This flag strips those
 * envelopes back off, which is the only way to get the before-number without checking out the old
 * code — and comparing against a stale saved run is how the first version of this measurement went
 * wrong.
 *
 * Measured on 2026-09-19, same cache either way: decidable 497 to 527 (35.1 to 37.2 %), mean
 * ambiguity 4.80 to 4.71 genera, default-panel precision 43.2 to 43.9 % on 461 to 453 candidates,
 * recall 13 to 16 missed — and the two tiers together identical at 616 found, 9 missed.
 */
if (process.env.NO_TEMP_ENVELOPE === "1") {
  let stripped = 0;
  for (const e of db.species) {
    if (e.observedTemperatureK) {
      delete e.observedTemperatureK;
      stripped++;
    }
  }
  console.log(`observed temperature envelopes stripped: ${stripped}`);
}

/**
 * `TEMP_ENVELOPE_MIN=N` — try a higher sample floor than the shipped one.
 *
 * The loader attaches an envelope at 20 bodies. Whether that is the right floor is a question about
 * how much evidence a demotion should need, and the golden diff put real cases on both sides of it:
 * Bacterium aurasus off a 402 K body rests on 6,912 observations, while Electricae pluma leaves a
 * 129.5 K body on 51, only 2.5 K outside. This sweeps the floor so the number is chosen rather than
 * assumed.
 */
if (process.env.TEMP_ENVELOPE_MIN) {
  const floor = Number(process.env.TEMP_ENVELOPE_MIN);
  let dropped = 0;
  if (Number.isFinite(floor)) {
    for (const e of db.species) {
      const env = e.observedTemperatureK;
      if (env && env.count < floor) {
        delete e.observedTemperatureK;
        dropped++;
      }
    }
    console.log(`envelopes below ${floor} bodies dropped: ${dropped}`);
  }
}

/**
 * `TEMP_ENVELOPE_MARGIN=0.05` — how far outside the observed range is still "close enough".
 *
 * Swept by widening the envelopes here rather than by adding a knob to the matcher, because the two
 * are the same measurement and only the winning number needs to exist in shipped code. The case that
 * prompted it: Electricae pluma demoted off a 129.5 K body whose observed range ends at 127 K — two
 * and a half kelvin outside, on 51 observations.
 */
if (process.env.TEMP_ENVELOPE_MARGIN) {
  const frac = Number(process.env.TEMP_ENVELOPE_MARGIN);
  if (Number.isFinite(frac) && frac > 0) {
    for (const e of db.species) {
      const env = e.observedTemperatureK;
      if (!env) continue;
      const pad = (env.max - env.min) * frac;
      e.observedTemperatureK = { min: env.min - pad, max: env.max + pad, count: env.count };
    }
    console.log(`envelopes widened by ${(frac * 100).toFixed(0)}% of their span`);
  }
}

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

const payload = loadJournalMergeCacheForTool();

const bodies: BodyExoState[] = payload.bodies.map(([, b]) => b);

/**
 * Host star per body, from the merged scans — including the systems whose data has been sold, whose
 * physics the store now keeps (`soldExplorationScans`). Without those a host star resolved on 196 of
 * 13,713 bodies and every star term in the matcher was measured against nothing.
 *
 * The app builds this context for every body it matches. The probe did not, so anything the matcher
 * reads from it — host star, orbit distance from the star — was measured as permanently absent.
 */
const systemPositions = new Map<number, { x: number; y: number; z: number }>(payload.systemPositions ?? []);

const scansBySystem = new Map<number, Map<number, ExplorationScanRecord>>();
for (const [, r] of [...(payload.soldExplorationScans ?? []), ...payload.explorationScans]) {
  const byId = scansBySystem.get(r.systemAddress) ?? new Map<number, ExplorationScanRecord>();
  byId.set(r.bodyId, r);
  scansBySystem.set(r.systemAddress, byId);
}

function matchContextFor(b: BodyExoState): SpeciesMatchContext | undefined {
  const byId = scansBySystem.get(b.systemAddress);
  const rec = byId?.get(b.bodyId);
  const ctx: SpeciesMatchContext = {};
  /*
    Region, which this probe used to leave out.

    `speciesMatchesScan` consults the region gate only when the context carries a `regionIndex`, and
    the app always supplies one. Omitting it here measured a matcher the commander never sees: Tubus
    cavas sits at 0.0061 % of Inner Orion Spur's bio systems against compagibus's 7.66 %, well under
    the absence cut, so the app demotes it there while this probe kept scoring it. The positions have
    been in the merge cache all along.
  */
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
  if (!byId || !rec) return Object.keys(ctx).length ? ctx : undefined;
  const starId = resolveHostStarBodyId(rec, byId);
  const star = starId == null ? null : byId.get(starId);
  if (star?.starType?.trim()) {
    ctx.parentStarType = star.starType;
    if (typeof star.subclass === "number" && Number.isFinite(star.subclass))
      ctx.parentStarSubclass = star.subclass;
    if (star.luminosity?.trim()) ctx.parentStarLuminosity = star.luminosity;
  }
  return Object.keys(ctx).length ? ctx : undefined;
}

/** The host-star observation the habitat scorer reads, for the same body. */
function hostFor(b: BodyExoState) {
  const ctx = matchContextFor(b);
  return ctx ? journalHostObservationFromSpeciesContext(ctx) : null;
}

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
    const all = matchDatabaseToScan(db, b.scan, hints, null, {
      includeBacterium: true,
      matchContext: matchContextFor(b),
      biologicalSignals: b.biologicalSignals,
    }).matches;
    const shown = all.filter((m) => !m.unlikely);

    accumulate(r.shown, b, shown, truth);
    accumulate(r.all, b, all, truth);

    const shownIds = new Set(shown.map((m) => m.entry.id));
    const allIds = new Set(all.map((m) => m.entry.id));
    for (const id of truth) {
      if (!shownIds.has(id) && allIds.has(id)) r.rescued++;
      // `LIST_MISSES=1`: every find the shown tier loses, with the matcher's own reason — the list a
      // recall change has to be read against, not just the count.
      if (process.env.LIST_MISSES && !shownIds.has(id)) {
        const m = all.find((x) => x.entry.id === id);
        const why = m ? m.reasons.filter((x) => x.soft).map((x) => `${x.field}: ${x.detail}`).join(" | ") : "not listed";
        console.log(`  MISS [${name}] ${id} on ${b.bodyName} — ${why}`);
      }
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

    const everything = matchDatabaseToScan(db, b.scan, null, null, {
      includeBacterium: true,
      matchContext: matchContextFor(b),
      biologicalSignals: b.biologicalSignals,
    }).matches;
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
